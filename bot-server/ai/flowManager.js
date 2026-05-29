// ai/flowManager.js
// Central flow manager — all messages go through here.
// After the legacy cleanup, this file is responsible for ONE thing:
// routing messages to the correct registered convo_flow.
//
// Cold-start / non-convoFlowRef conversations fall through (return null) and
// are handled by the AI fallback in ai/index.js.

const { updateConversation } = require("../conversationManager");
const ProductFamily = require("../models/ProductFamily");
const Ad = require("../models/Ad");
const Campaign = require("../models/Campaign");
const CrossSellRule = require("../models/CrossSellRule");
const { getOrCreateClickLink } = require("../tracking");

// Convo_flow system
const convoFlow = require("./flows/convoFlow");

// Load ALL convo_flows from DB at startup
const ConvoFlowManifest = require("../models/ConvoFlowManifest");

async function loadConvoFlowsFromDB() {
  try {
    const manifests = await ConvoFlowManifest.find({ active: true });
    let loaded = 0;
    for (const doc of manifests) {
      const manifest = doc.toObject();
      const instance = convoFlow.create(manifest);
      convoFlow.registerFlow(doc.name, {
        manifest,
        handle: instance.handle,
        getProductCache: instance.getProductCache
      });
      loaded++;
    }
    if (loaded > 0) console.log(`✅ Loaded ${loaded} convo_flows from DB`);
  } catch (err) {
    console.error('❌ Failed to load convo_flows from DB:', err.message);
  }
}

const mongoose = require("mongoose");
mongoose.connection.once('open', () => {
  loadConvoFlowsFromDB();
});
if (mongoose.connection.readyState === 1) {
  loadConvoFlowsFromDB();
}

// ─── CATALOG LOOKUP UTILITIES ──────────────────────────────────────────────
// Used externally by handlers/purchase.js, handlers/products.js,
// jobs/silenceFollowUp.js, and resellerFlow_v2.js.

let familyCatalogCache = {};
let familyCatalogCacheExpiry = 0;
const CATALOG_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Map convo_flow names to root product family name patterns for catalog lookup.
const CONVO_FLOW_TO_FAMILY_REGEX = {
  'convo_rolloRaschelWholesale': /rollo|malla.*sombra.*raschel/i,
  'convo_confeccionadaRetail': /malla.*sombra.*confeccionada/i,
  'convo_vende_malla': /malla.*sombra.*confeccionada/i,
  'convo_bordeSeparadorRetail': /borde.*separador|cinta.*pl[aá]stica/i,
  'convo_bordeSeparadorWholesale': /borde.*separador|cinta.*pl[aá]stica/i,
  'convo_groundcoverWholesale': /ground.*cover|antimaleza/i,
  'convo_promo6x4': /malla.*sombra.*confeccionada/i
};

/**
 * Fix Cloudinary raw URLs missing file extension (causes download instead of display).
 */
function fixCatalogUrl(url) {
  if (url && url.includes('/raw/upload/') && !/\.\w{2,4}$/.test(url)) {
    return url + '.pdf';
  }
  return url;
}

async function getProductFamilyCatalog(flow) {
  const key = (flow || '').replace(/^convo:/, '');
  const regex = CONVO_FLOW_TO_FAMILY_REGEX[key];
  if (!regex) return null;

  if (familyCatalogCache[key] && Date.now() < familyCatalogCacheExpiry) {
    return familyCatalogCache[key];
  }

  try {
    const family = await ProductFamily.findOne({
      name: regex,
      parentId: null,
      'catalog.url': { $exists: true, $ne: null }
    }).select('catalog name').lean();

    const url = family?.catalog?.url || null;
    familyCatalogCache[key] = url;
    familyCatalogCacheExpiry = Date.now() + CATALOG_CACHE_TTL;

    if (url) console.log(`📄 Found catalog from ProductFamily "${family.name}": ${url}`);
    return url;
  } catch (err) {
    console.error("Error looking up family catalog:", err.message);
    return null;
  }
}

