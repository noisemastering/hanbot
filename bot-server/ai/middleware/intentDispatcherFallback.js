/**
 * Routing middleware: intentDispatcherFallback
 *
 * Post-flow intent dispatcher. Runs AFTER the flow manager to handle
 * intents that the product flow didn't handle (returned null).
 * This matches the monolith's post-flow dispatcher behavior in index.js.
 *
 * Only dispatches when:
 *  - The flow manager didn't produce a response (ctx.response is null)
 *  - Classification confidence is adequate
 *  - No product+dimensions combo that should go to legacy flows
 */

const { dispatch: dispatchToHandler } = require("../intentDispatcher");

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

module.exports = async function intentDispatcherFallback(ctx, next) {
  // Only run if flow manager didn't handle the message
  if (ctx.response) {
    await next();
    return;
  }

  const { userMessage, psid, convo, classification } = ctx;

  const isLowConfidence = classification.confidence < 0.4 || classification.intent === "unclear";
  if (isLowConfidence) {
    await next();
    return;
  }

  const shouldDispatch = !convo?.pendingHandoff || INFORMATIONAL_INTENTS.has(classification?.intent);

  if (shouldDispatch) {
    const dispatcherResponse = await dispatchToHandler(classification, { psid, convo, userMessage });
    if (dispatcherResponse) {
      console.log(`\u2705 Intent handled by post-flow dispatcher fallback (${dispatcherResponse.handledBy})`);
      ctx.response = dispatcherResponse;
      ctx.handledBy = dispatcherResponse.handledBy || "intent_dispatcher_fallback";
      return;
    }
  }

  await next();
};
