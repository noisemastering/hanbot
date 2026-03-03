/**
 * Guard middleware: payOnDelivery
 *
 * Detects messages asking about cash-on-delivery / "contra entrega" via regex.
 * Delegates to the logistics handler for a context-aware response (ML vs
 * non-ML flow).  Skipped when the classifier tags the message as a
 * MULTI_QUESTION so the AI splitter can handle compound queries instead.
 */

const { INTENTS } = require("../classifier");

const payOnDeliveryPattern = /\b(pago\s+(al\s+)?(recibir|entregar?)|contra\s*entrega|contraentrega|cuando\s+llegue\s+pago|al\s+recibir|la\s+pago\s+al\s+entregar|se\s+paga\s+al\s+(recibir|entregar?)|cobr[ao]\s+al\s+(recibir|entregar?))\b/i;

module.exports = async function payOnDelivery(ctx, next) {
  const { userMessage, classification, psid, convo } = ctx;

  if (payOnDeliveryPattern.test(userMessage) && classification?.intent !== INTENTS.MULTI_QUESTION) {
    console.log("💳 Pay-on-delivery question detected via regex, forcing explicit NO");

    // Lazy-require to avoid circular dependency at load time
    const logisticsHandlers = require("../handlers/logistics");
    const podResponse = await logisticsHandlers.handlePayOnDelivery({ psid, convo });

    if (podResponse) {
      ctx.response = podResponse;
      ctx.handledBy = "pay_on_delivery";
      return;
    }
  }

  await next();
};
