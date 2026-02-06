// ai/flowManager.js
// Central flow manager - ALL messages go through here
// Handles: scoring, flow detection, flow routing, flow transfers

const { updateConversation } = require("../conversationManager");
const { scorePurchaseIntent, isWholesaleInquiry } = require("./utils/purchaseIntentScorer");
const { parseDimensions } = require("../measureHandler");
const { INTENTS, PRODUCTS } = require("./classifier");

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
 * Detect which flow should handle this conversation
 * Based on: product mentions, classification, conversation context
 */
function detectFlow(classification, convo, userMessage) {
  const msg = (userMessage || '').toLowerCase();

  // FIRST: Check if already in a product flow - prioritize conversation continuity
  // This prevents "De 5 metros" in a rollo conversation from being hijacked by malla flow
  if (convo?.currentFlow && convo.currentFlow !== 'default') {
    return convo.currentFlow;
  }

  // SECOND: Check product interest from conversation (mid-flow state)
  if (convo?.productInterest) {
    const pi = convo.productInterest.toLowerCase();

    // Handle malla_sombra variants
    if (pi.startsWith('malla_sombra') || pi === 'confeccionada') {
      return 'malla_sombra';
    }

    // Direct mappings for other products
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

  // THIRD: Check classification product (new product detected in message)
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

  // Keyword detection for products
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

  // Check for dimensions - implies malla_sombra (most common)
  const dimensions = parseDimensions(userMessage);
  if (dimensions && !dimensions.isRoll) {
    // Dimensions without explicit product = malla sombra confeccionada
    return 'malla_sombra';
  }

  // Default flow for everything else
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

  // ===== STEP 0: CHECK FOR LEAD CAPTURE CAMPAIGN =====
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
  const currentFlow = convo?.currentFlow || 'default';
  const detectedFlow = detectFlow(classification, convo, userMessage);

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
    campaign
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
