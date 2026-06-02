/**
 * Post-processor: payOnDeliveryCheck
 *
 * Hanlob policy (clarified):
 *  - In-store pickup at our Querétaro location: customer can pay in person
 *    (cash, card, transfer) when they pick up the order.
 *  - ANY shipped order (Mercado Libre, marketplaces, direct shipping):
 *    payment is UPFRONT, never COD / contra entrega.
 *
 * The AI sometimes hallucinates that we offer COD "only in Querétaro" —
 * conflating in-store pickup payment with shipped COD. That answer is wrong
 * and customer-misleading.
 *
 * This post-processor:
 *  1. Detects if the user asked about payment-on-delivery
 *  2. If the AI's response wrongly AFFIRMS we offer COD, REPLACE the
 *     response with the correct deterministic answer.
 *  3. If the AI didn't mention COD at all, APPEND a clarification.
 */

const payOnDeliveryPattern = /\b(pago\s+(al\s+)?(recibir|entregar?)|pago\s+a\s+la\s+entrega|contra\s*entrega|contraentrega|cuando\s+llegue\s+pago|al\s+recibir|la\s+pago\s+al\s+entregar|se\s+paga\s+al\s+(recibir|entregar?)|cobr[ao]\s+al\s+(recibir|entregar?))\b/i;

// Detects AI responses that wrongly say we offer COD.
// Triggers on affirmative phrases combined with COD keywords.
const wrongAffirmationPattern = /\b(s[ií]\s+(tenemos|ofrecemos|manejamos|disponemos|hay|aceptamos|contamos\s+con)|claro\s+(que\s+)?(s[ií]|tenemos)|por\s+supuesto\s+que\s+(s[ií]|tenemos)|tenemos\s+(pago\s+)?contra\s*entrega|ofrecemos\s+(pago\s+)?contra\s*entrega|aceptamos\s+(pago\s+)?contra\s*entrega|contra\s*entrega.{0,80}(disponible|disponemos|querétaro|queretaro)|querétaro.{0,80}contra\s*entrega|queretaro.{0,80}contra\s*entrega)\b/i;

// Detects that the response correctly denies COD or correctly explains upfront payment.
const correctlyDeniesPattern = /\b(no\s+(manejamos|ofrecemos|tenemos|aceptamos)\s+(pago\s+)?contra\s*entrega|no\s+hay\s+(pago\s+)?contra\s*entrega|pago\s+(es|debe\s+ser|se\s+(hace|realiza))\s+(por\s+)?adelantad[ao]|pago\s+al\s+ordenar|pago\s+anticipad[ao])\b/i;

module.exports = async function payOnDeliveryCheck(ctx) {
  const { response, userMessage, convo } = ctx;

  if (!response || !response.text) return;
  if (!payOnDeliveryPattern.test(userMessage)) return;

  const isNonML =
    convo?.currentFlow === 'rollo' ||
    convo?.currentFlow === 'groundcover' ||
    convo?.currentFlow === 'monofilamento' ||
    convo?.productInterest === 'rollo' ||
    convo?.productInterest === 'groundcover' ||
    convo?.productInterest === 'monofilamento' ||
    convo?.isWholesaleInquiry;

  const correctAnswer = isNonML
    ? 'No manejamos pago contra entrega. El pago se realiza al ordenar, mediante transferencia o depósito bancario. La única excepción es si pasas por tu pedido directamente a nuestra planta en Querétaro: ahí sí puedes pagar en persona al recoger.'
    : 'No manejamos pago contra entrega. El pago se realiza al ordenar en Mercado Libre (tarjeta, OXXO, transferencia, meses sin intereses) y tu compra está protegida: si no recibes el artículo, se devuelve tu dinero. La única excepción es si pasas por tu pedido directamente a nuestra planta en Querétaro: ahí sí puedes pagar en persona al recoger.';

  // INVERTED LOGIC: any mention of contra-entrega / pago-al-recibir in the
  // response MUST be paired with an explicit denial. Otherwise the AI is
  // either affirming, hedging, or being ambiguous — all of which the user
  // hears as "yes we have it". Default action: REPLACE with the deterministic
  // denial.
  const mentionsCOD = /\b(contra\s*entrega|contraentrega|pago\s+(al\s+)?(recibir|entregar?)|pago\s+a\s+la\s+entrega)\b/i.test(response.text);

  if (mentionsCOD && !correctlyDeniesPattern.test(response.text)) {
    console.log('🛑 Post-check: response mentions COD without explicit denial — replacing');
    response.text = correctAnswer;
    return;
  }

  // Response didn't address payment at all → APPEND
  if (!correctlyDeniesPattern.test(response.text)) {
    response.text += '\n\n' + correctAnswer;
    console.log('💳 Post-check: appended contra-entrega clarification');
  }
};
