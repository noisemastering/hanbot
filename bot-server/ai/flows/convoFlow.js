// ai/flows/convoFlow.js
// The convo_flow shell — the only flow type that can drive a conversation.
// Assembles model flows together based on its manifest.
// All specific convo_flows (convo_mallaRetail, convo_promo6x4, etc.) are instances of this.
//
// Flow-switching protocol: see FLOW_SWITCHING_PROTOCOL.md

const { OpenAI } = require("openai");
const masterFlow = require("./masterFlow");
const productFlow = require("./productFlow");
const retailFlow = require("./retailFlow");
const wholesaleFlow = require("./wholesaleFlow");
const buyerFlow = require("./buyerFlow");
const resellerFlow_v2 = require("./resellerFlow_v2");
const promoFlow = require("./promoFlow");
const { updateConversation } = require("../../conversationManager");
const { executeHandoff } = require("../utils/executeHandoff");

const _openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

// ── FLOW REGISTRY (loaded once) ──
// All registered convo_flows. Populated by registerFlow().
const _registry = new Map();

/**
 * Register a convo_flow so it can be found during flow switches.
 * @param {string} name - manifest name
 * @param {Object} flowModule - { manifest, handle }
 */
function registerFlow(name, flowModule) {
  _registry.set(name, flowModule);
}

/**
 * Get all registered manifests except the current one.
 * @param {string} excludeName - current flow name to exclude
 * @returns {Array<Object>}
 */
function getOtherManifests(excludeName) {
  const manifests = [];
  for (const [name, mod] of _registry) {
    if (name !== excludeName && mod.manifest) {
      manifests.push(mod.manifest);
    }
  }
  return manifests;
}

/**
 * Find registered flows that handle a specific product.
 * @param {string} productId
 * @param {string} excludeName - current flow name
 * @returns {Array<Object>} matching manifests
 */
function findFlowsForProduct(productId, excludeName) {
  const matches = [];
  for (const [name, mod] of _registry) {
    if (name === excludeName) continue;
    if (mod.manifest?.products?.some(p => String(p) === String(productId))) {
      matches.push(mod.manifest);
    }
  }
  return matches;
}

/**
 * Find a registered flow by manifest name.
 * @param {string} name
 * @returns {Object|null} { manifest, handle }
 */
function getFlow(name) {
  return _registry.get(name) || null;
}

/**
 * Resolve a flow_switch result according to the switching protocol.
 * @param {Object} switchResult - { type: 'flow_switch', action, reason, targetFlow?, targetFlowName? }
 * @param {Object} currentManifest - current convo_flow manifest
 * @param {Object} flowState - current state (basket, clientData, etc.)
 * @param {string} userMessage
 * @param {Object} convo
 * @param {string} psid
 * @returns {Promise<{ response: Object, state: Object, switchTo?: string }>}
 */
