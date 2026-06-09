// ai/index.js
require("dotenv").config();
const { OpenAI } = require("openai");
const { getConversation, updateConversation } = require("../conversationManager");
const Campaign = require("../models/Campaign");

const { handleFallback } = require("./core/fallback");
const { identifyAndSetProduct } = require("./utils/productIdentifier");
const { lockPOI, checkVariantExists } = require("./utils/productTree");
const { handleLocationStatsResponse, appendStatsQuestionIfNeeded } = require("./utils/locationStats");

// Extracted shared helpers (used by both old monolith and new pipeline)
const { checkForRepetition } = require("./utils/repetitionChecker");
const { handleIntentFromDB } = require("./utils/intentDBHandler");

// Pipeline system (feature-flagged)
const { runPipeline, buildContext } = require("./pipeline");
const { getMiddleware, getPostProcessors } = require("./pipelineConfig");
const USE_PIPELINE = process.env.USE_PIPELINE === 'true';

// Layer 0: Source Context Detection
const { buildSourceContext, logSourceContext } = require("./context");

// Layer 1: Intent Classification
const { classify, logClassification, INTENTS } = require("./classifier");

// Layer 1.5: Intent Dispatcher - AI-first routing to handlers
// This runs BEFORE flows - handles intents that don't need multi-step flow processing
const { dispatch: dispatchToHandler } = require("./intentDispatcher");

// Central Flow Manager — ALL messages go through here
const { processMessage: processWithFlowManager } = require("./flowManager");

// Flow executor for DB-driven conversation flows
const {
  isInFlow,
  processFlowStep,
} = require("./flowExecutor");

const openai = new OpenAI({ apiKey: process.env.AI_API_KEY });
const botNames = ["Paula", "Sofía", "Camila", "Valeria", "Daniela"];
const BOT_PERSONA_NAME = botNames[Math.floor(Math.random() * botNames.length)];
console.log(`🤖 Asistente asignada para esta sesión: ${BOT_PERSONA_NAME}`);

/**
 * Pipeline-based entry point for generating bot responses.
 * Feature-flagged via USE_PIPELINE env var.
 */
async function generateReplyPipeline(userMessage, psid, referral = null) {
  const convo = await getConversation(psid);
  const ctx = buildContext(
    userMessage, psid, referral, convo,
    (data) => updateConversation(psid, data)
  );

  const response = await runPipeline(getMiddleware(), getPostProcessors(), ctx);
  return response;
}

/**
 * If this conversation entered through an ad that has a Conversation Workflow
 * attached and enabled, drive one turn of the router+node engine and return its
 * reply. Returns { handled: true, reply } when the workflow took over, or null
 * when it did not (no ad / no workflow / disabled / human handling / error) so
 * the caller falls through to the legacy bot.
 *
 * State persists on Conversation.workflowState across messages. A fresh state is
 * built (seeded with the ad's setup vars) on the first turn, or whenever the ad's
 * attached workflow changes.
 */
// Shared engine runner. Given a resolved workflow + the conversation, runs one
// turn, persists collected data, fires a real handoff if requested, and
// sanitizes the reply (link tracking + phone guard). Used by BOTH the ad path
// and the cold-start path.
//   sourceLabel: a string for logs ("ad=… " or "coldstart")
//   initOverrides: setup vars to seed a fresh state (ad.workflowSetup or {})
async function runEngineWorkflow(workflow, convo, psid, userMessage, { sourceLabel, initOverrides = {} }) {
  const { runWorkflowTurn, initState } = require("./workflow");

  // Reuse persisted state only if it belongs to THIS workflow; otherwise start
  // fresh, seeding the setup vars as per-conversation overrides.
  let state = convo.workflowState;
  if (!state || String(state.workflowId) !== String(workflow._id)) {
    state = initState(workflow, {}, initOverrides || {});
  }

  const { reply, state: newState, diagnostics } = await runWorkflowTurn(
    workflow,
    state,
    userMessage,
    { psid } // enable psid-traceable links (commerce-status attribution)
  );

  // Map what the engine collected (lead / location / product) onto the
  // Conversation so the human-handoff brief, commerce-status and zip attribution
  // have it. Don't clobber values the conversation already has.
  const lead = newState.lead || {};
  const loc = newState.location || {};
  const handoff = !!diagnostics?.handoffRequested;
  const persist = {
    workflowState: newState,
    currentFlow: `workflow:${workflow.name}`,
    lastIntent: handoff ? "handoff_requested" : "workflow_turn",
    lastMessageAt: new Date(),
  };
  if (loc.city && !convo.city) persist.city = loc.city;
  if ((loc.zip || loc.zipcode) && !convo.zipcode) persist.zipcode = loc.zip || loc.zipcode;
  if (lead.phone || lead.email) persist.leadData = { contact: lead.phone || lead.email };
  if (lead.name && !convo.extractedName) persist.extractedName = lead.name;
  if (newState.product?.name && !convo.productInterest) persist.productInterest = newState.product.name;
  await updateConversation(psid, persist).catch((e) =>
    console.error("⚠️ workflowState persist failed:", e.message)
  );

  // REAL HANDOFF: when the flow decided to escalate (request_handoff, or a scope
  // check that needs a human), take it over throughout the system — set
  // needs_human, alert the dashboard, and hand the client brief to the human.
  if (handoff) {
    try {
      const { triggerHandoff } = require("../services/pushNotifications");
      await triggerHandoff(
        psid,
        diagnostics.handoffReason || "El flujo pasó la conversación con un asesor"
      );
      console.log(`🙋 [workflow] handoff escalated for ${psid}: ${diagnostics.handoffReason || "(sin motivo)"}`);
    } catch (e) {
      console.error("⚠️ engine handoff trigger failed:", e.message);
    }
  }

  console.log(
    `🧩 [workflow] ${sourceLabel} flow="${workflow.name}" → node="${diagnostics?.toNode?.name || "?"}"${handoff ? " [HANDOFF]" : ""}`
  );

  // CATALOG DOCUMENT: the share_catalog tool flags a PDF to send as a file
  // attachment (replicates legacy sendCatalog — arrives as a document bubble,
  // not a link). Send it on the right channel; the text reply goes separately.
  if (diagnostics?.catalogToSend?.url) {
    try {
      const cat = diagnostics.catalogToSend;
      const isWhatsApp = (convo.channel === "whatsapp") || String(psid).startsWith("wa:");
      if (isWhatsApp) {
        const { sendDocumentMessage } = require("../channels/whatsapp/api");
        const phone = String(psid).replace(/^wa:/, "");
        await sendDocumentMessage(phone, cat.url, cat.filename || "Catalogo_Hanlob.pdf", null);
      } else {
        const { sendCatalog } = require("../utils/sendCatalog");
        const fbPsid = String(psid).replace(/^fb:/, "");
        await sendCatalog(fbPsid, cat.url, null); // file only; the text reply is separate
      }
      console.log(`📄 [workflow] catalog document sent to ${psid}`);
    } catch (e) {
      console.error("⚠️ workflow catalog send failed:", e.message);
    }
  }

  // SAFETY NET: if the model pasted a raw Mercado Libre URL into its reply
  // (instead of calling share_product_link), rewrite it to a psid-tracked
  // redirect so the click is attributed. Single chokepoint for every
  // workflow reply (main, switched, prefixed).
  let safeText = reply;
  if (reply) {
    try {
      const { sanitizeMarketplaceLinks } = require("./workflow/priceResolver");
      safeText = await sanitizeMarketplaceLinks(reply, {
        psid,
        productName: newState.product?.name || null,
        productId: newState.product?._id ? String(newState.product._id) : null,
      });
    } catch (e) {
      console.error("⚠️ workflow link sanitize failed:", e.message);
    }
    // Phone guard: never hand out a fabricated number.
    try {
      const { sanitizePhones } = require("./utils/phoneGuard");
      safeText = await sanitizePhones(safeText);
    } catch (e) {
      console.error("⚠️ workflow phoneGuard failed:", e.message);
    }
    // Internal-vocabulary guard: the customer must never hear engine concepts
    // like "flujo", "este flujo", "nodo", "configurado en este flujo". Node
    // prompts sometimes contain these words ("...fuera de la familia
    // configurada en este flujo") and the model echoes them. Soften to
    // customer-safe phrasing.
    try {
      safeText = safeText
        .replace(/\b(en|de|para|dentro de)\s+este\s+flujo\b/gi, "en nuestro catálogo")
        .replace(/\beste\s+flujo\b/gi, "nuestro catálogo")
        .replace(/\b(el\s+)?flujo\s+(actual|configurado|asignado)\b/gi, "nuestro catálogo")
        .replace(/\bla\s+familia\s+configurada[^.,;]*/gi, "lo que manejamos")
        .replace(/\bflujos?\b/gi, "catálogo");
    } catch (e) {
      console.error("⚠️ workflow vocab guard failed:", e.message);
    }
  }

  return { handled: true, reply: safeText ? { type: "text", text: safeText } : null };
}

