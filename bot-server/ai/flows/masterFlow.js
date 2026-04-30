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

  const { conversationHistory = '', colorNote = null, products = [] } = context;

  try {
    const info = await getBusinessInfo();
    const afterHours = !isBusinessHours();

    const channelBlock = context.salesChannel === 'direct'
      ? `CANAL DE VENTA: Venta directa (NO Mercado Libre).
- Pago: el pago se realiza al ordenar, mediante transferencia o depósito bancario.
- Envío: por paquetería a todo México, costo depende de la ubicación del cliente.
- Factura: la emitimos directamente al confirmar el pedido.`
      : `CANAL DE VENTA: Mercado Libre.
- Pago: el pago se realiza al ordenar en Mercado Libre (tarjeta crédito/débito, OXXO, transferencia, meses sin intereses). La compra es segura: si no recibes tu artículo, se devuelve tu dinero.
- Envío: INCLUIDO en todas las compras por Mercado Libre. Tarda aprox 3-5 días hábiles.
- Compra protegida: si no llega, llega defectuoso o diferente, Mercado Libre devuelve el dinero.
- Factura: Mercado Libre la genera automáticamente con los datos fiscales del cliente.`;

    const systemPrompt = `Eres asesora de ventas de Hanlob, empresa mexicana fabricante de malla sombra.
Tu trabajo es responder SOLO preguntas concretas sobre datos del negocio. Todo lo demás es para otro flujo.

PRINCIPIO CLAVE: Como ya hay un flujo activo con productos asignados, NO eres punto de entrada de cold-start.
El cliente ya está en una conversación con contexto. Tu rol es apoyar respondiendo preguntas concretas
sobre el negocio, NO atender saludos ni invitar al cliente a hablar de productos.

CLASIFICACIÓN — responde con JSON:

1. Cliente pide hablar con un humano/especialista/asesor:
   → { "type": "handoff", "reason": "<razón breve>" }

2. Pregunta CONCRETA y EXPLÍCITA sobre uno de estos temas del negocio:
   ubicación/dónde están, horario, teléfono/contacto, métodos de pago (tarjeta, OXXO, transferencia),
   factura, envío (costo/tiempos), compra protegida/seguridad, instalación.
   La pregunta debe ser identificable sin ambigüedad. No basta con que el mensaje "podría" ser sobre esto.
   EXCEPCIÓN CRÍTICA: "¿Cómo compro?", "¿Cómo realizo una compra?", "Quiero comprar", "Mándame el link",
   "Pásame el enlace" y cualquier intención de COMPRA son product_specific (categoría 5), NO categoría 2.
   Solo es categoría 2 si preguntan específicamente por el MÉTODO de pago ("aceptan tarjeta?",
   "puedo pagar en OXXO?", "tienen meses sin intereses?"), NO si quieren comprar.
   → { "type": "response", "text": "<respuesta>", "intent": "<tema>" }
   Temas: phone_request, trust_concern, pay_on_delivery, location, shipping, payment_method, invoice, installation, farewell, general

3. Agradecimiento o despedida pura (gracias, adiós, bye, hasta luego) SIN pregunta adicional:
   → { "type": "response", "text": "<despedida breve>", "intent": "farewell" }

4. El cliente responde DATOS CONCRETOS que el bot le pidió explícitamente (código postal, ciudad, nombre, teléfono) — verifica en el historial que el bot hizo esa pregunta específica. NO uses esta categoría si el bot solo presentó un producto/promoción:
   → { "type": "response", "text": "<acuse de recibo breve y natural>", "intent": "general" }
   NUNCA respondas "Gracias por la información" — eso suena a que el cliente nos dio información cuando no es así.
   Cuando el cliente comparte su código postal o ciudad, di "Gracias por compartir tu código postal" (NO "ubicación").

5. CUALQUIER OTRA COSA — saludos, expresiones vagas de interés, preguntas ambiguas, mensajes sobre el producto,
   intención de compra:
   → { "type": "product_specific" }
   Ejemplos que SIEMPRE son product_specific: "Hola", "Qué tal", "Buen día", "Quiero información",
   "Quiero más info", "Me interesa", "Cuéntame", "Información", "Info", "Buenas", "Hola buen día",
   "Quiero saber más", "Dime", "Qué tienen", "A la orden", "Buenas tardes",
   "¿Cómo compro?", "¿Cómo realizo una compra?", "Quiero comprar", "Lo quiero",
   "Mándame el link", "Pásame el enlace", "Me lo llevo", "Sí lo quiero", "Listo",
   "¿Dónde se pide?", "¿Dónde lo pido?", "¿Cómo lo pido?", "¿Dónde lo compro?",
   "¿Cómo lo ordeno?", "Lo quiero pedir", "Me interesa comprarlo".
   Estos son saludos, expresiones de interés, o intención de compra — NO son preguntas generales
   del negocio. Déjalas pasar.

REGLA DE ORO: Si el mensaje no menciona EXPLÍCITAMENTE uno de los temas de la categoría 2
(ubicación, horario, teléfono, pago, factura, envío, seguridad, instalación), es product_specific.
Saludos y expresiones de interés vagas SIEMPRE son product_specific, NUNCA categoría 2.

FORMATO DE RESPUESTAS:
- Español mexicano, amable y conciso (2-4 oraciones máximo)
- Usa solo datos reales proporcionados
- Solo incluye URLs que estén EXPLÍCITAMENTE en los datos proporcionados (Google Maps para ubicación, WhatsApp para teléfono, links de PRODUCTOS DE ESTA CONVERSACIÓN). NUNCA inventes, construyas ni adivines URLs. Si no tienes un link concreto en los datos, NO incluyas ningún link — simplemente responde sin URL. Está PROHIBIDO usar https://www.mercadolibre.com.mx u otra URL genérica
- Solo menciona detalles de pago si el cliente pregunta específicamente por eso (cómo pagar, en qué cuenta depositar, si es por adelantado, etc). No menciones el pago proactivamente.
- Cuando el cliente pregunte por pago: "El pago se realiza al ordenar y tu compra por Mercado Libre es segura, si no recibes tu artículo se devuelve tu dinero."
- Usa el historial de conversación para entender el contexto del mensaje
- Si el cliente pide que le envíen/manden el producto, da su dirección, o pregunta cuándo le llega SIN haber comprado: explica que primero debe realizar su compra por Mercado Libre usando el link que se le compartió, y una vez que compre el envío tarda 3-5 días hábiles. Incluye el link de compra si está disponible en el contexto.
- PROHIBIDO responder con frases genéricas vagas como "Gracias por la información", "¿Necesitas algo más?", "¿En qué te puedo ayudar?" sin contenido útil. Si no tienes nada útil que agregar, clasifica como product_specific.
- Solo devuelve JSON`;

    // Build product context so AI answers shipping/payment questions with specific product info
    let productBlock = '';
    if (products.length > 0) {
      const summary = products.length <= 3
        ? products.map(p => `${p.name} — $${p.price}${p.link ? ` (link: ${p.link})` : ''}`).join('\n')
        : `${products.length} productos, desde ${products[0]?.name} ($${products[0]?.price}) hasta ${products[products.length - 1]?.name} ($${products[products.length - 1]?.price})`;
      productBlock = `\nPRODUCTOS DE ESTA CONVERSACIÓN:\n${summary}\nCuando respondas preguntas sobre envío, pago, compra, etc., hazlo EN CONTEXTO de estos productos. Si el cliente pregunta cómo comprar, menciónales el producto y link concreto, no digas "visita Mercado Libre" de forma genérica.`;
    }

    const businessData = `DATOS DEL NEGOCIO:
${channelBlock}
- Ubicación: Querétaro, Microparque Industrial Navex Park, Tlacote
- Dirección: ${STORE_ADDRESS || 'Microparque Industrial Navex Park, Tlacote, Querétaro'}
- Google Maps: ${MAPS_URL}
- Teléfono: ${info?.phones?.[0] || '442 352 1646'}
- WhatsApp: https://wa.me/524425957432
- Horario: ${info?.hours || 'Lun-Vie 8am-6pm'}
- Envío a todo México y Estados Unidos
- Más de 5 años de experiencia como fabricantes
${afterHours ? '- Fuera de horario: si el cliente necesita un especialista, le contactarán el siguiente día hábil.' : ''}
- Instalación: no contamos con servicio de instalación.${context.installationNote ? ' ' + context.installationNote : ''}
${colorNote ? `- Color: ${colorNote}` : ''}
${productBlock}`;

    const userContext = [];
    if (convo?.userName) userContext.push(`Nombre del cliente: ${convo.userName}`);
    if (convo?.lastSharedProductLink) userContext.push(`Link de compra compartido: ${convo.lastSharedProductLink}`);
    if (convo?.lastBotResponse) userContext.push(`Último mensaje del bot: "${convo.lastBotResponse.slice(0, 120)}"`);
    const contextStr = userContext.length > 0 ? `\n${userContext.join('\n')}` : '';

    const userPrompt = `${businessData}
${contextStr}
${conversationHistory ? `\n${conversationHistory}` : ''}
Mensaje del cliente: ${userMessage}`;

    const response = await _openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
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
      // Farewell dedup: don't repeat farewell on consecutive thanks/goodbye
      const isFarewell = result.intent === 'farewell';
      const alreadyClosing = convo?.lastIntent === 'farewell' || convo?.lastIntent === 'thanks' || convo?.lastIntent === 'goodbye';
      if (isFarewell && alreadyClosing) {
        console.log('🏛️ [master] Consecutive farewell — short reply');
        await updateConversation(psid, { lastIntent: 'farewell', unknownCount: 0 });
        return { type: "text", text: "¡Con gusto! Aquí estamos para cuando necesites." };
      }

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
