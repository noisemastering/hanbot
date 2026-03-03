/**
 * Routing middleware: intentDispatcher
 *
 * Thin wrapper around the central intent dispatcher. Routes classified
 * intents to their registered handler functions (social, specs, logistics,
 * escalation, products, purchase, service, conversation).
 *
 * Skipped when:
 *  - Classification confidence is low or unclear
 *  - A product with explicit dimensions is detected alongside a logistics
 *    intent (so the product pipeline handles it instead)
 *  - A pending handoff is active and the intent is not informational
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
  "frustration", "human_request", "complaint", "out_of_stock_report",
  "price_confusion", "store_link_request", "custom_modification"
]);

const LOGISTICS_INTENTS_SKIP = new Set([
  "shipping_query", "location_query", "delivery_time_query",
  "shipping_included_query", "payment_query"
]);

module.exports = async function intentDispatcher(ctx, next) {
  const { userMessage, psid, convo, classification } = ctx;

  const isLowConfidence = classification.confidence < 0.4 || classification.intent === "unclear";
  if (isLowConfidence) {
    console.log(`\u{1F914} Low confidence (${classification.confidence}) / unclear \u2014 skipping dispatcher`);
  }

  const hasProductWithDimensions =
    /\b(rollo|malla|sombra|borde|groundcover|monofilamento)\b/i.test(userMessage) &&
    /\d+(?:\.\d+)?\s*(?:[xX\u00D7*]|(?:metros?\s*)?por)\s*\d+/i.test(userMessage);
  const skipForProduct = hasProductWithDimensions && LOGISTICS_INTENTS_SKIP.has(classification?.intent);
  if (skipForProduct) {
    console.log(`\u{1F4E6} Product + dimensions detected \u2014 skipping dispatcher`);
  }

  const shouldDispatch =
    !isLowConfidence &&
    !skipForProduct &&
    (!convo?.pendingHandoff || INFORMATIONAL_INTENTS.has(classification?.intent));

  if (shouldDispatch) {
    const dispatcherResponse = await dispatchToHandler(classification, { psid, convo, userMessage });
    if (dispatcherResponse) {
      console.log(`\u2705 Intent handled by dispatcher (${dispatcherResponse.handledBy})`);
      ctx.response = dispatcherResponse;
      ctx.handledBy = dispatcherResponse.handledBy || "intent_dispatcher";
      return;
    }
  } else if (!isLowConfidence) {
    console.log(`\u23ED\uFE0F Skipping dispatcher - pendingHandoff active`);
  }

  await next();
};
