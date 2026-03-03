/**
 * Post-processor: payOnDeliveryCheck
 *
 * If the user mentioned "contra entrega" (cash-on-delivery) but the AI
 * response doesn't already address it, append a clarification note
 * explaining that payment must be made upfront.
 *
 * For non-Mercado-Libre flows (rollo, groundcover, monofilamento, wholesale)
 * the note mentions bank transfer / deposit.  For ML flows it mentions
 * Mercado Libre buyer protection.
 */

const payOnDeliveryPattern = /\b(pago\s+(al\s+)?(recibir|entregar?)|contra\s*entrega|contraentrega|cuando\s+llegue\s+pago|al\s+recibir|la\s+pago\s+al\s+entregar|se\s+paga\s+al\s+(recibir|entregar?)|cobr[ao]\s+al\s+(recibir|entregar?))\b/i;

module.exports = async function payOnDeliveryCheck(ctx) {
  const { response, userMessage, convo } = ctx;

  if (!response || !response.text) return;
  if (!payOnDeliveryPattern.test(userMessage)) return;

  // Already addressed in the response – nothing to do
  if (/contra\s*entrega|no manejamos.*(pago|contra)|pago.*(adelantado|al\s+ordenar)/i.test(response.text)) return;

  const isNonML =
    convo?.currentFlow === 'rollo' ||
    convo?.currentFlow === 'groundcover' ||
    convo?.currentFlow === 'monofilamento' ||
    convo?.productInterest === 'rollo' ||
    convo?.productInterest === 'groundcover' ||
    convo?.productInterest === 'monofilamento' ||
    convo?.isWholesaleInquiry;

  const contraEntregaNote = isNonML
    ? 'Sobre el pago: no manejamos contra entrega. El pago es 100% por adelantado a través de transferencia o depósito bancario.'
    : 'Sobre el pago: no manejamos contra entrega. El pago es 100% por adelantado al momento de ordenar en Mercado Libre. Tu compra está protegida: si no te llega o llega diferente, se te devuelve tu dinero.';

  response.text += '\n\n' + contraEntregaNote;
  console.log('💳 Post-check: appended contra-entrega clarification to response');
};