/**
 * Look up catalog URL with hierarchy: Ad → Campaign → Product Family → Global → null
 */
async function getCatalogUrl(convo, currentFlow) {
  try {
    let url = null;
    if (convo?.adId) {
      const ad = await Ad.findOne({ fbAdId: convo.adId }).select('catalog').lean();
      if (ad?.catalog?.url) url = ad.catalog.url;
    }
    if (!url && convo?.campaignId) {
      const campaign = await Campaign.findOne({ fbCampaignId: convo.campaignId }).select('catalog').lean();
      if (campaign?.catalog?.url) url = campaign.catalog.url;
    }
    if (!url) {
      const flow = currentFlow || convo?.currentFlow;
      if (flow) {
        const familyCatalog = await getProductFamilyCatalog(flow);
        if (familyCatalog) url = familyCatalog;
      }
    }
    if (!url) {
      const { getBusinessInfo } = require("../businessInfoManager");
      const bizInfo = await getBusinessInfo();
      if (bizInfo?.catalog?.url) url = bizInfo.catalog.url;
    }
    return fixCatalogUrl(url);
  } catch (err) {
    console.error("Error looking up catalog:", err.message);
  }
  return null;
}

// ─── MESSAGE PROCESSING ────────────────────────────────────────────────────

/**
 * Process an incoming message and route it to the correct convo_flow.
 *
 * Cold-start / non-convoFlowRef conversations return null and are handled
 * by the AI fallback in ai/index.js.
 *
 * @returns {Promise<object|null>} response or null
 */
