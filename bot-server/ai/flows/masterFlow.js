// ai/flows/masterFlow.js
// Model flow — 100% AI-driven, no regex.
// Handles general questions: location, schedule, payment, generic store link, etc.
// Sits above everything else. Called by convo_flows, never drives a conversation alone.
//
// context = {
//   salesChannel: 'mercado_libre' | 'direct',   // determines payment/shipping details
//   installationNote: string|null,               // optional extra note for installation answers
// }

const { OpenAI } = require("openai");
const { getBusinessInfo, MAPS_URL, STORE_ADDRESS } = require("../../businessInfoManager");
const { updateConversation } = require("../../conversationManager");
const { executeHandoff } = require("../utils/executeHandoff");
const { isBusinessHours } = require("../utils/businessHours");

const _openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

/**
 * Classify and respond to general questions.
 * Returns a response object or null (let the calling flow handle it).
 */
async function handle(userMessage, convo, psid, context = {}) {
  if (!userMessage) return null;

  try {
    const info = await getBusinessInfo();
    const afterHours = !isBusinessHours();

    const channelBlock = context.salesChannel === 'direct'
      ? `CANAL DE VENTA: Venta directa (NO Mercado Libre).
- Pago: 100% por adelantado mediante transferencia o depósito bancario.
- Envío: por paquetería a todo México, costo depende de la ubicación del cliente.
- Factura: la emitimos directamente al confirmar el pedido.`
      : `CANAL DE VENTA: Mercado Libre.
- Pago: 100% por adelantado al ordenar en Mercado Libre (tarjeta crédito/débito, OXXO, transferencia, meses sin intereses).
- Envío: INCLUIDO en todas las compras por Mercado Libre. Tarda aprox 3-5 días hábiles.
- Compra protegida: si no llega, llega defectuoso o diferente, Mercado Libre devuelve el dinero.
- Factura: Mercado Libre la genera automáticamente con los datos fiscales del cliente.`;

    const systemPrompt = `Eres asesora de ventas de Hanlob, empresa mexicana fabricante de malla sombra.
Tu trabajo es clasificar el mensaje del cliente y responder SI es una pregunta general.
Si el mensaje es sobre un PRODUCTO ESPECÍFICO (medidas, cotización, colores, porcentaje de sombra, comparación de productos), NO respondas — devuelve product_specific para que otro flujo lo maneje.

${channelBlock}

DATOS DEL NEGOCIO:
- Ubicación: Querétaro, Microparque Industrial Navex Park, Tlacote
- Dirección: ${STORE_ADDRESS || 'Microparque Industrial Navex Park, Tlacote, Querétaro'}
- Google Maps: ${MAPS_URL}
- Teléfono: ${info?.phones?.[0] || '442 352 1646'}
- WhatsApp: https://wa.me/524425957432
- Horario: ${info?.hours || 'Lun-Vie 8am-6pm'}
- Envío a todo México y Estados Unidos
- Más de 5 años de experiencia como fabricantes
${afterHours ? '- FUERA DE HORARIO: si el cliente necesita un especialista, menciona que le contactarán el siguiente día hábil.' : ''}

REGLAS DE PAGO:
- NUNCA digas que tenemos pago contra entrega — NO lo manejamos.
- SIEMPRE di "100% por adelantado", nunca frases ambiguas.

INSTALACIÓN: No contamos con servicio de instalación.${context.installationNote ? ' ' + context.installationNote : ''}

INSTRUCCIONES:
Clasifica el mensaje y responde con JSON:

1. Si el cliente pide hablar con un humano/especialista/asesor:
   → { "type": "handoff", "reason": "<razón breve>" }

2. Si es una pregunta general que puedes responder con los datos de arriba (envío, pago, ubicación, factura, instalación, teléfono, confianza/seguridad, horario, etc.):
   → { "type": "response", "text": "<respuesta>", "intent": "<tema>" }
   Temas: phone_request, trust_concern, pay_on_delivery, location, shipping, payment_method, invoice, installation, farewell, general

3. Si es un agradecimiento o despedida (gracias, adiós, bye) sin pregunta adicional:
   → { "type": "response", "text": "<despedida breve>", "intent": "farewell" }

4. Si es sobre un producto específico (medidas, cotización, precio, colores, porcentaje, comparación, compra) o si NO estás seguro:
   → { "type": "product_specific" }

REGLAS:
- Español mexicano, amable y conciso (2-4 oraciones máximo)
- NUNCA inventes precios ni medidas
- NUNCA incluyas URLs en tu respuesta EXCEPTO el link de Google Maps cuando pregunten ubicación y el WhatsApp cuando compartas el teléfono
- Si tienes duda entre "general" y "producto específico", SIEMPRE devuelve product_specific
- Solo devuelve JSON, nada más`;

    const userContext = [];
    if (convo?.userName) userContext.push(`Nombre: ${convo.userName}`);
    if (convo?.lastSharedProductLink) userContext.push(`(Ya se le compartió un link de compra previamente)`);
    if (convo?.lastBotResponse) userContext.push(`Último mensaje del bot: "${convo.lastBotResponse.slice(0, 120)}"`);
    const contextStr = userContext.length > 0 ? `\n[Contexto: ${userContext.join(' | ')}]` : '';

    const response = await _openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `${userMessage}${contextStr}` }
      ],
      temperature: 0.2,
      max_tokens: 300,
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(response.choices[0].message.content);
    console.log(`🏛️ [master] AI classified: ${result.type}${result.intent ? ` (${result.intent})` : ''}`);

    // ── HANDOFF: customer wants a human ──
    if (result.type === 'handoff') {
      return await executeHandoff(psid, convo, userMessage, {
        reason: result.reason || `Cliente pide hablar con un especialista`,
        responsePrefix: result.text || 'Con gusto te comunico con un especialista.',
        lastIntent: 'human_escalation',
        timingStyle: 'elaborate'
      });
    }

    // ── RESPONSE: AI answered a general question ──
    if (result.type === 'response' && result.text) {
      await updateConversation(psid, {
        lastIntent: result.intent || 'master_flow_response',
        unknownCount: 0
      });
      return { type: "text", text: result.text };
    }

    // ── PRODUCT-SPECIFIC: let the calling flow handle it ──
    return null;

  } catch (err) {
    console.error(`❌ [master] AI error:`, err.message);
    return null; // On error, fall through to calling flow
  }
}

module.exports = { handle };
