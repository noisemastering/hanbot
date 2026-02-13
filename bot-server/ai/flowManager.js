// ai/flowManager.js
// Central flow manager - ALL messages go through here
// Handles: scoring, flow detection, flow routing, flow transfers

const { updateConversation } = require("../conversationManager");
const { scorePurchaseIntent, isWholesaleInquiry } = require("./utils/purchaseIntentScorer");
const { parseDimensions } = require("../measureHandler");
const { INTENTS, PRODUCTS } = require("./classifier");
const { analyzeUseCaseFit, generateSuggestionMessage } = require("./utils/usoCaseMatcher");
const ProductFamily = require("../models/ProductFamily");
const { generateClickLink } = require("../tracking");
const { sendHandoffNotification } = require("../services/pushNotifications");

// Flow imports
const defaultFlow = require("./flows/defaultFlow");
const mallaFlow = require("./flows/mallaFlow");
const rolloFlow = require("./flows/rolloFlow");
const bordeFlow = require("./flows/bordeFlow");
const groundcoverFlow = require("./flows/groundcoverFlow");
const monofilamentoFlow = require("./flows/monofilamentoFlow");
const generalFlow = require("./flows/generalFlow");
const leadCaptureFlow = require("./flows/leadCaptureFlow");

/**
 * Flow registry - maps flow names to flow modules
 */
const FLOWS = {
  default: defaultFlow,
  malla_sombra: mallaFlow,
  rollo: rolloFlow,
  borde_separador: bordeFlow,
  groundcover: groundcoverFlow,
  monofilamento: monofilamentoFlow,
  lead_capture: leadCaptureFlow
};

/**
 * Maps flowRef values (from ad hierarchy) to flow names
 */
const FLOW_REF_MAP = {
  'mallaFlow': 'malla_sombra',
  'rolloFlow': 'rollo',
  'bordeFlow': 'borde_separador',
  'groundcoverFlow': 'groundcover',
  'monofilamentoFlow': 'monofilamento',
  'malla_sombra': 'malla_sombra',
  'rollo': 'rollo',
  'borde_separador': 'borde_separador',
  'groundcover': 'groundcover',
  'monofilamento': 'monofilamento'
};

/**
 * Product-type keywords we don't sell — used to detect "unknown product" questions
 */
const UNKNOWN_PRODUCTS = /\b(lona|polisombra|media\s*sombra|malla\s*cicl[oó]n|malla\s*electrosoldada|malla\s*galvanizada|pl[aá]stico\s*(para\s*)?invernadero|rafia|costal|tela|alambre|cerca|reja|manguera|tubo)\b/i;

/**
 * Product type to flow mapping (from productInterest string)
 */
const PRODUCT_TYPE_TO_FLOW = {
  'malla_sombra': 'malla_sombra',
  'malla_sombra_raschel': 'malla_sombra',
  'rollo': 'rollo',
  'borde_separador': 'borde_separador',
  'ground_cover': 'groundcover',
  'groundcover': 'groundcover',
  'monofilamento': 'monofilamento'
};

/**
 * Detect if user explicitly mentioned a different product than current flow
 * Returns the new product flow if detected, null otherwise
 */
function detectExplicitProductSwitch(userMessage, currentFlow, classification) {
  const msg = (userMessage || '').toLowerCase();

  // Map of explicit product keywords to flows
  const explicitProductPatterns = {
    'rollo': { pattern: /\b(rollo|rollos|100\s*m(etros)?)\b/i, flow: 'rollo' },
    'borde_separador': { pattern: /\b(borde|separador|cinta\s*pl[aá]stica)\b/i, flow: 'borde_separador' },
    'groundcover': { pattern: /\b(ground\s*cover|antimaleza|malla\s*(para\s*)?maleza)\b/i, flow: 'groundcover' },
    'monofilamento': { pattern: /\b(monofilamento)\b/i, flow: 'monofilamento' },
    'malla_sombra': { pattern: /\b(confeccionada|malla\s*sombra)\b/i, flow: 'malla_sombra' }
  };

  // Also check classification product
  const classificationFlowMap = {
    [PRODUCTS.ROLLO]: 'rollo',
    [PRODUCTS.BORDE_SEPARADOR]: 'borde_separador',
    [PRODUCTS.GROUNDCOVER]: 'groundcover',
    [PRODUCTS.MONOFILAMENTO]: 'monofilamento',
    [PRODUCTS.MALLA_SOMBRA]: 'malla_sombra'
  };

  // Check for explicit keyword mentions
  for (const [productKey, config] of Object.entries(explicitProductPatterns)) {
    if (config.pattern.test(msg) && config.flow !== currentFlow) {
      console.log(`🔍 Explicit product mention detected: ${productKey} (current: ${currentFlow})`);
      return config.flow;
    }
  }

  // Check classification if it detected a different product
  if (classification?.product && classification.product !== PRODUCTS.UNKNOWN) {
    const classifiedFlow = classificationFlowMap[classification.product];
    if (classifiedFlow && classifiedFlow !== currentFlow) {
      console.log(`🔍 Classification detected different product: ${classifiedFlow} (current: ${currentFlow})`);
      return classifiedFlow;
    }
  }

  return null;
}