async function processMessage(userMessage, psid, convo, classification, sourceContext, campaign = null) {
  console.log(`\n🎯 ===== FLOW MANAGER =====`);

  // ─── Resolve which convo_flow handles this conversation ──
  let ref = sourceContext?.ad?.convoFlowRef || convo?.convoFlowRef;

  // ─── COLD-START INTENT INFERENCE ──
  // For conversations without an ad-bound convoFlowRef, infer a flow from
  // the user message itself. This rescues direct-message customers asking
  // about rolls / groundcover / confeccionada from the AI fallback
  // (which gives a generic store link instead of routing properly).
  if (!ref) {
    const lower = (userMessage || '').toLowerCase();

    // Rollo intent: explicit "rollo" mention OR malla sombra at any non-90%
    // percentage (35/50/70/80). Confeccionada is 90% only — anything else
    // means rolls, which are wholesale.
    const mentionsRollo = /\b(rollo|rollos|el\s+rollo|en\s+rollo|por\s+rollo)\b/i.test(lower);
    const pctMatch = lower.match(/\b(\d{2,3})\s*%/);
    const nonNinetyPercent = pctMatch && [35, 50, 70, 80].includes(parseInt(pctMatch[1], 10));

    // Confeccionada intent: a dimension mention is enough — Hanlob only sells
    // malla sombra, so any "NxM" / "N metros x M metros" is asking for a
    // confeccionada size. Routes to convo_confeccionadaRetail, which then
    // handles catalog match / oversize / size_not_found via dimension_handoff
    // (instead of the AI fallback fabricating a quote).
    const hasDimension = /\b\d{1,2}\s*[xX×]\s*\d{1,2}\b|\d{1,2}\s*(?:m|mt|mts|mtrs?|metros?)\s*(?:x|por|×)\s*\d{1,2}\s*(?:m|mt|mts|mtrs?|metros?)?/i.test(lower);

    if (mentionsRollo || nonNinetyPercent) {
      console.log(`🎯 Cold-start intent → rollo wholesale (mentionsRollo=${mentionsRollo}, nonNinetyPct=${nonNinetyPercent})`);
      ref = 'convo_rolloRaschelWholesale';
    } else if (hasDimension) {
      console.log(`🎯 Cold-start intent → confeccionada retail (dimension detected)`);
      ref = 'convo_confeccionadaRetail';
    }

    if (ref) {
      await updateConversation(psid, { convoFlowRef: ref, currentFlow: `convo:${ref}` });
      convo.convoFlowRef = ref;
      convo.currentFlow = `convo:${ref}`;
    }
  }

  if (!ref) {
    console.log(`🎯 No convoFlowRef — falling through to AI fallback`);
    console.log(`🎯 ===== END FLOW MANAGER =====\n`);
    return null;
  }

  const convoFlowInstance = convoFlow.getFlow(ref);
  if (!convoFlowInstance) {
    console.error(`❌ convoFlowRef set but flow not registered: ${ref}`);
    console.log(`🎯 ===== END FLOW MANAGER =====\n`);
    return null;
  }

  // ─── Persist normalized currentFlow if it's stale ──
  const expected = `convo:${ref}`;
  if (convo?.currentFlow !== expected) {
    await updateConversation(psid, { currentFlow: expected, convoFlowRef: ref });
    convo.currentFlow = expected;
    convo.convoFlowRef = ref;
  }

  // ─── Clear stale flags from previous (legacy) sessions that would hijack
  //     responses in ai/index.js ──
  const staleFlags = {};
  if (convo?.pendingHandoff) staleFlags.pendingHandoff = false;
  if (convo?.pendingHandoffInfo) staleFlags.pendingHandoffInfo = null;
  if (convo?.pendingLocationResponse) staleFlags.pendingLocationResponse = false;
  if (convo?.pendingShippingLocation) staleFlags.pendingShippingLocation = false;
  if (convo?.pendingFlowChange) { staleFlags.pendingFlowChange = null; staleFlags.pendingFlowChangeReason = null; }
  if (convo?.pendingWholesaleRetailChoice) staleFlags.pendingWholesaleRetailChoice = null;
  if (Object.keys(staleFlags).length > 0) {
    await updateConversation(psid, staleFlags);
    Object.assign(convo, staleFlags);
  }

  console.log(`✅ Routing to convo_flow: ${ref}`);

  try {
    const convoFlowState = convo?.convoFlowState || {};

    // Promo plugin injection — if the ad (or conversation) carries a promo, surface it.
    const adPromo = sourceContext?.ad?.promo || convo?.adPromo;
    if (adPromo) {
      convoFlowState._adPromo = adPromo;
    }

    const { response, state, switchTo, switchState } = await convoFlowInstance.handle(
      userMessage, convo, psid, convoFlowState
    );

    // Persist updated state
    const stateUpdate = { convoFlowState: state };

    // Handle seamless flow switch
    if (switchTo) {
      stateUpdate.convoFlowRef = switchTo;
      stateUpdate.currentFlow = `convo:${switchTo}`;
      stateUpdate.convoFlowState = switchState || {};
      console.log(`🔀 Seamless switch → ${switchTo}`);
    }

    await updateConversation(psid, stateUpdate);

    if (switchTo) {
      await updateConversation(psid, {
        $push: { flowHistory: { flow: `convo:${switchTo}`, at: new Date(), trigger: 'seamless_switch', from: ref } }
      });
    }

    // Seamless switch with no response — re-invoke the TARGET flow so the user gets an immediate answer
    if (switchTo && !response) {
      const targetFlowInstance = convoFlow.getFlow(switchTo);
      if (targetFlowInstance) {
        console.log(`🔀 Re-invoking target flow ${switchTo} with current message`);
        convo.currentFlow = `convo:${switchTo}`;
        convo.convoFlowRef = switchTo;
        const targetResult = await targetFlowInstance.handle(userMessage, convo, psid, switchState || {});
        if (targetResult?.response) {
          await updateConversation(psid, { convoFlowState: targetResult.state });
          console.log(`🎯 ===== END FLOW MANAGER (after seamless switch to ${switchTo}) =====\n`);
          return { ...targetResult.response, handledBy: `convo_flow:${switchTo}` };
        }
      }
    }

    if (response) {
      // ── CROSS-SELL CHECK ──
      // After the bot responds, check if conditions are right for a cross-sell offer:
      // 1. A product link was previously shared (lastSharedProductId exists)
      // 2. The customer just responded positively (sí, gracias, zip code, etc.)
      // 3. We haven't already made a cross-sell offer for this product
      // 4. There's an active CrossSellRule matching the shared product
      try {
        // Skip cross-sell entirely for flagged conversations (angry, opted-out, etc.)
        if (convo?.doNotFollowUp) return response;

        const hasSharedProduct = convo?.lastSharedProductId;
        const alreadyOffered = state?.crossSellOffered === convo?.lastSharedProductId;

        if (hasSharedProduct && !alreadyOffered && response.type === 'text') {
          const isPositive = /\b(s[ií]|va|dale|gracias|claro|ok|bueno|perfecto|por\s*favor|xfavor|xfa|de\s*acuerdo)\b/i.test(userMessage);
          const isZipCode = /^\d{5}$/.test(userMessage.trim());

          if (isPositive || isZipCode) {
            // Walk up the product family tree to find rules at any ancestor level
            const productId = convo.lastSharedProductId;
            const ancestorIds = [productId];
            let currentFam = await ProductFamily.findById(productId).select('parentId').lean();
            while (currentFam?.parentId) {
              ancestorIds.push(String(currentFam.parentId));
              currentFam = await ProductFamily.findById(currentFam.parentId).select('parentId').lean();
            }

            const rule = await CrossSellRule.findOne({
              sourceProductFamilyId: { $in: ancestorIds },
              active: true
            }).sort({ priority: -1 }).populate('targetProductFamilyId', 'name onlineStoreLinks').lean();

            if (rule && rule.targetProductFamilyId) {
              const targetProduct = rule.targetProductFamilyId;
              const targetName = targetProduct.name;

              // Generate a tracked link for the cross-sell product if available
              const targetUrl = targetProduct.onlineStoreLinks?.find(l => l.isPreferred)?.url
                || targetProduct.onlineStoreLinks?.[0]?.url;

              let crossSellText = rule.message || `Los clientes que compran este producto también suelen llevar ${targetName}. ¿Te interesa?`;

              if (targetUrl) {
                const trackedLink = await getOrCreateClickLink(psid, targetUrl, {
                  productName: targetName,
                  productId: String(rule.targetProductFamilyId._id),
                  reason: 'cross_sell',
                  crossSellRuleId: String(rule._id)
                });
                crossSellText += `\n\n🛒 ${targetName}:\n${trackedLink}`;
              }

              // Append to the response
              response.text += `\n\n${crossSellText}`;

              // Mark as offered so we don't repeat
              state.crossSellOffered = convo.lastSharedProductId;
              state.crossSellRuleId = String(rule._id);
              await updateConversation(psid, { convoFlowState: state });

              // Increment offered counter
              await CrossSellRule.updateOne(
                { _id: rule._id },
                { $inc: { 'stats.offered': 1 }, $set: { 'stats.lastOfferedAt': new Date() } }
              );

              console.log(`🔄 Cross-sell offered: ${rule.name} (rule ${rule._id})`);
            }
          }
        }
      } catch (crossSellErr) {
        console.error(`⚠️ Cross-sell check error (non-blocking):`, crossSellErr.message);
      }

      console.log(`🎯 ===== END FLOW MANAGER (handled by convo_flow:${ref}) =====\n`);
      return { ...response, handledBy: `convo_flow:${ref}` };
    }
  } catch (error) {
    console.error(`❌ Error in convo_flow ${ref}:`, error.message);
    console.error(error.stack);
  }

  console.log(`🎯 ===== END FLOW MANAGER (not handled) =====\n`);
  return null;
}

module.exports = {
  processMessage,
  getCatalogUrl,
  fixCatalogUrl
};