// Same human-handling states everywhere: the engine must never speak over a
// live human takeover.
const WORKFLOW_HUMAN_STATES = new Set(["needs_human", "human_active", "human_takeover", "human_handling"]);

async function maybeRunAdWorkflow(userMessage, psid) {
  // Cheap, side-effect-free read first (getConversation may upsert/hydrate).
  const Conversation = require("../models/Conversation");
  const convo = await Conversation.findOne({ psid })
    .select("adId channel state workflowState extractedName city zipcode productInterest")
    .lean();
  if (!convo || !convo.adId) return null;
  if (WORKFLOW_HUMAN_STATES.has(convo.state)) return null;

  const Ad = require("../models/Ad");
  const ad = await Ad.findOne({ fbAdId: convo.adId })
    .select("name workflowId workflowEnabled workflowSetup")
    .lean();
  if (!ad || !ad.workflowEnabled || !ad.workflowId) return null;

  const Workflow = require("../models/Workflow");
  const workflow = await Workflow.findById(ad.workflowId);
  if (!workflow) return null;

  return runEngineWorkflow(workflow, convo, psid, userMessage, {
    sourceLabel: `ad="${ad.name || convo.adId}"`,
    initOverrides: ad.workflowSetup || {},
  });
}

// COLD-START WORKFLOW: handles conversations that arrive WITHOUT a routing ad
// (organic DMs, page messages). Runs only when exactly one workflow is flagged
// isColdStart (and active). No flag → returns null → legacy bot handles it,
// exactly as before. Off-switch is the flag itself.
async function maybeRunColdStartWorkflow(userMessage, psid) {
  const Conversation = require("../models/Conversation");
  const convo = await Conversation.findOne({ psid })
    .select("adId channel state workflowState extractedName city zipcode productInterest")
    .lean();
  if (!convo) return null;
  // Ad-routed conversations are handled by maybeRunAdWorkflow, not here.
  if (convo.adId) return null;
  if (WORKFLOW_HUMAN_STATES.has(convo.state)) return null;

  const Workflow = require("../models/Workflow");
  const workflow = await Workflow.findOne({ isColdStart: true, active: true });
  if (!workflow) return null;

  return runEngineWorkflow(workflow, convo, psid, userMessage, {
    sourceLabel: "coldstart",
    initOverrides: {},
  });
}

/**
 * Main entry point for generating bot responses.
 * Uses pipeline when USE_PIPELINE=true, otherwise uses the monolith.
 */
