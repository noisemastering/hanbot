// ai/pipeline.js
// Pipeline runner: chains middleware and post-processors for message handling.
//
// Middleware contract:
//   async (ctx, next) => void
//   - Set ctx.response to stop the chain (don't call next)
//   - Call await next() to pass to next middleware
//   - Modify ctx to enrich for downstream middleware

/**
 * Run the middleware pipeline and post-processors.
 *
 * @param {Array<{name: string, fn: Function}>} middleware - Ordered middleware list
 * @param {Array<{name: string, fn: Function}>} postProcessors - Run on every response
 * @param {object} ctx - Context object (mutated in place)
 * @returns {object|null} ctx.response after pipeline completes
 */
async function runPipeline(middleware, postProcessors, ctx) {
  // Build the chain: each middleware calls next() to invoke the next one
  let index = 0;

  async function next() {
    if (ctx.response) return; // Short-circuit: a middleware already set a response
    if (index >= middleware.length) return; // End of chain

    const mw = middleware[index++];
    try {
      await mw.fn(ctx, next);
    } catch (err) {
      console.error(`❌ Middleware "${mw.name}" threw:`, err.message);
      // Don't crash the pipeline — continue to next middleware
      await next();
    }
  }

  await next();

  // Track which middleware handled the message
  if (ctx.response && ctx.handledBy) {
    console.log(`🧩 Pipeline: handled by "${ctx.handledBy}"`);
  } else if (ctx.response) {
    console.log(`🧩 Pipeline: response set (no handledBy tag)`);
  } else {
    console.log(`🧩 Pipeline: no middleware produced a response`);
  }

  // Run ALL post-processors on the final response (even if null)
  for (const pp of postProcessors) {
    try {
      await pp.fn(ctx);
    } catch (err) {
      console.error(`❌ Post-processor "${pp.name}" threw:`, err.message);
    }
  }

  return ctx.response;
}

/**
 * Build the initial context object from the incoming message.
 *
 * @param {string} userMessage
 * @param {string} psid
 * @param {object|null} referral
 * @param {object} convo - Conversation state (mutable)
 * @param {Function} updateConvo - Shorthand for updateConversation(psid, ...)
 * @returns {object} ctx
 */
function buildContext(userMessage, psid, referral, convo, updateConvo) {
  return {
    // Inputs
    userMessage,
    psid,
    referral,
    convo,

    // Enrichment (set by middleware)
    extractedSpecs: null,
    sourceContext: null,
    campaign: null,
    campaignContext: null,
    classification: null,
    identifiedProduct: null,

    // Output
    response: null,
    handledBy: null,

    // Utility
    updateConvo
  };
}

module.exports = { runPipeline, buildContext };