/**
 * Detect which flow should handle this conversation
 * Priority: currentFlow > ad flowRef > ad product > classification > productInterest > keywords > dimensions > default
 */
function detectFlow(classification, convo, userMessage, sourceContext) {
  const msg = (userMessage || '').toLowerCase();

  // 1. CONVERSATION CONTINUITY: Already in a product flow
  if (convo?.currentFlow && convo.currentFlow !== 'default') {
    return convo.currentFlow;
  }

  // 2. AD HIERARCHY FLOWREF: Direct flow reference from ad cascade
  const adFlowRef = sourceContext?.ad?.flowRef || convo?.adFlowRef;
  if (adFlowRef && FLOW_REF_MAP[adFlowRef]) {
    console.log(`🎯 Flow from ad hierarchy flowRef: ${adFlowRef} → ${FLOW_REF_MAP[adFlowRef]}`);
    return FLOW_REF_MAP[adFlowRef];
  }

  // 3. AD HIERARCHY PRODUCT: Product resolved from ad cascade
  const adProduct = sourceContext?.ad?.product;
  if (adProduct) {
    const adFlow = PRODUCT_TYPE_TO_FLOW[adProduct] || PRODUCT_TYPE_TO_FLOW[adProduct.toLowerCase()];
    if (adFlow) {
      console.log(`🎯 Flow from ad hierarchy product: ${adProduct} → ${adFlow}`);
      return adFlow;
    }
  }

  // 4. CLASSIFICATION PRODUCT: Explicit product detected in message
  if (classification.product && classification.product !== PRODUCTS.UNKNOWN) {
    const flowMap = {
      [PRODUCTS.MALLA_SOMBRA]: 'malla_sombra',
      [PRODUCTS.ROLLO]: 'rollo',
      [PRODUCTS.BORDE_SEPARADOR]: 'borde_separador',
      [PRODUCTS.GROUNDCOVER]: 'groundcover',
      [PRODUCTS.MONOFILAMENTO]: 'monofilamento'
    };

    if (flowMap[classification.product]) {
      return flowMap[classification.product];
    }
  }

  // 5. PRODUCT INTEREST: From conversation context (ads, previous context)
  if (convo?.productInterest) {
    const pi = convo.productInterest.toLowerCase();

    if (pi.startsWith('malla_sombra') || pi === 'confeccionada') {
      return 'malla_sombra';
    }

    const interestMap = {
      'rollo': 'rollo',
      'borde_separador': 'borde_separador',
      'ground_cover': 'groundcover',
      'groundcover': 'groundcover',
      'monofilamento': 'monofilamento'
    };

    if (interestMap[pi]) {
      return interestMap[pi];
    }
  }

  // 6. KEYWORD DETECTION
  if (/\b(malla\s*sombra|confeccionada)\b/i.test(msg) && !/rollo/i.test(msg)) {
    return 'malla_sombra';
  }
  if (/\brollo\b/i.test(msg) || /\b100\s*m(etros?)?\b/i.test(msg)) {
    return 'rollo';
  }
  if (/\bborde\b/i.test(msg) || /\bcinta\s*pl[aá]stica\b/i.test(msg)) {
    return 'borde_separador';
  }
  if (/\b(ground\s*cover|antimaleza|malla\s*(para\s*)?maleza)\b/i.test(msg)) {
    return 'groundcover';
  }
  if (/\bmonofilamento\b/i.test(msg)) {
    return 'monofilamento';
  }

  // 7. DIMENSION INFERENCE
  const dimensions = parseDimensions(userMessage);
  if (dimensions && !dimensions.isRoll) {
    return 'malla_sombra';
  }

  // 8. DEFAULT
  return 'default';
}