async function resolveFlowSwitch(switchResult, currentManifest, flowState, userMessage, convo, psid) {
  const action = switchResult.action;
  const carryState = {
    basket: flowState.basket,
    clientData: flowState.clientData,
    comesFromFlowSwitch: true
  };

  // ── DIFFERENT PRODUCT (Protocol #1) ──
  if (action === 'product_redirect') {
    // product_flow already identified the target flow
    if (switchResult.targetFlow) {
      const targetName = switchResult.targetFlowName;
      const targetFlow = getFlow(targetName);

      if (targetFlow) {
        // Check if product exists on multiple flows — offer alternatives
        const alternatives = getOtherManifests(currentManifest.name)
          .filter(m => m.name !== targetName);

        // Single match — ask client to confirm
        console.log(`🔀 [switch] Product redirect → ${targetName}`);
        return {
          response: {
            type: 'flow_switch_pending',
            action: 'product_redirect',
            targetFlow: targetName,
            message: `Te puedo ayudar con eso.`
          },
          state: { ...flowState, pendingSwitch: { targetFlow: targetName, carryState } }
        };
      }
    }

    // No target found — hand off to human
    return {
      response: await executeHandoff(psid, convo, userMessage, {
        reason: 'Producto solicitado no disponible en ningún flujo',
        responsePrefix: 'Ese producto no lo tenemos disponible en línea, te comunico con un especialista.',
        lastIntent: 'switch_handoff',
        timingStyle: 'elaborate'
      }),
      state: flowState
    };
  }

  // ── DIFFERENT VOICE — Buyer ↔ Reseller (Protocol #2) ──
  if (action === 'reseller' || action === 'buyer') {
    const targetProfile = action;
    // Find a flow with the same products but the intended voice
    const candidates = [];
    for (const [name, mod] of _registry) {
      if (name === currentManifest.name) continue;
      const m = mod.manifest;
      if (!m) continue;
      const sameProducts = currentManifest.products.some(p =>
        m.products?.some(mp => String(mp) === String(p))
      );
      if (sameProducts && m.clientProfile === targetProfile) {
        candidates.push(m);
      }
    }

    if (candidates.length > 0) {
      // Seamless switch — no confirmation needed
      const target = candidates[0];
      console.log(`🔀 [switch] Voice change → ${target.name} (${targetProfile})`);
      return {
        response: null, // seamless, no message
        state: flowState,
        switchTo: target.name,
        switchState: carryState
      };
    }

    // Product exists but not with intended voice — hand off to human
    console.log(`🔀 [switch] Voice ${targetProfile} not available — handoff`);
    return {
      response: await executeHandoff(psid, convo, userMessage, {
        reason: `Cliente busca ${targetProfile === 'reseller' ? 'revender' : 'comprar para uso personal'}, no hay flujo disponible`,
        responsePrefix: 'Te comunico con un especialista que te puede ayudar mejor.',
        lastIntent: 'switch_voice_handoff',
        timingStyle: 'elaborate'
      }),
      state: flowState
    };
  }

  // ── DIFFERENT QUANTITY — Retail ↔ Wholesale (Protocol #3) ──
  if (action === 'wholesale' || action === 'retail') {
    const targetChannel = action;
    // Find a flow with the same products but the intended sales channel
    const candidates = [];
    for (const [name, mod] of _registry) {
      if (name === currentManifest.name) continue;
      const m = mod.manifest;
      if (!m) continue;
      const sameProducts = currentManifest.products.some(p =>
        m.products?.some(mp => String(mp) === String(p))
      );
      if (sameProducts && m.salesChannel === targetChannel) {
        candidates.push(m);
      }
    }

    if (candidates.length > 0) {
      // Seamless switch — no confirmation needed
      const target = candidates[0];
      console.log(`🔀 [switch] Quantity change → ${target.name} (${targetChannel})`);
      return {
        response: null, // seamless
        state: flowState,
        switchTo: target.name,
        switchState: carryState
      };
    }

    // No matching flow — hand off to human
    console.log(`🔀 [switch] Channel ${targetChannel} not available — handoff`);
    return {
      response: await executeHandoff(psid, convo, userMessage, {
        reason: `Cliente necesita ${targetChannel === 'wholesale' ? 'mayoreo' : 'menudeo'}, no hay flujo disponible`,
        responsePrefix: 'Te comunico con un especialista para atenderte.',
        lastIntent: 'switch_channel_handoff',
        timingStyle: 'elaborate'
      }),
      state: flowState
    };
  }

  // ── UNKNOWN SWITCH — hand off ──
  console.log(`🔀 [switch] Unknown action: ${action} — handoff`);
  return {
    response: await executeHandoff(psid, convo, userMessage, {
      reason: `Flow switch no resuelto: ${action}`,
      responsePrefix: 'Te comunico con un especialista.',
      lastIntent: 'switch_unknown_handoff',
      timingStyle: 'elaborate'
    }),
    state: flowState
  };
}

/**
 * Create a convo_flow instance from a manifest.
 * @param {Object} manifest — from DB
 *   type: 'convo_flow'           (mandatory)
 *   name: string                  (e.g. 'convo_mallaRetail')
 *   products: []                  (ProductFamily IDs)
 *   clientProfile: 'buyer'|'reseller'
 *   salesChannel: 'retail'|'wholesale'
 *   endpointOfSale: 'online_store'|'human'
 *   voice: 'casual'|'professional'|'technical'
 *   installationNote: string|null
 *   promo: { promoPrices, timeframe, terms }|null  (optional)
 *   allowListing: boolean
 *   offersCatalog: boolean
 * @returns {Object} convo_flow instance with handle()
 */
