// ai/pipelineConfig.js
// Assembles the middleware pipeline in execution order.
// Each entry: { name: string, fn: async (ctx, next) => void }
//
// Middleware is added wave-by-wave during the migration.
// Post-processors run on EVERY response after the chain completes.

// --- Group A: State & Guards ---
const stateManager = require("./middleware/stateManager");
const specExtractor = require("./middleware/specExtractor");
const productResolver = require("./middleware/productResolver");
const activeFlowCheck = require("./middleware/activeFlowCheck");
const pendingResponses = require("./middleware/pendingResponses");

// --- Group B: Context Building (enrich, don't respond) ---
const sourceContext = require("./middleware/sourceContext");
const campaignLoader = require("./middleware/campaignLoader");
const wholesaleFlag = require("./middleware/wholesaleFlag");
const productIdentifier = require("./middleware/productIdentifier");
const intentClassifier = require("./middleware/intentClassifier");

// --- Group C: Intent Handlers (each can short-circuit) ---
const phoneCapture = require("./middleware/phoneCapture");
const linkNotWorking = require("./middleware/linkNotWorking");
const trustConcern = require("./middleware/trustConcern");
const payOnDelivery = require("./middleware/payOnDelivery");
const intentDB = require("./middleware/intentDB");
const multiQuestion = require("./middleware/multiQuestion");
// Pre-flow dispatcher: only urgent intents (frustration, human_request, etc.)
// when in a product flow. All intents when in default flow.
const intentDispatcher = require("./middleware/intentDispatcher");

// --- Group D: Flow Routing ---
const flowManager = require("./middleware/flowManager");
// Post-flow dispatcher: handles intents the flow manager didn't handle
const intentDispatcherFallback = require("./middleware/intentDispatcherFallback");
const legacyFlows = require("./middleware/legacyFlows");
const pendingHandoff = require("./middleware/pendingHandoff");

// --- Group E: Fallback ---
const aiFallback = require("./middleware/aiFallback");

// --- Post-Processors ---
const payOnDeliveryCheck = require("./middleware/post/payOnDeliveryCheck");
const locationStats = require("./middleware/post/locationStats");
const repetitionCheck = require("./middleware/post/repetitionCheck");

/**
 * Returns the ordered middleware array.
 */
function getMiddleware() {
  return [
    // Group A: State & Guards
    { name: "stateManager",      fn: stateManager },
    { name: "specExtractor",     fn: specExtractor },
    { name: "productResolver",   fn: productResolver },
    { name: "activeFlowCheck",   fn: activeFlowCheck },
    { name: "pendingResponses",  fn: pendingResponses },

    // Group B: Context Building
    { name: "sourceContext",     fn: sourceContext },
    { name: "campaignLoader",    fn: campaignLoader },
    { name: "wholesaleFlag",     fn: wholesaleFlag },
    { name: "productIdentifier", fn: productIdentifier },
    { name: "intentClassifier",  fn: intentClassifier },

    // Group C: Intent Handlers (pre-flow)
    { name: "phoneCapture",      fn: phoneCapture },
    { name: "linkNotWorking",    fn: linkNotWorking },
    { name: "trustConcern",      fn: trustConcern },
    { name: "payOnDelivery",     fn: payOnDelivery },
    { name: "intentDB",          fn: intentDB },
    { name: "multiQuestion",     fn: multiQuestion },
    { name: "intentDispatcher",  fn: intentDispatcher },  // urgent-only when in product flow

    // Group D: Flow Routing
    { name: "flowManager",      fn: flowManager },
    { name: "intentDispatcherFallback", fn: intentDispatcherFallback },  // post-flow fallback
    { name: "legacyFlows",      fn: legacyFlows },
    { name: "pendingHandoff",   fn: pendingHandoff },

    // Group E: Fallback
    { name: "aiFallback",       fn: aiFallback },
  ];
}

/**
 * Returns the post-processors array.
 */
function getPostProcessors() {
  return [
    { name: "payOnDeliveryCheck", fn: payOnDeliveryCheck },
    { name: "locationStats",      fn: locationStats },
    { name: "repetitionCheck",    fn: repetitionCheck },
  ];
}

module.exports = { getMiddleware, getPostProcessors };