/**
 * Check if flow should transfer to another flow
 * Returns new flow name or null if no transfer needed
 */
function checkFlowTransfer(currentFlow, detectedFlow, convo) {
  // Don't transfer if already in the detected flow
  if (currentFlow === detectedFlow) {
    return null;
  }

  // Transfer from default to product flow
  if (currentFlow === 'default' && detectedFlow !== 'default') {
    console.log(`🔄 Flow transfer: default → ${detectedFlow}`);
    return detectedFlow;
  }

  // Transfer between product flows (user changed mind)
  if (currentFlow !== 'default' && detectedFlow !== 'default' && currentFlow !== detectedFlow) {
    console.log(`🔄 Flow transfer: ${currentFlow} → ${detectedFlow}`);
    return detectedFlow;
  }

  return null;
}

/**
 * Main entry point - process ALL messages through flow manager
 */
async function processMessage(userMessage, psid, convo, classification, sourceContext, campaign = null) {
  console.log(`\n🎯 ===== FLOW MANAGER =====`);

  // ===== STEP 0a: CHECK FOR PENDING WHOLESALE/RETAIL CHOICE =====
  if (convo?.pendingWholesaleRetailChoice) {
    const msg = userMessage.toLowerCase();
    const isRetail = /\b(menudeo|por\s*pieza|una|pocas?|tienda|mercado\s*libre|en\s*l[ií]nea)\b/i.test(msg);
    const isWholesaleChoice = /\b(mayoreo|por\s*mayor|varias?|muchas?|cantidad|rollo|rollos|distribuidor|bulk)\b/i.test(msg);

    if (isRetail) {
      const newFlow = convo.pendingWholesaleRetailChoice;
      console.log(`🛒 Retail choice confirmed, switching to flow: ${newFlow}`);

      await updateConversation(psid, {
        currentFlow: newFlow,
        productInterest: newFlow,
        pendingWholesaleRetailChoice: null,
        flowTransferredFrom: convo.currentFlow,
        flowTransferredAt: new Date()
      });
      convo.currentFlow = newFlow;
      convo.productInterest = newFlow;

      const flowGreetings = {
        'rollo': '¡Perfecto! Para el rollo de malla sombra, ¿qué porcentaje de sombra necesitas? Tenemos 35%, 50%, 70%, 80% y 90%.',
        'malla_sombra': '¡Perfecto! Para la malla sombra confeccionada, ¿qué medida necesitas?',
        'groundcover': '¡Perfecto! Para el ground cover antimaleza, ¿qué medida necesitas?',
        'monofilamento': '¡Perfecto! Para la malla monofilamento, ¿qué porcentaje de sombra necesitas?',
        'borde_separador': '¡Perfecto! Para el borde separador, ¿qué largo necesitas? Tenemos 6m, 9m, 18m y 54m.'
      };

      console.log(`🎯 ===== END FLOW MANAGER (retail → ${newFlow}) =====\n`);
      return {
        type: "text",
        text: flowGreetings[newFlow] || '¡Perfecto! ¿Qué medida necesitas?',
        handledBy: `flow:${newFlow}`,
        purchaseIntent: 'medium'
      };
    }

    if (isWholesaleChoice) {
      const productNames = {
        'rollo': 'rollos de malla sombra',
        'malla_sombra': 'malla sombra',
        'borde_separador': 'borde separador',
        'groundcover': 'ground cover',
        'monofilamento': 'malla monofilamento'
      };
      const productName = productNames[convo.pendingWholesaleRetailChoice] || 'producto';

      console.log(`🏭 Wholesale choice confirmed, handing off to specialist`);
      await updateConversation(psid, {
        pendingWholesaleRetailChoice: null,
        handoffRequested: true,
        handoffReason: `Mayoreo: ${productName}`,
        handoffTimestamp: new Date(),
        state: "needs_human"
      });

      await sendHandoffNotification(psid, convo, `Cliente quiere ${productName} al mayoreo`).catch(err =>
        console.error("Error sending wholesale handoff notification:", err.message)
      );

      console.log(`🎯 ===== END FLOW MANAGER (wholesale handoff) =====\n`);
      return {
        type: "text",
        text: `¡Claro! Para ${productName} al mayoreo te comunico con un especialista que te dará los mejores precios. En un momento te atienden.`,
        handledBy: "flow:wholesale_handoff",
        purchaseIntent: 'high'
      };
    }
    // If neither detected, clear pending and continue normal flow
    await updateConversation(psid, { pendingWholesaleRetailChoice: null });
  }
  // ===== END PENDING WHOLESALE/RETAIL CHECK =====

  // ===== STEP 0b: CHECK FOR PENDING FLOW CHANGE CONFIRMATION =====
  // If we suggested a product change and user confirms, execute the switch
  if (convo?.pendingFlowChange) {
    const msg = userMessage.toLowerCase();
    const isConfirmation = /\b(s[ií]|ok|claro|dale|va|me\s*interesa|esa|ese|la\s*quiero|lo\s*quiero)\b/i.test(msg);
    const isRejection = /\b(no|mejor\s*no|as[ií]\s*est[aá]|el\s*que\s*te\s*dije|la\s*que\s*te\s*dije|la\s*confeccionada|el\s*original)\b/i.test(msg);

    if (isConfirmation) {
      const newFlow = convo.pendingFlowChange;
      console.log(`✅ User confirmed flow change to: ${newFlow}`);

      // Check if this product type has both wholesale and retail options
      try {
        const productTypeMap = {
          'malla_sombra': /malla.*sombra/i,
          'rollo': /rollo/i,
          'borde_separador': /borde.*separador|cinta.*pl[aá]stica/i,
          'groundcover': /ground.*cover|antimaleza/i,
          'monofilamento': /monofilamento/i
        };
        const typeRegex = productTypeMap[newFlow];

        if (typeRegex) {
          const matchingProducts = await ProductFamily.find({
            name: typeRegex,
            sellable: true,
            active: true
          }).lean();

          const hasRetail = matchingProducts.some(p => p.onlineStoreLinks?.length > 0);
          const hasWholesale = matchingProducts.some(p => p.wholesaleEnabled || p.wholesaleMinQty > 0);

          if (hasRetail && hasWholesale) {
            // Both modes available — ask the customer
            const productNames = {
              'rollo': 'rollos de malla sombra',
              'malla_sombra': 'malla sombra',
              'borde_separador': 'borde separador',
              'groundcover': 'ground cover',
              'monofilamento': 'malla monofilamento'
            };
            const productName = productNames[newFlow] || newFlow;

            await updateConversation(psid, {
              pendingFlowChange: null,
              pendingUseCaseProducts: null,
              pendingWholesaleRetailChoice: newFlow
            });

            console.log(`🎯 ===== END FLOW MANAGER (wholesale/retail choice) =====\n`);
            return {
              type: "text",
              text: `Tenemos ${productName}. ¿Lo quieres al menudeo (por pieza) o al mayoreo?`,
              handledBy: "flow:wholesale_retail_choice",
              purchaseIntent: 'medium'
            };
          }

          if (!hasRetail && hasWholesale) {
            // Wholesale only — handoff to specialist
            const productNames = {
              'rollo': 'rollos de malla sombra',
              'malla_sombra': 'malla sombra',
              'borde_separador': 'borde separador',
              'groundcover': 'ground cover',
              'monofilamento': 'malla monofilamento'
            };
            const productName = productNames[newFlow] || newFlow;

            await updateConversation(psid, {
              pendingFlowChange: null,
              pendingUseCaseProducts: null,
              handoffRequested: true,
              handoffReason: `Mayoreo: ${productName}`,
              handoffTimestamp: new Date(),
              state: "needs_human"
            });

            await sendHandoffNotification(psid, convo, `Cliente quiere ${productName} (solo mayoreo disponible)`).catch(err =>
              console.error("Error sending wholesale handoff notification:", err.message)
            );

            console.log(`🎯 ===== END FLOW MANAGER (wholesale-only handoff) =====\n`);
            return {
              type: "text",
              text: `Para ${productName} te comunico con un especialista. En un momento te atienden.`,
              handledBy: "flow:wholesale_handoff",
              purchaseIntent: 'high'
            };
          }
        }
      } catch (err) {
        console.error(`⚠️ Error checking wholesale/retail for ${newFlow}:`, err.message);
        // Continue with normal flow switch on error
      }

      // Clear pending and switch flow (retail only, or no wholesale/retail distinction found)
      await updateConversation(psid, {
        currentFlow: newFlow,
        productInterest: newFlow,
        pendingFlowChange: null,
        pendingUseCaseProducts: null,
        flowTransferredFrom: convo.currentFlow,
        flowTransferredAt: new Date()
      });

      convo.currentFlow = newFlow;
      convo.productInterest = newFlow;

      // Route to new flow with a greeting
      const flowGreetings = {
        'rollo': '¡Perfecto! Para el rollo de malla sombra, ¿qué porcentaje de sombra necesitas? Tenemos 35%, 50%, 70%, 80% y 90%.',
        'malla_sombra': '¡Perfecto! Para la malla sombra confeccionada, ¿qué medida necesitas?',
        'groundcover': '¡Perfecto! Para el ground cover antimaleza, ¿qué medida necesitas?',
        'monofilamento': '¡Perfecto! Para la malla monofilamento, ¿qué porcentaje de sombra necesitas?',
        'borde_separador': '¡Perfecto! Para el borde separador, ¿qué largo necesitas? Tenemos 6m, 9m, 18m y 54m.'
      };

      console.log(`🎯 ===== END FLOW MANAGER (flow changed to ${newFlow}) =====\n`);
      return {
        type: "text",
        text: flowGreetings[newFlow] || `¡Perfecto! ¿Qué medida necesitas?`,
        handledBy: `flow:${newFlow}`,
        purchaseIntent: 'medium'
      };
    }

    if (isRejection) {
      console.log(`❌ User rejected flow change, staying in: ${convo.currentFlow}`);

      // Clear pending change
      await updateConversation(psid, {
        pendingFlowChange: null,
        pendingFlowChangeReason: null,
        pendingUseCaseProducts: null
      });

      // Confirm staying with current product
      const currentProductNames = {
        'rollo': 'rollo de malla sombra',
        'malla_sombra': 'malla sombra confeccionada',
        'borde_separador': 'borde separador',
        'groundcover': 'ground cover',
        'monofilamento': 'malla monofilamento'
      };
      const currentName = currentProductNames[convo.currentFlow] || 'producto actual';

      console.log(`🎯 ===== END FLOW MANAGER (staying in ${convo.currentFlow}) =====\n`);
      return {
        type: "text",
        text: `Perfecto, seguimos con el ${currentName}. ¿En qué te puedo ayudar?`,
        handledBy: `flow:${convo.currentFlow}`,
        purchaseIntent: 'medium'
      };
    }
  }
  // ===== END PENDING FLOW CHANGE CHECK =====

  // ===== STEP 0.5: CHECK FOR EXPLICIT PRODUCT SWITCH =====
  // If user is in a product flow and mentions a different product, ask for confirmation
  const currentFlow = convo?.currentFlow || 'default';
  if (currentFlow !== 'default' && !convo?.pendingFlowChange) {
    const switchToFlow = detectExplicitProductSwitch(userMessage, currentFlow, classification);

    if (switchToFlow) {
      console.log(`🔄 Product switch detected: ${currentFlow} → ${switchToFlow}`);

      // Store pending flow change
      await updateConversation(psid, {
        pendingFlowChange: switchToFlow,
        pendingFlowChangeReason: 'product_switch'
      });

      // Generate confirmation message
      const productNames = {
        'rollo': 'rollo de malla sombra',
        'malla_sombra': 'malla sombra confeccionada',
        'borde_separador': 'borde separador para jardín',
        'groundcover': 'ground cover antimaleza',
        'monofilamento': 'malla monofilamento'
      };

      const newProductName = productNames[switchToFlow] || switchToFlow;
      const currentProductName = productNames[currentFlow] || currentFlow;

      console.log(`🎯 ===== END FLOW MANAGER (product switch confirmation) =====\n`);
      return {
        type: "text",
        text: `¿Quieres que te cotice un ${newProductName} en lugar de ${currentProductName}?`,
        handledBy: "flow:product_switch_confirmation",
        purchaseIntent: 'medium'
      };
    }

    // Check for unknown products (things we don't sell)
    if (!switchToFlow) {
      const unknownMatch = userMessage.match(UNKNOWN_PRODUCTS);
      if (unknownMatch) {
        const unknownProduct = unknownMatch[1];
        console.log(`❓ Unknown product detected: "${unknownProduct}" (we don't sell this)`);

        try {
          const trackedLink = await generateClickLink(psid, 'https://www.mercadolibre.com.mx/tienda/distribuidora-hanlob', {
            reason: 'unknown_product',
            unknownProduct,
            campaignId: convo?.campaignId,
            userName: convo?.userName
          });

          console.log(`🎯 ===== END FLOW MANAGER (unknown product) =====\n`);
          return {
            type: "text",
            text: `No manejamos ${unknownProduct}, pero te comparto nuestra tienda donde puedes ver todo lo que ofrecemos: ${trackedLink}`,
            handledBy: "flow:unknown_product",
            purchaseIntent: 'low'
          };
        } catch (err) {
          console.error(`⚠️ Error generating tracked link for unknown product:`, err.message);
          console.log(`🎯 ===== END FLOW MANAGER (unknown product, no link) =====\n`);
          return {
            type: "text",
            text: `No manejamos ${unknownProduct}. Manejamos malla sombra, borde separador, ground cover y monofilamento. ¿Te interesa alguno?`,
            handledBy: "flow:unknown_product",
            purchaseIntent: 'low'
          };
        }
      }
    }
  }
  // ===== END PRODUCT SWITCH CHECK =====

  // ===== STEP 0.6: CHECK FOR LEAD CAPTURE CAMPAIGN =====
  // B2B/Distributor campaigns should go through lead capture flow
  if (campaign && leadCaptureFlow.shouldHandle(classification, sourceContext, convo, userMessage, campaign)) {
    console.log(`📋 Routing to lead capture flow (campaign: ${campaign.name})`);
    const leadResponse = await leadCaptureFlow.handle(classification, sourceContext, convo, psid, campaign, userMessage);
    if (leadResponse) {
      console.log(`🎯 ===== END FLOW MANAGER (handled by lead_capture) =====\n`);
      return {
        ...leadResponse,
        handledBy: "flow:lead_capture"
      };
    }
  }
  // ===== END LEAD CAPTURE CHECK =====

  // ===== STEP 1: ALWAYS SCORE PURCHASE INTENT =====
  const isWholesale = isWholesaleInquiry(userMessage, convo);
  const intentScore = scorePurchaseIntent(userMessage, convo);

  // Update conversation with score (non-blocking but we want it to persist)
  await updateConversation(psid, {
    purchaseIntent: intentScore.intent,
    intentSignals: intentScore.signals,
    isWholesaleInquiry: isWholesale
  });

  console.log(`📊 Purchase intent: ${intentScore.intent.toUpperCase()}`);
  // ===== END SCORING =====

  // ===== STEP 2: DETECT APPROPRIATE FLOW =====
  // Note: currentFlow already declared in step 0.5
  const detectedFlow = detectFlow(classification, convo, userMessage, sourceContext);

  console.log(`📍 Current flow: ${currentFlow}, Detected: ${detectedFlow}`);

  // ===== STEP 3: CHECK FOR FLOW TRANSFER =====
  const transferTo = checkFlowTransfer(currentFlow, detectedFlow, convo);
  const activeFlow = transferTo || currentFlow;

  if (transferTo) {
    // Update conversation with new flow
    await updateConversation(psid, {
      currentFlow: transferTo,
      flowTransferredFrom: currentFlow,
      flowTransferredAt: new Date()
    });

    // Update local convo object
    convo.currentFlow = transferTo;
  } else if (currentFlow === 'default' && detectedFlow === 'default' && !convo?.currentFlow) {
    // Initialize default flow for new conversations
    await updateConversation(psid, { currentFlow: 'default' });
    convo.currentFlow = 'default';
  }
  // ===== END FLOW DETECTION =====

  // ===== STEP 3.5: CHECK USE CASE FIT =====
  // Detect if user mentions a use case and validate product fit
  const productInterest = convo?.productInterest || activeFlow;
  const useCaseAnalysis = await analyzeUseCaseFit(userMessage, productInterest);

  if (useCaseAnalysis.detected) {
    // Store the detected use case in conversation
    await updateConversation(psid, {
      detectedUseCase: useCaseAnalysis.keywords[0],
      useCaseFits: useCaseAnalysis.fits
    });

    // If product doesn't fit the use case, suggest alternatives
    if (useCaseAnalysis.shouldSuggestChange) {
      const suggestionMsg = generateSuggestionMessage(useCaseAnalysis);

      if (suggestionMsg) {
        console.log(`🔄 Product mismatch detected - suggesting alternatives`);

        // Determine the best flow for suggested products
        let suggestedFlow = activeFlow;
        const suggestedProduct = useCaseAnalysis.suggestedProducts[0];
        if (suggestedProduct) {
          const name = suggestedProduct.name.toLowerCase();
          if (name.includes('rollo')) suggestedFlow = 'rollo';
          else if (name.includes('ground') || name.includes('antimaleza')) suggestedFlow = 'groundcover';
          else if (name.includes('monofilamento')) suggestedFlow = 'monofilamento';
          else if (name.includes('borde')) suggestedFlow = 'borde_separador';
        }

        // Store pending flow change (user needs to confirm)
        await updateConversation(psid, {
          pendingFlowChange: suggestedFlow,
          pendingUseCaseProducts: useCaseAnalysis.suggestedProducts.map(p => p._id)
        });

        console.log(`🎯 ===== END FLOW MANAGER (use case mismatch) =====\n`);
        return {
          type: "text",
          text: suggestionMsg,
          handledBy: "flow:use_case_matcher",
          purchaseIntent: intentScore.intent
        };
      }
    }
  }
  // ===== END USE CASE FIT CHECK =====

  // ===== STEP 4: ROUTE TO ACTIVE FLOW =====
  const flow = FLOWS[activeFlow];

  if (!flow) {
    console.error(`❌ Unknown flow: ${activeFlow}`);
    return null;
  }

  console.log(`✅ Routing to: ${activeFlow} flow`);

  // Pass scoring info to flow
  const flowContext = {
    intentScore,
    isWholesale,
    transferredFrom: transferTo ? currentFlow : null,
    classification,
    sourceContext,
    campaign,
    useCaseAnalysis
  };

  try {
    const response = await flow.handle(classification, sourceContext, convo, psid, campaign, userMessage, flowContext);

    if (response) {
      console.log(`🎯 ===== END FLOW MANAGER (handled by ${activeFlow}) =====\n`);
      return {
        ...response,
        handledBy: `flow:${activeFlow}`,
        purchaseIntent: intentScore.intent
      };
    }
  } catch (error) {
    console.error(`❌ Error in ${activeFlow} flow:`, error.message);
  }

  // ===== STEP 5: FALLBACK TO GENERAL FLOW =====
  // If product flow didn't handle it, try general flow for common queries
  if (activeFlow !== 'default' && generalFlow.shouldHandle(classification, sourceContext, convo, userMessage)) {
    console.log(`🔄 Fallback to general flow for common query`);
    const generalResponse = await generalFlow.handle(classification, sourceContext, convo, psid, campaign, userMessage);

    if (generalResponse) {
      console.log(`🎯 ===== END FLOW MANAGER (handled by general) =====\n`);
      return {
        ...generalResponse,
        handledBy: 'flow:general',
        purchaseIntent: intentScore.intent
      };
    }
  }

  console.log(`🎯 ===== END FLOW MANAGER (not handled) =====\n`);
  return null;
}

/**
 * Get current flow state for a conversation
 */
function getFlowState(convo) {
  return {
    currentFlow: convo?.currentFlow || 'default',
    purchaseIntent: convo?.purchaseIntent || null,
    intentSignals: convo?.intentSignals || {},
    isWholesale: convo?.isWholesaleInquiry || false
  };
}

module.exports = {
  processMessage,
  detectFlow,
  checkFlowTransfer,
  getFlowState,
  FLOWS
};
