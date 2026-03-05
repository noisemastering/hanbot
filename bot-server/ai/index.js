// ai/index.js
require("dotenv").config();
const { OpenAI } = require("openai");
const { getConversation, updateConversation } = require("../conversationManager");
const Campaign = require("../models/Campaign");

const { handleFallback } = require("./core/fallback");
const { identifyAndSetProduct } = require("./utils/productIdentifier");
const { lockPOI, checkVariantExists } = require("./utils/productTree");
const { handleLocationStatsResponse, appendStatsQuestionIfNeeded, shouldAskLocationStatsNow } = require("./utils/locationStats");

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

// Layer 2-3: Flow Router (legacy - being replaced by flowManager)
const { processMessage: processWithFlows } = require("./flows");

// NEW: Central Flow Manager - ALL messages go through here
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
 * Main entry point for generating bot responses.
 * Uses pipeline when USE_PIPELINE=true, otherwise uses the monolith.
 */
async function generateReply(userMessage, psid, referral = null) {
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
        silenceFollowUpAt: null
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
  if (convo.state === "needs_human") {
    console.log("🚨 Conversation is waiting for human (needs_human state)");

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

  // 📊 LOCATION STATS: Check if user is answering our "de qué ciudad?" question
  if (convo.pendingLocationResponse) {
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
      if (location.zipcode) convoUpdate.zipcode = location.zipcode;
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
  // Set currentFlow from ad context so the ad's flow governs the whole conversation
  if (!convo.currentFlow || convo.currentFlow === 'default') {
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
      await updateConversation(psid, { isWholesaleInquiry: true });
      convo.isWholesaleInquiry = true;
      console.log(`🏪 Reseller audience detected from campaign "${campaign.name}" — marking as wholesale`);
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

  // ====== PHONE NUMBER DETECTION (HOT LEAD!) ======
  // This runs before flow manager because it's a special case that triggers immediate handoff
  if (classification.intent === 'phone_shared' && classification.entities?.phone) {
    const phone = classification.entities.phone;
    console.log(`📱 HOT LEAD! Phone number captured: ${phone}`);

    await updateConversation(psid, {
      'leadData.contact': phone,
      'leadData.contactType': 'phone',
      'leadData.capturedAt': new Date(),
      handoffRequested: true,
      handoffReason: `Cliente compartió su teléfono: ${phone}`,
      handoffTimestamp: new Date(),
      state: "needs_human"
    });

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
  if (linkNotWorkingPattern.test(userMessage) && (convo?.lastSharedProductLink || convo?.lastProductLink)) {
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
  if (trustConcernPattern.test(userMessage)) {
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
  if (payOnDeliveryPattern.test(userMessage) && classification.intent !== INTENTS.MULTI_QUESTION) {
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
  const intentResponse = await handleIntentFromDB(classification.intent, classification, psid, convo, userMessage);
  if (intentResponse) {
    console.log(`✅ Intent handled by DB config (${intentResponse.handledBy})`);
    return await checkForRepetition(intentResponse, psid, convo);
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
      /\b(d[oó]nde\s+est[aá]n|ubicaci[oó]n|direcci[oó]n)\b/i,
      /\b(instala|garant[ií]a|impermeable|material|durabilidad)\b/i,
      /\b(cu[aá]nto\s+tarda|tiempo\s+de\s+entrega)\b/i,
      /\d+(?:\.\d+)?\s*(?:[xX×*]|(?:metros?\s*)?por)\s*\d+/i,
    ].filter(p => p.test(userMessage)).length >= 3;

  if (isMultiQuestion) {
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

  // ====== INTENT DISPATCHER - AI-FIRST ROUTING ======
  // Route classified intents to pure business logic handlers
  // This runs BEFORE flows - handles intents that don't need multi-step flow processing
  // Examples: color_query, frustration, phone_request, human_request, etc.
  // During pendingHandoff (waiting for zip/city), only dispatch informational FAQ intents
  // — anything that's clearly a question, not a zip/city response
  const INFORMATIONAL_INTENTS = new Set([
    "color_query", "shade_percentage_query", "eyelets_query",
    "shipping_query", "payment_query", "delivery_time_query",
    "shipping_included_query", "pay_on_delivery_query",
    "installation_query", "warranty_query", "structure_query",
    "durability_query", "custom_size_query", "accessory_query",
    "photo_request", "product_comparison", "catalog_request",
    "how_to_buy", "phone_request", "price_per_sqm", "bulk_discount",
    "frustration", "human_request", "complaint", "out_of_stock_report",
    "price_confusion", "store_link_request", "custom_modification"
  ]);

  // Skip dispatcher when confidence is low — a wrong intent routed to a handler gives bad answers
  const isLowConfidence = classification.confidence < 0.4 || classification.intent === 'unclear';
  if (isLowConfidence) {
    console.log(`🤔 Low confidence (${classification.confidence}) / unclear — skipping dispatcher, will try flow manager then AI fallback`);
  }

  // Skip logistics intents when message has product keywords + dimensions
  // Let the flow manager handle the full product request (including shipping/payment sub-questions)
  const LOGISTICS_INTENTS_SKIP = new Set(['shipping_query', 'location_query', 'delivery_time_query', 'shipping_included_query', 'payment_query']);
  const hasProductWithDimensions = /\b(rollo|malla|sombra|borde|groundcover|monofilamento)\b/i.test(userMessage) &&
    /\d+(?:\.\d+)?\s*(?:[xX×*]|(?:metros?\s*)?por)\s*\d+/i.test(userMessage);
  const skipForProduct = hasProductWithDimensions && LOGISTICS_INTENTS_SKIP.has(classification?.intent);
  if (skipForProduct) {
    console.log(`📦 Product + dimensions detected with ${classification.intent} — skipping dispatcher, letting flow manager handle`);
  }

  const shouldDispatch = !isLowConfidence && !skipForProduct && (!convo?.pendingHandoff || INFORMATIONAL_INTENTS.has(classification?.intent));

  if (shouldDispatch) {
    const dispatcherResponse = await dispatchToHandler(classification, {
      psid,
      convo,
      userMessage
    });

    if (dispatcherResponse) {
      console.log(`✅ Intent handled by dispatcher (${dispatcherResponse.handledBy})`);
      return await checkForRepetition(dispatcherResponse, psid, convo);
    }
  } else if (!isLowConfidence) {
    console.log(`⏭️ Skipping dispatcher - pendingHandoff active, letting flow handle zip/city response`);
  }
  // ====== END INTENT DISPATCHER ======

  // ====== FLOW MANAGER - CENTRAL ROUTING ======
  // ALL messages go through the flow manager
  // - Scoring ALWAYS runs (detects tire-kickers, competitors)
  // - Routes to appropriate flow (default, malla, rollo, etc.)
  // - Handles flow transfers when product is detected
  let response = null;

  try {
    response = await processWithFlowManager(userMessage, psid, convo, classification, sourceContext, campaign);

    if (response) {
      console.log(`✅ Flow manager handled message (${response.handledBy})`);
    }
  } catch (flowError) {
    console.error(`❌ Error in flow manager:`, flowError.message);
  }

  // ====== FALLBACK: Legacy flows if flow manager didn't handle ======
  if (!response) {
    try {
      response = await processWithFlows(classification, sourceContext, convo, psid, userMessage, campaign);
      if (response) {
        console.log(`✅ Legacy flow system handled message (${response.handledBy})`);
      }
    } catch (legacyError) {
      console.error(`❌ Error in legacy flows:`, legacyError.message);
    }
  }

  // ====== CATCH-ALL PENDING HANDOFF (zip response from fallback-triggered handoffs) ======
  if (!response && convo?.pendingHandoff) {
    const { resumePendingHandoff } = require('./utils/executeHandoff');
    const pendingResult = await resumePendingHandoff(psid, convo, userMessage);
    if (pendingResult) response = pendingResult;
  }

  // ====== FINAL FALLBACK — AI-POWERED ======
  if (!response) {
    console.log(`🔴 No handler matched, escalating to AI fallback: "${userMessage}"`);
    try {
      response = await handleFallback(userMessage, psid, convo, openai, BOT_PERSONA_NAME);
    } catch (fbErr) {
      console.error(`❌ handleFallback error:`, fbErr.message);
    }

    // If AI fallback also failed, use static last resort
    if (!response) {
      const { executeHandoff } = require('./utils/executeHandoff');
      response = await executeHandoff(psid, convo, userMessage, {
        reason: 'Static fallback handoff',
        responsePrefix: 'Déjame comunicarte con un especialista que pueda ayudarte mejor.\n\n',
        lastIntent: 'fallback_handoff'
      });
    }
  }

  // ====== PAY-ON-DELIVERY POST-CHECK ======
  // If user mentioned contra-entrega but the response doesn't address it, append clarification.
  // This is a safety net that covers ALL paths (active flow, multi-question, dispatcher, etc.)
  if (response && response.text && payOnDeliveryPattern.test(userMessage)) {
    if (!/contra\s*entrega|no manejamos.*(pago|contra)|pago.*(adelantado|al\s+ordenar)/i.test(response.text)) {
      const isNonML = convo?.currentFlow === 'rollo' ||
        convo?.currentFlow === 'groundcover' ||
        convo?.currentFlow === 'monofilamento' ||
        convo?.productInterest === 'rollo' ||
        convo?.productInterest === 'groundcover' ||
        convo?.productInterest === 'monofilamento' ||
        convo?.isWholesaleInquiry;

      const contraEntregaNote = isNonML
        ? 'Sobre el pago: no manejamos contra entrega. El pago es 100% por adelantado a través de transferencia o depósito bancario.'
        : 'Sobre el pago: no manejamos contra entrega. El pago es 100% por adelantado al momento de ordenar en Mercado Libre. Tu compra está protegida: si no te llega o llega diferente, se te devuelve tu dinero.';

      response.text += '\n\n' + contraEntregaNote;
      console.log(`💳 Post-check: appended contra-entrega clarification to response`);
    }
  }
  // ====== END PAY-ON-DELIVERY POST-CHECK ======

  // ====== LOCATION STATS QUESTION ======
  // Append "de qué ciudad nos escribes?" if we're sending an ML link
  // and haven't asked yet
  if (response && response.text) {
    const statsResult = await appendStatsQuestionIfNeeded(response.text, convo, psid);
    if (statsResult.askedStats) {
      response.text = statsResult.text;
    }
  }
  // ====== END LOCATION STATS QUESTION ======

  // ====== DEFERRED ZIP CODE QUESTION ======
  // If previous message set shouldAskLocationStats, append the question now
  if (response && response.text && shouldAskLocationStatsNow(convo)) {
    response.text += '\n\n¿Me puedes compartir tu código postal para fines estadísticos?';
    await updateConversation(psid, {
      askedLocationStats: true,
      shouldAskLocationStats: false,
      pendingLocationResponse: true
    });
  }
  // ====== END DEFERRED ZIP CODE QUESTION ======

  // Check for repetition and escalate if needed
  return await checkForRepetition(response, psid, convo);
}

module.exports = { generateReply };
