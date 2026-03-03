/**
 * Enrichment middleware: sourceContext
 *
 * Builds the source context object that describes where the conversation
 * originated (organic, ad, referral, etc.) and persists any newly resolved
 * ad context fields (adFlowRef, adProductIds, productInterest, currentFlow)
 * on the conversation document.
 *
 * Sets ctx.sourceContext for downstream middleware.
 * Always calls next() — never sets ctx.response.
 */

const { buildSourceContext, logSourceContext } = require("../context");
const { updateConversation } = require("../../conversationManager");

module.exports = async function sourceContext(ctx, next) {
  const { referral, psid, convo, userMessage } = ctx;

  const sourceCtx = await buildSourceContext(
    referral ? { referral, sender: { id: psid } } : { sender: { id: psid } },
    convo,
    convo?.channel || "facebook"
  );
  logSourceContext(psid, sourceCtx, userMessage);

  // Store ad context on conversation when resolved from ad hierarchy
  if (sourceCtx?.ad?.flowRef && !convo.adFlowRef) {
    await updateConversation(psid, { adFlowRef: sourceCtx.ad.flowRef });
    convo.adFlowRef = sourceCtx.ad.flowRef;
  }
  if (sourceCtx?.ad?.productIds?.length && !convo.adProductIds?.length) {
    await updateConversation(psid, { adProductIds: sourceCtx.ad.productIds });
    convo.adProductIds = sourceCtx.ad.productIds;
  }
  if (sourceCtx?.ad?.product && !convo.productInterest) {
    await updateConversation(psid, { productInterest: sourceCtx.ad.product });
    convo.productInterest = sourceCtx.ad.product;
  }

  // Set currentFlow from ad context
  if (!convo.currentFlow || convo.currentFlow === "default") {
    const adProduct = sourceCtx?.ad?.product || "";
    let adFlow = null;

    if (adProduct.startsWith("malla_sombra") || adProduct === "confeccionada") {
      adFlow = "malla_sombra";
    } else if (adProduct.startsWith("rollo")) {
      adFlow = "rollo";
    } else if (adProduct.startsWith("borde")) {
      adFlow = "borde_separador";
    } else if (adProduct.startsWith("ground") || adProduct === "groundcover") {
      adFlow = "groundcover";
    } else if (adProduct.startsWith("mono")) {
      adFlow = "monofilamento";
    }

    if (adFlow) {
      await updateConversation(psid, { currentFlow: adFlow });
      convo.currentFlow = adFlow;
    }
  }

  ctx.sourceContext = sourceCtx;

  await next();
};