function create(manifest) {
  if (!manifest || manifest.type !== 'convo_flow') {
    throw new Error(`Invalid manifest: type must be 'convo_flow'`);
  }

  if (!manifest.products || !manifest.products.length) {
    throw new Error(`convo_flow ${manifest.name}: manifest must have products`);
  }
  if (!manifest.salesChannel) {
    throw new Error(`convo_flow ${manifest.name}: manifest must have salesChannel`);
  }
  if (!manifest.clientProfile) {
    throw new Error(`convo_flow ${manifest.name}: manifest must have clientProfile`);
  }

  // Select sales flow based on manifest
  const salesFlow = manifest.salesChannel === 'wholesale' ? wholesaleFlow : retailFlow;

  // Select persona flow based on manifest
  const personaFlow = manifest.clientProfile === 'reseller' ? resellerFlow_v2 : buyerFlow;

  // Has promo?
  const hasPromo = !!manifest.promo;

  // Product cache (loaded once, reused)
  let productCache = null;

  /**
   * Main message handler.
   * @param {string} userMessage
   * @param {Object} convo — conversation object from DB
   * @param {string} psid
   * @param {Object} state — convo_flow state persisted across messages
   *   basket: [{ productId, description, price, quantity }]
   *   clientData: {}
   *   pitchSent: boolean (promo)
   *   resellerPitchSent: boolean
   *   profile: 'casual'|'technical'
   *   comesFromFlowSwitch: boolean — skip greeting, continue conversation
   *   pendingSwitch: { targetFlow, carryState } — awaiting client confirmation
   * @returns {{ response: Object, state: Object, switchTo?: string, switchState?: Object }}
   */
  async function handle(userMessage, convo, psid, state = {}) {
    const flowState = {
      basket: state.basket || [],
      clientData: state.clientData || {},
      pitchSent: state.pitchSent || false,
      resellerPitchSent: state.resellerPitchSent || false,
      profile: state.profile || (manifest.voice === 'technical' ? 'technical' : 'casual'),
      comesFromFlowSwitch: state.comesFromFlowSwitch || false,
      pendingSwitch: state.pendingSwitch || null,
      ...state
    };

    const customerName = convo?.userName || null;

    // ── PENDING SWITCH CONFIRMATION (Protocol #1 — different product) ──
    if (flowState.pendingSwitch) {
      const confirmed = /\b(s[ií]|ok|dale|va|por\s*favor|xfavor|claro|adelante|eso|ese|esa)\b/i.test(userMessage);
      const declined = /\b(no|nel|nah|mejor\s*no|ninguno|nada)\b/i.test(userMessage);

      if (confirmed) {
        const target = flowState.pendingSwitch.targetFlow;
        const carryState = flowState.pendingSwitch.carryState;
        flowState.pendingSwitch = null;
        console.log(`🔀 [switch] Client confirmed → ${target}`);
        return {
          response: null,
          state: flowState,
          switchTo: target,
          switchState: carryState
        };
      }

      if (declined) {
        flowState.pendingSwitch = null;
        return {
          response: { type: 'text', text: '¡Claro! ¿En qué más te puedo ayudar?' },
          state: flowState
        };
      }
      // Ambiguous — keep pending, let the rest of the flow try to handle the message
      flowState.pendingSwitch = null;
    }

    // ── LOAD PRODUCTS (once) ──
    if (!productCache) {
      productCache = await productFlow.loadProducts(manifest.products);
    }

    // ── PROMO FLOW (presents right away, before anything else) ──
    if (hasPromo) {
      const promoResult = await promoFlow.handle(userMessage, convo, psid, {
        products: productCache,
        voice: manifest.voice || 'casual',
        salesChannel: manifest.salesChannel === 'retail' ? 'mercado_libre' : 'direct',
        customerName,
        promoPrices: manifest.promo.promoPrices || [],
        timeframe: manifest.promo.timeframe || null,
        terms: manifest.promo.terms || null,
        pitchSent: flowState.pitchSent
      });

      if (promoResult) {
        if (promoResult.pitchSent) flowState.pitchSent = true;
        return { response: promoResult, state: flowState };
      }
    }

    // ── MASTER FLOW (general questions) ──
    const masterResult = await masterFlow.handle(userMessage, convo, psid, {
      salesChannel: manifest.salesChannel === 'retail' ? 'mercado_libre' : 'direct',
      installationNote: manifest.installationNote || null
    });

    if (masterResult) {
      return { response: masterResult, state: flowState };
    }

    // ── PERSONA FLOW (buyer/reseller — evaluate profile, detect switches) ──
    const personaResult = await personaFlow.handle(userMessage, convo, psid, {
      profile: flowState.profile,
      products: productCache,
      voice: manifest.voice || 'professional',
      customerName,
      clientData: flowState.clientData,
      allowListing: manifest.allowListing || false,
      offersCatalog: manifest.offersCatalog || false,
      pitchSent: flowState.resellerPitchSent
    });

    if (personaResult) {
      // Flow switch — resolve through protocol
      if (personaResult.type === 'flow_switch') {
        return await resolveFlowSwitch(personaResult, manifest, flowState, userMessage, convo, psid);
      }

      // Persona update
      if (personaResult.type === 'persona') {
        flowState.profile = personaResult.profile;
      }

      // Reseller pitch or data gathering
      if (personaResult.type === 'text') {
        if (personaResult.pitchSent) flowState.resellerPitchSent = true;
        if (personaResult.clientData) flowState.clientData = personaResult.clientData;
        return { response: personaResult, state: flowState };
      }
    }

    // ── PRODUCT FLOW (find what the customer wants) ──
    const otherManifests = getOtherManifests(manifest.name);

    const productResult = await productFlow.handle(userMessage, convo, psid, {
      familyIds: manifest.products,
      products: productCache,
      manifests: otherManifests,
      basket: flowState.basket,
      lastQuotedProducts: flowState.lastQuotedProducts || []
    });

    if (productResult) {
      // Not offered
      if (productResult.type === 'not_offered') {
        return { response: { type: 'text', text: productResult.text }, state: flowState };
      }

      // Flow switch — resolve through protocol
      if (productResult.type === 'flow_switch') {
        return await resolveFlowSwitch(productResult, manifest, flowState, userMessage, convo, psid);
      }

      // Products found — pass to sales flow
      if (productResult.type === 'products_found' && productResult.products.length > 0) {
        // Track what products we're about to quote (for follow-up context)
        flowState.lastQuotedProducts = productResult.products;
        const personaInstructions = buyerFlow.getPersonaInstructions(flowState.profile);

        const salesResult = await salesFlow.handle(userMessage, convo, psid, {
          products: productResult.products,
          voice: manifest.voice || 'casual',
          salesChannel: manifest.salesChannel === 'retail' ? 'mercado_libre' : 'direct',
          customerName,
          clientData: flowState.clientData,
          allowListing: manifest.allowListing || false,
          offersCatalog: manifest.offersCatalog || false
        });

        if (salesResult) {
          // Flow switch — resolve through protocol
          if (salesResult.type === 'flow_switch') {
            return await resolveFlowSwitch(salesResult, manifest, flowState, userMessage, convo, psid);
          }

          // Update basket + track quoted products for follow-up context
          if (salesResult.products) {
            flowState.lastQuotedProducts = salesResult.products;
            for (const p of salesResult.products) {
              const existing = flowState.basket.find(b => b.productId === p.productId);
              if (!existing) {
                flowState.basket.push({
                  productId: p.productId,
                  description: p.name,
                  price: p.price,
                  quantity: 1
                });
              }
            }
          }

          if (salesResult.clientData) {
            flowState.clientData = salesResult.clientData;
          }

          return { response: salesResult, state: flowState };
        }
      }
    }

    // ── NOTHING HANDLED ──
    return { response: null, state: flowState };
  }

  return {
    manifest,
    handle,
    getProductCache: () => productCache
  };
}

module.exports = { create, registerFlow, getFlow, getOtherManifests, findFlowsForProduct };