async function generateReply(userMessage, psid, referral = null) {
  // ===== AD-ASSIGNED WORKFLOW TAKEOVER (opt-in per ad; super_admin) =====
  // If this conversation entered through an ad that has a Conversation Workflow
  // attached AND enabled, the router+node engine handles the turn and the legacy
  // flow system is bypassed entirely. Re-checked every message, so flipping the
  // ad's toggle OFF reverts its traffic to the current bot on the next message.
  // Covers BOTH channels (FB + WhatsApp both funnel through generateReply and both
  // stamp convo.adId on ad entry). Any error falls through to the legacy bot.
  try {
    const taken = await maybeRunAdWorkflow(userMessage, psid);
    if (taken && taken.handled) return taken.reply;
  } catch (err) {
    console.error("❌ ad-workflow takeover failed; falling back to legacy:", err.message);
  }
  // ===== END WORKFLOW TAKEOVER =====

  // ===== COLD-START WORKFLOW TAKEOVER (non-ad traffic; opt-in via flag) =====
  // Conversations WITHOUT a routing ad (organic DMs/page messages) are handled
  // by the workflow flagged isColdStart, if any. No flag → falls through to the
  // legacy bot, unchanged. Re-checked every message, so flipping the flag OFF
  // reverts organic traffic to the legacy bot on the next message.
  try {
    const taken = await maybeRunColdStartWorkflow(userMessage, psid);
    if (taken && taken.handled) return taken.reply;
  } catch (err) {
    console.error("❌ cold-start workflow failed; falling back to legacy:", err.message);
  }
  // ===== END COLD-START TAKEOVER =====

  if (USE_PIPELINE) {
    return generateReplyPipeline(userMessage, psid, referral);
  }

  let convo = await getConversation(psid);

  // ====== RESET STALE NEEDS_HUMAN CONVERSATIONS ======
  // If conversation was handed off but client returns after 12+ hours,
  // treat as a new conversation so the bot can respond
  if (convo.state === "needs_human") {
    const lastMessageTime = convo.lastMessageAt ? new Date(convo.lastMessageAt) : null;
    const hoursSinceLastMessage = lastMessageTime
      ? (Date.now() - lastMessageTime.getTime()) / (1000 * 60 * 60)
      : 999;

    // After 12 hours, reset the conversation - client is starting fresh
    if (hoursSinceLastMessage >= 12) {
      console.log(`🔄 Resetting stale needs_human conversation (${hoursSinceLastMessage.toFixed(1)}h since last message)`);
      await updateConversation(psid, {
        state: "active",
        lastIntent: null,
        handoffRequested: false,
        handoffReason: null,
        lastBotResponse: null,
        lastNeedsHumanReminder: null,
        currentFlow: null,
        flowStep: null,
        flowData: {},
        silenceFollowUpSent: false,
        silenceFollowUpAt: null,
        linkFollowUpAt: null
      });
      // Update local convo object
      convo.state = "active";
      convo.lastIntent = null;
      convo.handoffRequested = false;
      convo.currentFlow = null;
    }
  }
  // ====== END RESET STALE NEEDS_HUMAN CONVERSATIONS ======

  // ====== CLEAR STALE PREVIOUS SESSION ======
  if (convo.previousSession?.savedAt) {
    const sessionAge = (Date.now() - new Date(convo.previousSession.savedAt).getTime()) / (1000 * 60 * 60);
    if (sessionAge > 48) {
      console.log(`🧹 Clearing stale previousSession (${sessionAge.toFixed(1)}h old)`);
      await updateConversation(psid, { previousSession: null });
      convo.previousSession = null;
    }
  }
  // ====== END CLEAR STALE PREVIOUS SESSION ======

  // ====== CHECK NEEDS_HUMAN STATE ======
  // If conversation still needs human (active handoff, not a closed convo), stay mostly silent
  // BUT allow the bot to answer simple product questions while the customer waits
  if (convo.state === "needs_human") {
    console.log("🚨 Conversation is waiting for human (needs_human state)");

    // Classify the message to see if it's a question the bot can answer
    const { classify: classifyMsg } = require("./classifier");
    const quickClassification = await classifyMsg(userMessage, null, null, null);
    const qi = quickClassification?.intent;

    // Let product/informational questions pass through to the normal pipeline
    const ANSWERABLE_INTENTS = new Set([
      "price_query", "product_inquiry", "availability_query", "catalog_request",
      "size_specification", "percentage_specification", "color_query",
      "shade_percentage_query", "shipping_query", "payment_query",
      "delivery_time_query", "shipping_included_query", "installation_query",
      "warranty_query", "durability_query", "custom_size_query",
      "product_comparison", "location_query", "largest_product", "smallest_product"
    ]);

    if (qi && ANSWERABLE_INTENTS.has(qi)) {
      console.log(`💬 needs_human but answerable intent "${qi}" — letting bot respond (state stays needs_human)`);
      // Fall through to normal pipeline — state stays needs_human so human still gets notified
    } else {
      // Check when we last sent a reminder (avoid spamming)
      const lastReminder = convo.lastNeedsHumanReminder ? new Date(convo.lastNeedsHumanReminder) : null;
      const minutesSinceReminder = lastReminder
        ? (Date.now() - lastReminder.getTime()) / (1000 * 60)
        : 999;

      // Send reminder at most every 10 minutes
      if (minutesSinceReminder >= 10) {
        await updateConversation(psid, { lastNeedsHumanReminder: new Date() });

        return {
          type: "text",
          text: "Tu mensaje fue recibido. Un especialista te atenderá en breve. 🙏"
        };
      }

      // Already sent a recent reminder, stay silent
      console.log(`⏳ Already sent reminder ${minutesSinceReminder.toFixed(1)} min ago, staying silent`);
      return null;
    }
  }
  // ====== END CHECK NEEDS_HUMAN STATE ======

  // ====== CONVERSATION BASKET: Extract and merge specs from EVERY message ======
  // This ensures we never lose information the customer gave us
  const { extractAllSpecs, mergeSpecs } = require("./utils/specExtractor");
  const extractedSpecs = extractAllSpecs(userMessage, { lastIntent: convo.lastIntent });

  if (Object.keys(extractedSpecs).length > 0) {
    const mergedSpecs = mergeSpecs(convo.productSpecs || {}, extractedSpecs);
    console.log(`🛒 Basket updated:`, JSON.stringify(mergedSpecs));

    // Save merged specs to conversation (non-blocking)
    updateConversation(psid, { productSpecs: mergedSpecs }).catch(err =>
      console.error("Error updating productSpecs:", err.message)
    );

    // Update local convo object so handlers have the latest specs
    convo.productSpecs = mergedSpecs;
  }
  // ====== END CONVERSATION BASKET ======

  // ====== STRUCTURAL FIX: ENSURE PRODUCT INTEREST IS RESOLVED ======
  // If conversation has adId or campaignRef but NO productInterest, resolve it now
  // This is a self-healing mechanism - even if initial referral handling failed,
  // we always have a second chance to resolve the context
  if (!convo?.productInterest && (convo?.adId || convo?.campaignRef)) {
    try {
      const { resolveByAdId, resolveByCampaignRef } = require("../utils/campaignResolver");
      const { getProductInterest } = require("./utils/productEnricher");
      const ProductFamily = require("../models/ProductFamily");

      let resolvedSettings = null;

      // Try to resolve by adId first, then by campaignRef
      if (convo.adId) {
        resolvedSettings = await resolveByAdId(convo.adId);
        console.log(`🔄 Self-healing: resolving productInterest from adId ${convo.adId}`);
      } else if (convo.campaignRef) {
        resolvedSettings = await resolveByCampaignRef(convo.campaignRef);
        console.log(`🔄 Self-healing: resolving productInterest from campaignRef ${convo.campaignRef}`);
      }

      if (resolvedSettings?.productIds?.length > 0) {
        const productId = resolvedSettings.mainProductId || resolvedSettings.productIds[0];
        const product = await ProductFamily.findById(productId).lean();

        if (product) {
          const productInterest = await getProductInterest(product);
          if (productInterest) {
            // Lock POI with full tree context
            const poiContext = await lockPOI(psid, product._id);
            if (poiContext) {
              convo.productInterest = productInterest;
              convo.poiLocked = true;
              convo.poiRootId = poiContext.rootId?.toString();
              convo.poiRootName = poiContext.rootName;
              convo.productFamilyId = product._id.toString();
              console.log(`✅ Self-healing: POI locked to ${poiContext.rootName} (${productInterest})`);
            } else {
              await updateConversation(psid, { productInterest });
              convo.productInterest = productInterest;
              console.log(`✅ Self-healing: set productInterest to ${productInterest}`);
            }
          }
        }
      } else if (resolvedSettings?.campaignName) {
        // Fallback: infer from campaign name and try to lock to root family
        const campaignName = (resolvedSettings.campaignName || '').toLowerCase();
        let productInterest = null;
        let rootFamilyName = null;

        if (campaignName.includes('malla') || campaignName.includes('sombra') || campaignName.includes('confeccionada')) {
          productInterest = 'malla_sombra';
          rootFamilyName = 'Malla Sombra';
        } else if (campaignName.includes('borde') || campaignName.includes('jardin')) {
          productInterest = 'borde_separador';
          rootFamilyName = 'Borde Separador';
        } else if (campaignName.includes('ground') || campaignName.includes('cover')) {
          productInterest = 'ground_cover';
          rootFamilyName = 'Ground Cover';
        }

        if (productInterest) {
          // Try to find and lock to the root family
          const rootFamily = await ProductFamily.findOne({
            name: { $regex: rootFamilyName, $options: 'i' },
            parentId: null,
            active: true
          }).lean();

          if (rootFamily) {
            const poiContext = await lockPOI(psid, rootFamily._id);
            if (poiContext) {
              convo.productInterest = productInterest;
              convo.poiLocked = true;
              convo.poiRootId = poiContext.rootId?.toString();
              convo.poiRootName = poiContext.rootName;
              console.log(`✅ Self-healing: POI locked to ${poiContext.rootName} from campaign name`);
            }
          } else {
            await updateConversation(psid, { productInterest });
            convo.productInterest = productInterest;
            console.log(`✅ Self-healing: inferred productInterest ${productInterest} from campaign name`);
          }
        }
      }
    } catch (err) {
      console.error(`⚠️ Self-healing productInterest resolution failed:`, err.message);
    }
  }
  // ====== END STRUCTURAL FIX ======

  // ====== CHECK ACTIVE FLOW ======
  // If user is in an active flow, process the flow step first
  if (isInFlow(convo)) {
    console.log(`🔄 User is in active flow: ${convo.activeFlow.flowKey}`);
    const flowResponse = await processFlowStep(userMessage, psid, convo);
    if (flowResponse) {
      return await checkForRepetition(flowResponse, psid, convo);
    }
    // If flow returns null, continue with normal processing
    console.log(`⚠️ Flow returned null, continuing with normal processing`);
  }
  // ====== END ACTIVE FLOW CHECK ======

  // ====== EARLY HANDLERS (from old system) ======
  // These handle common patterns before the main flow system
  const cleanMsg = userMessage.toLowerCase().trim();

  // 📊 LOCATION STATS: Check if user is answering our "de qué ciudad?" question.
  // SKIP this when there's a pending handoff — the zip the customer just gave
  // is needed to COMPLETE the handoff, not to satisfy a stats request. The
  // pending-handoff resume in flowManager/convoFlow takes priority.
  if (convo.pendingLocationResponse && !convo.pendingHandoff) {
    const locationResponse = await handleLocationStatsResponse(userMessage, psid, convo);
    if (locationResponse) {
      return await checkForRepetition(locationResponse, psid, convo);
    }
    // Not a location response, continue normal flow
  }

  // 📍 SHIPPING LOCATION: Check if user is answering "¿Cuál es tu código postal o ciudad?"
  if (convo.pendingShippingLocation) {
    const { parseLocationResponse, syncLocationToUser } = require("./utils/locationStats");
    const { detectLocationEnhanced } = require("../mexicanLocations");

    // Try to parse as location
    let location = parseLocationResponse(userMessage);

    // If parseLocationResponse didn't work, try detectLocationEnhanced
    if (!location) {
      const detected = await detectLocationEnhanced(userMessage);
      if (detected) {
        location = {
          city: detected.location || detected.normalized,
          state: detected.state,
          zipcode: detected.code || null
        };
      }
    }

    // Clear pending flag
    await updateConversation(psid, { pendingShippingLocation: false });

    if (location) {
      console.log("📍 Shipping location received:", location);

      // Save location to conversation and User model
      const convoUpdate = { unknownCount: 0 };
      if (location.city) convoUpdate.city = location.city;
      if (location.state) convoUpdate.stateMx = location.state;
      if (location.zipcode) {
        convoUpdate.zipcode = location.zipcode;
        convoUpdate.zipCode = location.zipcode; // canonical field
      }
      await updateConversation(psid, convoUpdate);
      await syncLocationToUser(psid, location, 'shipping_question');

      // Build location string for response
      const locationStr = location.city || location.state || `CP ${location.zipcode}`;

      // Check if they're in Querétaro
      const isQueretaro = (location.state && /quer[eé]taro/i.test(location.state)) ||
                          (location.city && /quer[eé]taro/i.test(location.city));

      let response = `Perfecto, enviamos a ${locationStr} a través de Mercado Libre 📦`;

      if (isQueretaro) {
        response += `\n\nTambién puedes visitar nuestra tienda en el parque industrial Navex, Tlacote.`;
      }

      // If we already have dimensions or shared a product, don't ask "what size?" again
      const hasSpecs = convo.productSpecs?.width || convo.productSpecs?.height || convo.productSpecs?.dimensions;
      if (!convo.lastSharedProductId && !hasSpecs) {
        response += `\n\n¿Qué medida de malla sombra necesitas?`;
      }

      return await checkForRepetition({ type: "text", text: response }, psid, convo);
    }
    // Not a valid location, continue normal flow
  }

  // ====== LAYER 0: SOURCE CONTEXT ======
  // Detect where this conversation came from (ad, comment, cold DM, returning user)
  const sourceContext = await buildSourceContext(
    referral ? { referral, sender: { id: psid } } : { sender: { id: psid } },
    convo,
    convo?.channel || "facebook"
  );

  // Log source context for analytics
  logSourceContext(psid, sourceContext, userMessage);

  // Store ad context on conversation when resolved from ad hierarchy
  if (sourceContext?.ad?.flowRef && !convo.adFlowRef) {
    await updateConversation(psid, { adFlowRef: sourceContext.ad.flowRef });
    convo.adFlowRef = sourceContext.ad.flowRef;
    console.log(`🎯 Ad flowRef stored on conversation: ${sourceContext.ad.flowRef}`);
  }
  if (sourceContext?.ad?.convoFlowRef && !convo.convoFlowRef) {
    await updateConversation(psid, { convoFlowRef: sourceContext.ad.convoFlowRef, currentFlow: `convo:${sourceContext.ad.convoFlowRef}` });
    convo.convoFlowRef = sourceContext.ad.convoFlowRef;
    convo.currentFlow = `convo:${sourceContext.ad.convoFlowRef}`;
    console.log(`🎯 ConvoFlowRef stored on conversation: ${sourceContext.ad.convoFlowRef}`);
  }
  // Persist promo plugin from ad onto conversation
  if (sourceContext?.ad?.promo && !convo.adPromo) {
    await updateConversation(psid, { adPromo: sourceContext.ad.promo });
    convo.adPromo = sourceContext.ad.promo;
    console.log(`🎁 Promo plugin stored on conversation`);
  }
  if (sourceContext?.ad?.productIds?.length && !convo.adProductIds?.length) {
    await updateConversation(psid, { adProductIds: sourceContext.ad.productIds });
    convo.adProductIds = sourceContext.ad.productIds;
    console.log(`🎯 Ad productIds stored on conversation: ${sourceContext.ad.productIds}`);
  }
  if (sourceContext?.ad?.product && !convo.productInterest) {
    await updateConversation(psid, { productInterest: sourceContext.ad.product });
    convo.productInterest = sourceContext.ad.product;
    console.log(`🎯 Product interest stored from ad: ${sourceContext.ad.product}`);
  }
  // Store ad's main product name (e.g., "6m x 4m") so flows can use it when customer says "esa medida"
  if (sourceContext?.ad?.productName && !convo.adMainProductName) {
    await updateConversation(psid, { adMainProductName: sourceContext.ad.productName });
    convo.adMainProductName = sourceContext.ad.productName;
    console.log(`🎯 Ad main product name stored: ${sourceContext.ad.productName}`);
  }
  // Set currentFlow from ad context so the ad's flow governs the whole conversation
  // Skip if already in reseller flow (wholesale inquiry takes priority over product flow)
  // Skip if ad has flowRef or convoFlowRef — those are explicit routing and detectFlow() handles them
  const hasExplicitFlowRef = sourceContext?.ad?.flowRef || convo?.adFlowRef ||
    sourceContext?.ad?.convoFlowRef || convo?.convoFlowRef;
  if ((!convo.currentFlow || convo.currentFlow === 'default') && !convo.isWholesaleInquiry && !hasExplicitFlowRef) {
    const adProduct = sourceContext?.ad?.product || '';
    let adFlow = null;
    if (adProduct.startsWith('malla_sombra') || adProduct === 'confeccionada') {
      adFlow = 'malla_sombra';
    } else if (adProduct.startsWith('rollo')) {
      adFlow = 'rollo';
    } else if (adProduct.startsWith('borde')) {
      adFlow = 'borde_separador';
    } else if (adProduct.startsWith('ground') || adProduct === 'groundcover') {
      adFlow = 'groundcover';
    } else if (adProduct.startsWith('mono')) {
      adFlow = 'monofilamento';
    }
    if (adFlow) {
      await updateConversation(psid, { currentFlow: adFlow });
      convo.currentFlow = adFlow;
      console.log(`🎯 currentFlow set from ad product: ${adProduct} → ${adFlow}`);
    }
  }
  // ====== END LAYER 0 ======

  // ====== LOAD CAMPAIGN CONTEXT ======
  let campaign = null;
  let campaignContext = null;

  // Check for campaign from referral or existing conversation
  const campaignRef = referral?.ref || convo?.campaignRef;
  if (campaignRef) {
    try {
      campaign = await Campaign.findOne({ ref: campaignRef, active: true });
      if (campaign) {
        campaignContext = campaign.toAIContext();
        console.log(`📣 Campaign loaded from ref: ${campaign.name} (goal: ${campaign.conversationGoal})`);

        // Save campaign ref to conversation if new
        if (!convo?.campaignRef && referral?.ref) {
          await updateConversation(psid, { campaignRef: campaign.ref });
        }
      }
    } catch (err) {
      console.error(`⚠️ Error loading campaign:`, err.message);
    }
  }

  // If no campaign from ref, check if we have one from ad context
  if (!campaign && sourceContext?.ad?.campaign) {
    campaign = sourceContext.ad.campaign;
    console.log(`📣 Campaign loaded from ad chain: ${campaign.name} (goal: ${campaign.conversationGoal})`);
  }

  // If still no campaign but we have an adId, resolve via campaign resolver
  if (!campaign && convo?.adId) {
    try {
      const { resolveByAdId } = require("../utils/campaignResolver");
      const resolved = await resolveByAdId(convo.adId);
      if (resolved?.campaignId) {
        campaign = await Campaign.findById(resolved.campaignId);
        if (campaign) {
          campaignContext = campaign.toAIContext?.() || null;
          console.log(`📣 Campaign resolved from adId: ${campaign.name} (goal: ${campaign.conversationGoal})`);
        }
      }
    } catch (err) {
      console.error(`⚠️ Error resolving campaign from adId:`, err.message);
    }
  }
  // ====== END CAMPAIGN CONTEXT ======

  // ====== AUTO-FLAG WHOLESALE FROM AD/CAMPAIGN AUDIENCE ======
  if (!convo.isWholesaleInquiry && campaign) {
    // Check campaign audience (inherits: Ad > AdSet > Campaign)
    const audienceType = sourceContext?.ad?.campaignAudience?.type || campaign.audience?.type;
    if (audienceType === 'reseller') {
      await updateConversation(psid, { isWholesaleInquiry: true, currentFlow: 'reseller' });
      convo.isWholesaleInquiry = true;
      convo.currentFlow = 'reseller';
      console.log(`🏪 Reseller audience detected from campaign "${campaign.name}" — routing to reseller flow`);
    }
  }

  // ====== PRODUCT IDENTIFICATION & POI LOCK ======
  // Try to identify product from message content
  // This runs even if productInterest is already set (might be switching products)
  const identifiedProduct = await identifyAndSetProduct(userMessage, psid, convo);
  if (identifiedProduct) {
    convo.productInterest = identifiedProduct.key; // Update local copy
    console.log(`🎯 Product context: ${identifiedProduct.displayName} (${identifiedProduct.key})`);

    // Lock POI with full tree context
    if (identifiedProduct.familyId && !convo.poiLocked) {
      const poiContext = await lockPOI(psid, identifiedProduct.familyId);
      if (poiContext) {
        convo.poiLocked = true;
        convo.poiRootId = poiContext.rootId?.toString();
        convo.poiRootName = poiContext.rootName;
        console.log(`🔒 POI locked: ${poiContext.name} (root: ${poiContext.rootName})`);
      }
    }
  }

  // If POI is locked but user asks for something outside the tree, inform them
  if (convo.poiLocked && convo.poiRootId) {
    // Check if message mentions a different product category entirely
    const ProductFamily = require("../models/ProductFamily");
    const otherProduct = await identifyAndSetProduct(userMessage, psid, {});

    if (otherProduct && otherProduct.familyId) {
      // Check if this product is in our locked tree
      const variantCheck = await checkVariantExists(convo.poiRootId, otherProduct.name);

      if (!variantCheck.exists && variantCheck.reason === "not_in_tree") {
        // User asked for a product outside their locked tree
        // Allow switching - update POI to new tree
        const newPOI = await lockPOI(psid, otherProduct.familyId);
        if (newPOI) {
          convo.productInterest = otherProduct.key;
          convo.poiRootId = newPOI.rootId?.toString();
          convo.poiRootName = newPOI.rootName;
          console.log(`🔄 POI switched: ${newPOI.rootName}`);
        }
      }
    }
  }
  // ====== END PRODUCT IDENTIFICATION & POI LOCK ======

  // ====== LAYER 1: INTENT CLASSIFICATION ======
  const conversationFlow = convo?.productSpecs ? {
    product: convo.productSpecs.productType,
    stage: convo.lastIntent,
    collected: convo.productSpecs
  } : null;

  // Pass campaign context to classifier
  const classification = await classify(userMessage, sourceContext, conversationFlow, campaignContext);
  logClassification(psid, userMessage, classification);
  // ====== END LAYER 1 ======

  // ── convo_flow guard: when a convo_flow is active, ALL pre-flow interceptors are dormant.
  // The convo_flow pipeline (promoFlow → masterFlow → buyerFlow → productFlow → retailFlow) handles everything.
  const isConvoFlowActive = convo?.convoFlowRef || convo?.currentFlow?.startsWith('convo:');

  // ====== PHONE NUMBER DETECTION (HOT LEAD!) ======
  // This runs before flow manager because it's a special case that triggers immediate handoff
  if (!isConvoFlowActive && classification.intent === 'phone_shared' && classification.entities?.phone) {
    const phone = classification.entities.phone;
    console.log(`📱 HOT LEAD! Phone number captured: ${phone}`);

    await updateConversation(psid, {
      'leadData.contact': phone,
      'leadData.contactType': 'phone',
      'leadData.capturedAt': new Date()
    });
    const { triggerHandoff } = require("../services/pushNotifications");
    await triggerHandoff(psid, `Cliente compartió su teléfono: ${phone}`);

    return {
      type: "text",
      text: "¡Perfecto! Anotado tu número. En un momento te contacta uno de nuestros asesores para atenderte personalmente.",
      handledBy: "phone_captured"
    };
  }
  // ====== END PHONE NUMBER DETECTION ======

  // ====== LINK NOT WORKING DETECTION ======
  // "No abre", "no habre", "no funciona el link", "no me abre", "no carga", "no puedo entrar"
  // When user says a link doesn't work, re-share the ORIGINAL ML URL directly
  // (the tracking redirect itself might be the problem, so bypass it)
  const linkNotWorkingPattern = /\b(no\s+(me\s+)?(abr[eé]|habre|carga|funciona|jala|sirve|deja|abre)|link.*(roto|malo|error)|no\s+puedo\s+(abrir|entrar|acceder|ver\s+el\s+link)|no\s+(entr[oa]|abr[oeéi])\s+(al|el|en)\s+(link|enlace))\b/i;
  if (!isConvoFlowActive && linkNotWorkingPattern.test(userMessage) && (convo?.lastSharedProductLink || convo?.lastProductLink)) {
    console.log(`🔗 Link not working detected, sharing original ML URL directly`);
    const originalUrl = convo.lastSharedProductLink || convo.lastProductLink;
    await updateConversation(psid, { lastIntent: "link_reshared", unknownCount: 0 });
    return {
      type: "text",
      text: `¡Disculpa! Aquí te comparto el enlace directo:\n\n${originalUrl}`
    };
  }
  // ====== END LINK NOT WORKING DETECTION ======

  // ====== TRUST / SCAM CONCERN PRE-CHECK ======
  // When a customer expresses fear of being scammed, reassure with ML buyer protection
  const trustConcernPattern = /\b(estaf\w*|me\s+robaron|fraude|timo|enga[ñn]\w*|desconfian\w*|no\s+conf[ií]\w*|conf[ií]ar|conf[ií]able|miedo|me\s+da\s+pendiente|es\s+segur[oa]|ser[áa]\s+segur[oa]|le\s+pienso|le\s+pienzo)\b/i;
  if (!isConvoFlowActive && trustConcernPattern.test(userMessage)) {
    console.log(`🛡️ Trust/scam concern detected, reassuring with ML buyer protection`);
    const { updateConversation } = require("../conversationManager");
    await updateConversation(psid, { lastIntent: "trust_concern_addressed" });
    return {
      type: "text",
      text: "Entiendo tu preocupación, y es muy válida. La compra se realiza por Mercado Libre, así que cuentas con su programa de *compra protegida*: si el producto no te llega, llega defectuoso o es diferente a lo que pediste, te devuelven tu dinero.\n\nAdemás somos fabricantes con más de 5 años vendiendo en Mercado Libre. ¿Te gustaría ver el producto?"
    };
  }
  // ====== END TRUST / SCAM CONCERN PRE-CHECK ======

  // ====== PAY ON DELIVERY PRE-CHECK ======
  // Regex safety net: if user clearly asks about cash-on-delivery, force pay_on_delivery_query
  // This prevents misclassification as generic payment_query (which doesn't say NO)
  const payOnDeliveryPattern = /\b(pago\s+(al\s+)?(recibir|entregar?)|contra\s*entrega|contraentrega|cuando\s+llegue\s+pago|al\s+recibir|la\s+pago\s+al\s+entregar|se\s+paga\s+al\s+(recibir|entregar?)|cobr[ao]\s+al\s+(recibir|entregar?))\b/i;
  if (!isConvoFlowActive && payOnDeliveryPattern.test(userMessage) && classification.intent !== INTENTS.MULTI_QUESTION) {
    // For multi-question messages, let the multi-question handler combine contra-entrega
    // with other responses (e.g., confirmation + payment). Only intercept single-intent messages.
    console.log(`💳 Pay-on-delivery question detected via regex, forcing explicit NO`);
    const logisticsHandlers = require("./handlers/logistics");
    const podResponse = await logisticsHandlers.handlePayOnDelivery({ psid, convo });
    if (podResponse) return podResponse;
  }
  // ====== END PAY ON DELIVERY PRE-CHECK ======

  // ====== INTENT DB HANDLING ======
  // Check if intent has a DB-configured response (auto_response, human_handoff, or ai_generate guidance)
  if (!isConvoFlowActive) {
    const intentResponse = await handleIntentFromDB(classification.intent, classification, psid, convo, userMessage);
    if (intentResponse) {
      console.log(`✅ Intent handled by DB config (${intentResponse.handledBy})`);
      return await checkForRepetition(intentResponse, psid, convo);
    }
  }
  // ====== END INTENT DB HANDLING ======

  // ====== MULTI-QUESTION HANDLER ======
  // Always available — flow context doesn't matter.
  // The AI splitter self-gates: returns null for single questions.
  const isMultiQuestion = classification.intent === INTENTS.MULTI_QUESTION ||
    (userMessage.match(/\?/g) || []).length >= 2 ||
    [
      /\b(precio|cu[aá]nto|cuesta|vale|costo)\b/i,
      /\b(env[ií][oa]s?|entrega|hacen\s+env[ií]os?)\b/i,
      /\b(pago|forma\s+de\s+pago|tarjeta|contra\s*entrega)\b/i,
      /\b((?:d[oó]nde|dnd)\s+est[aá]n|ubicaci[oó]n|direcci[oó]n)\b/i,
      /\b(instala|garant[ií]a|impermeable|material|durabilidad)\b/i,
      /\b(cu[aá]nto\s+tarda|tiempo\s+de\s+entrega)\b/i,
      /\d+(?:\.\d+)?\s*(?:[xX×*]|(?:metros?\s*)?por)\s*\d+/i,
    ].filter(p => p.test(userMessage)).length >= 3;

  if (!isConvoFlowActive && isMultiQuestion) {
    console.log(`📎 Multi-question detected (${classification.intent === INTENTS.MULTI_QUESTION ? 'classifier' : 'heuristic'}), using AI splitter`);
    const { handleMultiQuestion } = require("./utils/multiQuestionHandler");
    const mqResponse = await handleMultiQuestion(
      userMessage, psid, convo, sourceContext, campaign, campaignContext
    );
    if (mqResponse) {
      return await checkForRepetition(mqResponse, psid, convo);
    }
  }
  // ====== END MULTI-QUESTION HANDLER ======

  // ====== INTENT DISPATCHER — PRE-FLOW: only urgent/cross-cutting intents ======
  // These intents ALWAYS dispatch first regardless of flow:
  // frustration, human_request, complaint — customer needs immediate attention
  const ALWAYS_DISPATCH = new Set([
    "frustration", "human_request", "complaint", "out_of_stock_report"
  ]);

  const isLowConfidence = classification.confidence < 0.4 || classification.intent === 'unclear';

  if (!isConvoFlowActive && !isLowConfidence && ALWAYS_DISPATCH.has(classification?.intent)) {
    const urgentResponse = await dispatchToHandler(classification, { psid, convo, userMessage });
    if (urgentResponse) {
      console.log(`✅ Urgent intent handled by dispatcher (${urgentResponse.handledBy})`);
      return await checkForRepetition(urgentResponse, psid, convo);
    }
  }
  // ====== END PRE-FLOW DISPATCHER ======

  // ====== FLOW MANAGER - CENTRAL ROUTING (runs FIRST) ======
  // Product flows handle their own shipping, payment, location, wholesale, price, etc.
  // Scoring ALWAYS runs (detects tire-kickers, competitors)
  let response = null;

  try {
    response = await processWithFlowManager(userMessage, psid, convo, classification, sourceContext, campaign);

    if (response) {
      console.log(`✅ Flow manager handled message (${response.handledBy})`);
    }
  } catch (flowError) {
    console.error(`❌ Error in flow manager:`, flowError.message);
  }

  // ====== INTENT DISPATCHER — POST-FLOW FALLBACK ======
  // Only runs if the flow manager didn't handle the message.
  // Handles informational intents (color, shipping, payment, etc.) for the default flow
  // or when a product flow returns null.
  const INFORMATIONAL_INTENTS = new Set([
    "color_query", "shade_percentage_query", "eyelets_query",
    "shipping_query", "payment_query", "delivery_time_query",
    "shipping_included_query", "pay_on_delivery_query",
    "installation_query", "warranty_query", "structure_query",
    "durability_query", "custom_size_query", "accessory_query",
    "photo_request", "product_comparison", "catalog_request",
    "how_to_buy", "phone_request", "price_per_sqm", "bulk_discount", "reseller_inquiry",
    "price_confusion", "store_link_request", "custom_modification"
  ]);

  if (!response && !isLowConfidence) {
    const shouldDispatch = !convo?.pendingHandoff || INFORMATIONAL_INTENTS.has(classification?.intent);

    if (shouldDispatch) {
      const dispatcherResponse = await dispatchToHandler(classification, {
        psid,
        convo,
        userMessage
      });

      if (dispatcherResponse) {
        console.log(`✅ Intent handled by dispatcher fallback (${dispatcherResponse.handledBy})`);
        response = await checkForRepetition(dispatcherResponse, psid, convo);
      }
    }
  }
  // ====== END INTENT DISPATCHER FALLBACK ======

  // ====== CATCH-ALL PENDING HANDOFF (zip response from fallback-triggered handoffs) ======
  if (!response && convo?.pendingHandoff) {
    const { resumePendingHandoff } = require('./utils/executeHandoff');
    const pendingResult = await resumePendingHandoff(psid, convo, userMessage);
    if (pendingResult) response = pendingResult;
  }

  // ════════════════════════════════════════════════════════════════════════
  // 🛑 AI-FALLBACK-KILL-SWITCH — INTRODUCED 2026-06-02
  // ════════════════════════════════════════════════════════════════════════
  // The AI fallback (handleFallback) was the source of ~80% of customer-
  // facing hallucinations: invented prices, denied products we sell,
  // confused COD policy, and generally made things up when no handler
  // matched. We replaced it with an immediate human handoff.
  //
  // TO REVERT: replace the block below with the previous AI-fallback path:
  //   response = await handleFallback(userMessage, psid, convo, openai, BOT_PERSONA_NAME);
  //   if (!response) { /* static handoff */ }
  // Original code preserved in commit history. handleFallback() and its
  // dependencies (core/fallback.js, tryUnderstandMessage, etc.) remain in
  // the codebase — unused — for an easy revert.
  // ════════════════════════════════════════════════════════════════════════
  if (!response) {
    console.log(`🤝 No handler matched — direct human handoff (AI fallback disabled): "${userMessage}"`);
    const { executeHandoff } = require('./utils/executeHandoff');
    response = await executeHandoff(psid, convo, userMessage, {
      reason: 'No handler matched — handing off to specialist',
      responsePrefix: 'Déjame canalizarte con un asesor que pueda atenderte mejor. Te respondemos a la brevedad.',
      lastIntent: 'no_handler_handoff',
      timingStyle: 'standard'
    });
  }
  // ════════════════════════════════════════════════════════════════════════
  // END AI-FALLBACK-KILL-SWITCH
  // ════════════════════════════════════════════════════════════════════════

  // ====== PAY-ON-DELIVERY POST-CHECK ======
  // Safety net: if AI wrongly AFFIRMS we offer COD, REPLACE the response.
  // If it didn't address payment at all, APPEND a clarification.
  // Detection now AI-based (handles typos like "recivir") with regex fallback.
  let userAskingCOD_safety = false;
  if (response && response.text) {
    try {
      const { asksAboutCOD } = require('./utils/codIntent');
      userAskingCOD_safety = await asksAboutCOD(userMessage);
    } catch {
      userAskingCOD_safety = payOnDeliveryPattern.test(userMessage);
    }
  }
  if (response && response.text && (userAskingCOD_safety || payOnDeliveryPattern.test(userMessage))) {
    const isNonML = convo?.currentFlow === 'rollo' ||
      convo?.currentFlow === 'groundcover' ||
      convo?.currentFlow === 'monofilamento' ||
      convo?.productInterest === 'rollo' ||
      convo?.productInterest === 'groundcover' ||
      convo?.productInterest === 'monofilamento' ||
      convo?.isWholesaleInquiry;

    const correctAnswer = isNonML
      ? 'No manejamos pago contra entrega. El pago se realiza al ordenar, mediante transferencia o depósito bancario. La única excepción es si pasas por tu pedido directamente a nuestra planta en Querétaro: ahí sí puedes pagar en persona al recoger.'
      : 'No manejamos pago contra entrega. El pago se realiza al ordenar en Mercado Libre (tarjeta, OXXO, transferencia, meses sin intereses) y tu compra está protegida: si no recibes el artículo, se devuelve tu dinero. La única excepción es si pasas por tu pedido directamente a nuestra planta en Querétaro: ahí sí puedes pagar en persona al recoger.';

    const correctlyDenies = /\b(no\s+(manejamos|ofrecemos|tenemos|aceptamos)\s+(pago\s+)?contra\s*entrega|no\s+hay\s+(pago\s+)?contra\s*entrega|pago\s+(es|debe\s+ser|se\s+(hace|realiza))\s+(por\s+)?adelantad[ao]|pago\s+al\s+ordenar|pago\s+anticipad[ao])\b/i;
    const mentionsCOD = /\b(contra\s*entrega|contraentrega|pago\s+(al\s+)?(recibir|entregar?)|pago\s+a\s+la\s+entrega)\b/i.test(response.text);

    // Any mention of COD must be paired with an explicit denial. Otherwise
    // it's an affirmation, hedge, or ambiguity — all of which read as "yes
    // we have it" to the customer. Replace with the canonical denial.
    if (mentionsCOD && !correctlyDenies.test(response.text)) {
      console.log(`🛑 Post-check: response mentions COD without denial — replacing`);
      response.text = correctAnswer;
    } else if (!correctlyDenies.test(response.text)) {
      response.text += '\n\n' + correctAnswer;
      console.log(`💳 Post-check: appended contra-entrega clarification to response`);
    }
  }
  // ====== END PAY-ON-DELIVERY POST-CHECK ======

  // ====== LOCATION STATS QUESTION ======
  // Append zip code question to price quotes (responses with ML link)
  // Skip for convo_flow — it handles location gathering via its own retailFlow
  const isConvoFlow = response?.handledBy?.startsWith('convo_flow:');
  if (response && response.text && !isConvoFlow) {
    const statsResult = await appendStatsQuestionIfNeeded(response.text, convo, psid, userMessage);
    if (statsResult.askedStats) {
      response.text = statsResult.text;
    }
  }
  // ====== END LOCATION STATS QUESTION ======

  // ====== SHADE PERCENTAGE TRUTH CHECK ======
  // Hanlob only sells 90% (confeccionada) and 35/50/70/80% (rollos). If the AI
  // affirmed any other percentage from the customer's message, replace the
  // response with a correction. The bot is here to correct, not to humor.
  if (response && response.text) {
    const VALID_PERCENTAGES = new Set([35, 50, 70, 80, 90]);
    // Match "X% de sombra" / "cubre el X%" / "al X% de sombra" / "X porciento"
    const pctRegex = /\b(\d{2,3})\s*(?:%|por\s*cient[oa]s?|porcient[oa]s?)/gi;
    const matches = [...response.text.matchAll(pctRegex)].map(m => parseInt(m[1], 10));
    const bogusPercentage = matches.find(p => p >= 30 && p <= 100 && !VALID_PERCENTAGES.has(p));

    if (bogusPercentage) {
      // Check the AI text is affirmatively talking about the bogus % as ours
      const lower = response.text.toLowerCase();
      const affirmsBogus = new RegExp(`(cubre|tenemos|ofrecemos|manejamos|disponible|al)\\s+(el\\s+|al\\s+|del\\s+)?${bogusPercentage}\\s*(%|por\\s*cient|porcient)`, 'i').test(lower);

      if (affirmsBogus) {
        console.log(`🛑 Post-check: AI affirmed ${bogusPercentage}% — we don't sell that. Replacing.`);
        response.text = `Nuestra malla sombra cubre 90% (confeccionada, lista para instalar) y también la tenemos en rollos al 35%, 50%, 70% y 80%. No manejamos otros porcentajes. ¿Cuál te sirve para tu uso?`;
      }
    }
  }
  // ====== END SHADE PERCENTAGE TRUTH CHECK ======

  // ====== GLOBAL PRICE TRUTH CHECK ======
  // Every "$X" the bot mentions must match a real product price in our DB
  // (any sellable ProductFamily, any Product variant, OR the live ML price
  // of any product). This is the catch-all that finally enforces the
  // "NO TE INVENTES PRECIOS" rule across every code path — including the
  // AI fallback which has no per-flow validation. If a quoted price has no
  // match, the response gets replaced with a safe deterministic message.
  if (response && response.text) {
    try {
      // Pull every "$X" the bot wrote (ignore amounts < $50 — those are usually
      // discount %, weights, etc., not product prices)
      const priceMatches = [...response.text.matchAll(/\$\s?(\d{2,5}(?:[.,]\d{1,2})?)/g)]
        .map(m => Math.round(parseFloat(m[1].replace(',', '.'))))
        .filter(p => p >= 50);

      if (priceMatches.length > 0) {
        // Cache the catalog prices for 5 min so this doesn't hit DB on every msg
        if (!global._priceCatalogCache || Date.now() > global._priceCatalogCache.expiresAt) {
          const PF = require('../models/ProductFamily');
          const Product = require('../models/Product');
          const [families, products] = await Promise.all([
            PF.find({}).select('price mlPrice').lean(),
            Product.find({}).select('price').lean()
          ]);
          const all = new Set();
          for (const f of families) {
            if (f.price) all.add(Math.round(f.price));
            if (f.mlPrice) all.add(Math.round(f.mlPrice));
          }
          for (const p of products) {
            if (p.price) all.add(Math.round(p.price));
          }
          global._priceCatalogCache = { prices: all, expiresAt: Date.now() + 5 * 60 * 1000 };
        }
        const validPrices = global._priceCatalogCache.prices;

        // Any price ±$2 of a real product is OK. Anything else = invented.
        const isPriceValid = (p) => {
          for (const vp of validPrices) {
            if (Math.abs(vp - p) <= 2) return true;
          }
          return false;
        };
        const bogusPrice = priceMatches.find(p => !isPriceValid(p));

        if (bogusPrice) {
          console.warn(`🛑 Global price check: \$${bogusPrice} doesn't match ANY product in catalog. Replacing response.`);
          // Don't let the AI keep lying. Hand off to a human who can quote.
          const { executeHandoff } = require('./utils/executeHandoff');
          response = await executeHandoff(psid, convo, userMessage, {
            reason: 'AI quoted invented price — handoff for accurate quote',
            responsePrefix: 'Déjame confirmarte el precio exacto con un especialista, es solo un momento.',
            lastIntent: 'invented_price_handoff',
            timingStyle: 'standard'
          });
        }
      }
    } catch (err) {
      console.error('❌ Global price truth check error:', err.message);
    }
  }
  // ====== END GLOBAL PRICE TRUTH CHECK ======

  // ====== PHONE GUARD ======
  // Hard backstop: never let a fabricated phone number reach the customer.
  // Any phone-shaped number that isn't one of our real CompanyInfo numbers
  // gets replaced. Covers every path that produced this `response`.
  if (response && response.text) {
    try {
      const { sanitizePhones } = require("./utils/phoneGuard");
      response.text = await sanitizePhones(response.text);
    } catch (e) {
      console.error("⚠️ phoneGuard failed:", e.message);
    }
  }
  // ====== END PHONE GUARD ======

  // Check for repetition and escalate if needed
  return await checkForRepetition(response, psid, convo);
}

module.exports = { generateReply };
