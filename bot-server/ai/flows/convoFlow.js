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
const { generateClickLink } = require("../../tracking");
const { getConversationContext } = require("../middleware/contextManager");

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
      // Prefer non-promo flow for generic switches (promo flows are specialized)
      const target = candidates.find(c => !c.promo) || candidates[0];
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

  // Promo checked dynamically — can be injected at runtime via manifest.promo

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

    // ── CONVERSATION CONTEXT (retrieved once, passed to all flows) ──
    const conversationHistory = await getConversationContext(psid);

    // ── PENDING SWITCH CONFIRMATION (Protocol #1 — different product) ──
    if (flowState.pendingSwitch) {
      try {
        const switchCheck = await _openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: `Se le ofreció al cliente cambiar a otro producto/flujo. ¿Acepta o rechaza? Responde con JSON: { "decision": "confirmed"|"declined"|"ambiguous" }` },
            { role: 'user', content: userMessage }
          ],
          temperature: 0,
          max_tokens: 30,
          response_format: { type: 'json_object' }
        });
        const { decision } = JSON.parse(switchCheck.choices[0].message.content);

        if (decision === 'confirmed') {
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

        if (decision === 'declined') {
          flowState.pendingSwitch = null;
          return {
            response: { type: 'text', text: '¡Claro! ¿En qué más te puedo ayudar?' },
            state: flowState
          };
        }
      } catch (err) {
        console.error('❌ [convo] Switch confirmation error:', err.message);
      }
      // Ambiguous or error — clear pending, let the rest of the flow handle the message
      flowState.pendingSwitch = null;
    }

    // ── LOAD PRODUCTS (once) ──
    if (!productCache) {
      productCache = await productFlow.loadProducts(manifest.products);
    }

    // ── MASTER FLOW (general questions — sits above everything per architecture) ──
    // Per MASTER_FLOW.md: masterFlow is the SOURCE OF TRUTH for general questions
    // (location, schedule, payment, etc.) and must run before any sales/promo logic.
    const masterResultEarly = await masterFlow.handle(userMessage, convo, psid, {
      salesChannel: manifest.salesChannel === 'retail' ? 'mercado_libre' : 'direct',
      installationNote: manifest.installationNote || null,
      colorNote: manifest.promo?.colorNote || null,
      conversationHistory
    });

    if (masterResultEarly) {
      return { response: masterResultEarly, state: flowState };
    }

    // ── PROMO FLOW (presents right away if customer didn't ask a general question) ──
    // Promo can come from manifest (hardcoded) or state._adPromo (plugin from ad)
    const activePromo = flowState._adPromo || manifest.promo;
    if (activePromo) {
      // Filter to promo-specific products if configured, otherwise pitch all
      let promoProducts = activePromo.promoProductIds
        ? productCache.filter(p => activePromo.promoProductIds.includes(String(p.productId)))
        : productCache;

      // Generate tracked links for retail promo products (before first pitch)
      if (!flowState.pitchSent && manifest.salesChannel === 'retail') {
        promoProducts = await Promise.all(promoProducts.map(async p => {
          if (p.link) {
            const tracked = await generateClickLink(psid, p.link, {
              productName: p.name, productId: p.productId, reason: 'promo_pitch'
            });
            return { ...p, link: tracked };
          }
          return p;
        }));
      }

      const promoResult = await promoFlow.handle(userMessage, convo, psid, {
        products: promoProducts,
        voice: manifest.voice || 'casual',
        salesChannel: manifest.salesChannel === 'retail' ? 'mercado_libre' : 'direct',
        customerName,
        promoPrices: activePromo.promoPrices || [],
        timeframe: activePromo.timeframe || null,
        terms: activePromo.terms || null,
        colorNote: activePromo.colorNote || null,
        pitchSent: flowState.pitchSent,
        conversationHistory
      });

      if (promoResult) {
        if (promoResult.pitchSent) {
          flowState.pitchSent = true;
          // Store quoted products so follow-ups can reference the shared link
          await updateConversation(psid, {
            lastQuotedProducts: promoProducts.map(p => ({
              displayText: p.size || p.name,
              price: p.price,
              productId: p.productId,
              productUrl: p.link,
              productName: p.name
            })),
            lastSharedProductId: promoProducts[0]?.productId,
            lastSharedProductLink: promoProducts[0]?.link
          });
        }
        return { response: promoResult, state: flowState };
      }
    }

    // ── PURCHASE / DELIVERY INTENT (convoFlow layer — AI, not regex) ──
    const lastLink = convo?.lastSharedProductLink;
    if (lastLink) {
      try {
        const intentCheck = await _openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: `El cliente ya recibió un link de compra de Mercado Libre previamente. Clasifica su mensaje. Responde con JSON: { "intent": "wants_to_buy"|"thinks_ordered"|"none" }

"wants_to_buy": El cliente QUIERE comprar o pide el link de compra. Ej: "mándame el link", "quiero comprar", "lo quiero", "cómo realizo la compra", "pásame el link", "listo", "sí lo quiero".
"thinks_ordered": El cliente CREE que ya compró o pide que le envíen/manden el producto SIN haber comprado en Mercado Libre. Señales: da su dirección, pregunta cuándo le llega/traen, dice "mándenlo/mándenmelo", "me lo envían", "me la traen", "ya lo pedí", "cuándo llega". También si da datos de entrega (dirección, colonia, CP para envío) como si fuera un pedido.
"none": Pregunta general (colores, medidas, pago, instalación, ubicación), saludo, despedida, o cualquier otra cosa.

IMPORTANTE: si el cliente da una dirección completa (calle, número, colonia) o pide que se lo manden/envíen/traigan, es "thinks_ordered" — NO es "none".` },
            { role: 'user', content: `${conversationHistory ? `${conversationHistory}\n\n` : ''}Mensaje del cliente: ${userMessage}` }
          ],
          temperature: 0,
          max_tokens: 30,
          response_format: { type: 'json_object' }
        });
        const parsed = JSON.parse(intentCheck.choices[0].message.content);

        if (parsed.intent === 'thinks_ordered') {
          console.log('📦 [convo] Customer thinks they ordered — clarifying purchase process');
          await updateConversation(psid, { lastIntent: 'delivery_without_purchase', unknownCount: 0 });
          return {
            response: {
              type: 'text',
              text: `Para recibir tu malla, primero necesitas realizar la compra a través de Mercado Libre en este enlace:\n\n${lastLink}\n\nUna vez que compres, el envío va incluido y tarda de 3 a 5 días hábiles. Mercado Libre se encarga de la entrega a tu domicilio. Tu compra está protegida: si no llega o llega diferente, te devuelven tu dinero.`
            },
            state: flowState
          };
        }

        if (parsed.intent === 'wants_to_buy') {
          await updateConversation(psid, { lastIntent: 'purchase_intent', unknownCount: 0 });

          // Check if the link was already shared recently (last bot message or conversation history)
          const lastBotMsg = convo?.lastBotResponse || '';
          const linkAlreadyShared = lastBotMsg.includes(lastLink)
            || (conversationHistory && conversationHistory.includes(lastLink));

          if (linkAlreadyShared) {
            console.log('🛒 [convo] Purchase confirmation — link already in last message');
            return {
              response: { type: 'text', text: '¡Perfecto! Puedes comprarlo directamente desde el link que te compartí. Si necesitas ayuda con algo más, aquí estoy.' },
              state: flowState
            };
          }

          console.log('🛒 [convo] Purchase intent detected — sharing link');
          return {
            response: { type: 'text', text: `Puedes hacer tu compra directamente aquí:\n\n${lastLink}\n\nSi tienes cualquier duda, aquí estoy.` },
            state: flowState
          };
        }
      } catch (err) {
        console.error('❌ [convo] Purchase intent check error:', err.message);
      }
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
      pitchSent: flowState.resellerPitchSent,
      catalogSent: flowState.catalogSent || false,
      conversationHistory
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

      // Reseller pitch, catalog delivery, or data gathering
      if (personaResult.type === 'text') {
        if (personaResult.pitchSent) flowState.resellerPitchSent = true;
        if (personaResult.catalogSent) flowState.catalogSent = true;
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
      lastQuotedProducts: flowState.lastQuotedProducts || [],
      conversationHistory
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

      // Products found — pass to sales flow with the matched products
      if (productResult.type === 'products_found' && productResult.products.length > 0) {
        // Generate tracked links for retail products before quoting
        let quotableProducts = productResult.products;
        if (manifest.salesChannel === 'retail') {
          quotableProducts = await Promise.all(productResult.products.map(async p => {
            if (p.link) {
              const tracked = await generateClickLink(psid, p.link, {
                productName: p.name, productId: p.productId, reason: 'retail_quote'
              });
              return { ...p, link: tracked };
            }
            return p;
          }));
        }

        // Track what products we're about to quote (for follow-up context)
        flowState.lastQuotedProducts = quotableProducts;
        const personaInstructions = buyerFlow.getPersonaInstructions(flowState.profile);

        const salesResult = await salesFlow.handle(userMessage, convo, psid, {
          products: quotableProducts,
          voice: manifest.voice || 'casual',
          salesChannel: manifest.salesChannel === 'retail' ? 'mercado_libre' : 'direct',
          customerName,
          clientData: flowState.clientData,
          allowListing: manifest.allowListing || false,
          offersCatalog: manifest.offersCatalog || false,
          colorNote: manifest.promo?.colorNote || null,
          conversationHistory
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

          // Store the shared link so purchase intent can re-share it later
          const sharedProduct = quotableProducts.find(p => p.link);
          if (sharedProduct) {
            await updateConversation(psid, {
              lastSharedProductId: sharedProduct.productId,
              lastSharedProductLink: sharedProduct.link
            });
          }

          return { response: salesResult, state: flowState };
        }
      }
    }

    // ── PRODUCT FLOW returned no specific match ──
    // The customer arrived with convo_flow context — they expect a sales touch, not a generic answer.
    // Call the sales flow with the FULL product cache so wholesale_flow can present its catalog
    // (gated by manifest.allowListing/offersCatalog) or gather lead data, and retail_flow can
    // present the available range. The convo_flow context is the customer's existing context.
    if (productCache && productCache.length > 0) {
      console.log(`🏛️ [convo] No specific product match — invoking ${manifest.salesChannel} flow with full product cache`);

      // For retail with tracked links, generate them up front
      let availableProducts = productCache;
      if (manifest.salesChannel === 'retail') {
        availableProducts = await Promise.all(productCache.map(async p => {
          if (p.link) {
            const tracked = await generateClickLink(psid, p.link, {
              productName: p.name, productId: p.productId, reason: 'retail_intro'
            });
            return { ...p, link: tracked };
          }
          return p;
        }));
      }

      const salesResult = await salesFlow.handle(userMessage, convo, psid, {
        products: availableProducts,
        voice: manifest.voice || 'casual',
        salesChannel: manifest.salesChannel === 'retail' ? 'mercado_libre' : 'direct',
        customerName,
        clientData: flowState.clientData,
        allowListing: manifest.allowListing || false,
        offersCatalog: manifest.offersCatalog || false,
        colorNote: manifest.promo?.colorNote || null,
        conversationHistory
      });

      if (salesResult) {
        if (salesResult.type === 'flow_switch') {
          return await resolveFlowSwitch(salesResult, manifest, flowState, userMessage, convo, psid);
        }

        if (salesResult.products) {
          flowState.lastQuotedProducts = salesResult.products;
        }
        if (salesResult.clientData) {
          flowState.clientData = salesResult.clientData;
        }

        return { response: salesResult, state: flowState };
      }
    }

    // ── NOTHING HANDLED — let AI respond with full product context ──
    if (productCache && productCache.length > 0) {
      console.log('🏛️ [convo] Nothing handled — escalating to AI with product context');

      const productContext = productCache.map((p, i) => {
        let entry = `${i + 1}. ${p.name}`;
        if (p.familyName) entry += ` (${p.familyName})`;
        if (p.description) entry += `\n   Descripción: ${p.description}`;
        if (p.size) entry += `\n   Tamaño: ${p.size}`;
        if (p.price) entry += `\n   Precio: $${p.price}`;
        if (p.attributes && Object.keys(p.attributes).length > 0) {
          const attrs = Object.entries(p.attributes instanceof Map ? Object.fromEntries(p.attributes) : p.attributes)
            .map(([k, v]) => `${k}: ${v}`).join(', ');
          entry += `\n   Especificaciones: ${attrs}`;
        }
        if (p.colors?.length) entry += `\n   Colores: ${p.colors.join(', ')}`;
        return entry;
      }).join('\n');

      const voiceInstructions = {
        casual: 'Habla de manera amigable y relajada, como un vendedor joven. Usa "tú".',
        professional: 'Habla de manera profesional pero cálida.',
        technical: 'Sé preciso y detallado en las especificaciones técnicas.'
      };

      try {
        const aiResponse = await _openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: `Eres asesora de ventas de Hanlob. ${voiceInstructions[manifest.voice] || voiceInstructions.casual}

PRODUCTOS QUE MANEJAS:
${productContext}
${manifest.installationNote ? `\nNota de instalación: ${manifest.installationNote}` : ''}

REGLAS:
- Responde la pregunta del cliente usando SOLO los datos de producto proporcionados
- Si preguntan por especificaciones (grosor, ancho, material, etc.), responde con los datos que tienes
- Si no tienes la info para responder, di que no cuentas con ese dato y ofrece lo que sí sabes
- Máximo 2-3 oraciones, natural, como mensaje de WhatsApp
- No inventes datos que no están en la lista
- Solo devuelve el mensaje` },
            { role: 'user', content: `${conversationHistory ? `${conversationHistory}\n\n` : ''}Mensaje del cliente: ${userMessage}` }
          ],
          temperature: 0.3,
          max_tokens: 300
        });

        const text = aiResponse.choices[0].message.content.trim();
        return {
          response: { type: 'text', text },
          state: flowState
        };
      } catch (err) {
        console.error('❌ [convo] AI fallback error:', err.message);
      }
    }
    return { response: null, state: flowState };
  }

  return {
    manifest,
    handle,
    getProductCache: () => productCache
  };
}

module.exports = { create, registerFlow, getFlow, getOtherManifests, findFlowsForProduct };
