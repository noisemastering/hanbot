// ai/utils/multiQuestionHandler.js
// Pipeline: Split → Regex answers → AI answers → AI combine
//
// 1. AI splits message into individual questions (NO answers generated)
// 2. Try regex/deterministic answers for each question — store results
// 3. For unanswered questions, ask AI (batch call)
// 4. AI combines all answers into one natural, human-readable response

const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.AI_API_KEY });
const { INTENTS } = require("../classifier");
const ProductFamily = require("../../models/ProductFamily");
const { generateClickLink } = require("../../tracking");
const { MAPS_URL } = require("../../businessInfoManager");

const AVAILABLE_INTENTS = Object.values(INTENTS).join(", ");

// ────────────────────────────────────────────────────────
// Step 1: Split message into individual questions (AI only — no answers)
// ────────────────────────────────────────────────────────
async function splitQuestions(userMessage) {
  try {
    const response = await openai.chat.completions.create({
      model: process.env.AI_MODEL || "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Eres un analizador de mensajes para un chatbot de ventas de malla sombra en México.

Tu tarea: dividir el mensaje del usuario en preguntas/solicitudes individuales y clasificar cada una.

INTENTS DISPONIBLES: ${AVAILABLE_INTENTS}

REGLAS:
- Si el mensaje tiene solo 1 pregunta/tema, responde con []
- Si tiene 2+ preguntas o temas distintos, sepáralos
- Cada medida DIFERENTE (ej: "2x4 y 5x6") es un segmento separado con intent "price_query"
- NUNCA dupliques la misma medida en múltiples segmentos — una medida = UN segmento de precio
- "precio y entrega" sobre UNA medida = 2 segmentos (precio + envío), NO 2 segmentos de precio
- Reformula cada pregunta como oración completa en español
- Usa los intents exactos de la lista

Ejemplos:
"Precio para 2x4m y 5x6m" → 2 segmentos (2 medidas, ambos price_query)
"6x4m precio y entrega" → 2 segmentos (price_query con medida + shipping_query)
"Malla 4x6 cuánto cuesta, envío y aceptan tarjeta?" → 3 segmentos (price_query + shipping_query + payment_query)
"Cuánto cuesta la de 3x4?" → [] (1 sola pregunta)
"Hola buenos días" → [] (1 solo tema)

Responde ÚNICAMENTE con JSON:
{ "segments": [{ "question": "pregunta reformulada", "intent": "intent_key" }] }`
        },
        { role: "user", content: userMessage }
      ],
      temperature: 0.1,
      response_format: { type: "json_object" },
      max_tokens: 400
    });

    const result = JSON.parse(response.choices[0].message.content);
    const segments = result.segments;

    if (!Array.isArray(segments) || segments.length <= 1) {
      console.log(`📎 Split: single question or empty → falling through`);
      return null;
    }

    console.log(`📎 Split into ${segments.length} segments:`, segments.map(s => `[${s.intent}] "${s.question}"`).join(" | "));
    return segments;
  } catch (error) {
    console.error("❌ Error in splitQuestions:", error.message);
    return null;
  }
}

// ────────────────────────────────────────────────────────
// Step 2: Try regex/deterministic answers for each segment
// Returns structured data — no AI calls, no state changes
// ────────────────────────────────────────────────────────
async function tryRegexAnswer(segment) {
  const intent = segment.intent;
  const question = segment.question;

  // ── Price query with dimensions → product DB lookup ──
  if (intent === "price_query" || intent === "size_specification") {
    const dimMatch = question.match(/(\d+(?:[.,]\d+)?)\s*[xX×*]\s*(\d+(?:[.,]\d+)?)/);
    if (dimMatch) {
      const d1 = parseFloat(dimMatch[1].replace(',', '.'));
      const d2 = parseFloat(dimMatch[2].replace(',', '.'));
      const w = Math.min(Math.floor(d1), Math.floor(d2));
      const h = Math.max(Math.floor(d1), Math.floor(d2));

      // Track whether we floored the customer's dimensions
      const wasFloored = (d1 !== Math.floor(d1)) || (d2 !== Math.floor(d2));
      const requestedSize = wasFloored ? `${Math.min(d1, d2)}x${Math.max(d1, d2)}` : null;

      const product = await lookupProduct(w, h);
      if (product) {
        return {
          type: 'product_quote',
          width: w,
          height: h,
          requestedSize,
          sizeAdjusted: wasFloored,
          price: product.price,
          productName: product.name,
          productId: product._id?.toString(),
          productUrl: (product.onlineStoreLinks?.find(l => l.isPreferred) || product.onlineStoreLinks?.[0])?.url,
          wholesaleMinQty: product.wholesaleMinQty || null
        };
      }
      // Product not found — leave unanswered for AI
      return null;
    }
  }

  // ── Common intents with deterministic answers ──
  // (no dispatcher — we just want text, no state changes)

  if (intent === "shipping_query" || intent === "shipping_included_query") {
    return { type: 'text', text: "La compra se realiza a través de Mercado Libre y el envío está incluido a todo México." };
  }

  if (intent === "delivery_time_query") {
    return { type: 'text', text: "El envío normalmente tarda de 3 a 5 días hábiles." };
  }

  if (intent === "payment_query") {
    return { type: 'text', text: "El pago es 100% por adelantado al momento de ordenar en Mercado Libre (tarjeta, efectivo en OXXO, o meses sin intereses). Tu compra está protegida." };
  }

  if (intent === "pay_on_delivery_query") {
    return { type: 'text', text: "No manejamos pago contra entrega. El pago es 100% por adelantado en Mercado Libre. Tu compra está protegida: si no te llega o llega diferente, se te devuelve tu dinero." };
  }

  if (intent === "location_query") {
    return { type: 'text', text: `Estamos en Querétaro. Te comparto nuestra ubicación:\n${MAPS_URL}\n\nRecuerda que enviamos a todo México.`, isLocation: true };
  }

  if (intent === "installation_query") {
    return { type: 'text', text: "No contamos con servicio de instalación, pero nuestra malla viene lista para instalar con ojillos cada 80 cm por lado." };
  }

  if (intent === "durability_query" || intent === "warranty_query") {
    return { type: 'text', text: "Nuestra malla confeccionada tiene una vida útil de hasta 5 años gracias al refuerzo en las esquinas. Resiste sol, viento y lluvia con protección UV." };
  }

  if (intent === "color_query") {
    return { type: 'text', text: "La malla confeccionada la manejamos en beige y negro." };
  }

  // Not a known regex intent — leave for AI
  return null;
}

// ── Product DB lookup (lightweight — no links, no state) ──
async function lookupProduct(w, h) {
  try {
    const sizeRegex = new RegExp(
      `^\\s*(${w}\\s*m?\\s*[xX×]\\s*${h}|${h}\\s*m?\\s*[xX×]\\s*${w})\\s*m?\\s*$`, 'i'
    );
    return await ProductFamily.findOne({
      sellable: true, active: true, size: sizeRegex
    }).sort({ price: 1 }).lean();
  } catch (err) {
    console.error(`❌ lookupProduct ${w}x${h}:`, err.message);
    return null;
  }
}

// ────────────────────────────────────────────────────────
// Step 3: AI answers for unanswered segments (single batch call)
// ────────────────────────────────────────────────────────
async function getAIAnswers(unansweredSegments, convo) {
  if (unansweredSegments.length === 0) return {};

  const questions = unansweredSegments.map((s, i) => `${i + 1}. ${s.question}`).join('\n');

  try {
    const response = await openai.chat.completions.create({
      model: process.env.AI_MODEL || "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Eres una asesora de ventas de Hanlob, empresa mexicana que vende malla sombra confeccionada.

PRODUCTO: Malla sombra raschel confeccionada, 90% cobertura, refuerzo en esquinas (vida útil hasta 5 años), ojillos cada 80 cm por lado, lista para instalar. Sí es reforzada — tiene refuerzo en las 4 esquinas.
COLORES: beige y negro.
MEDIDAS: Solo medidas estándar en números enteros (ej: 2x4, 3x5, 4x6). NO manejamos medidas con decimales (ej: 2.50, 3.50). Si preguntan por una medida con decimales, explicar que solo manejamos medidas enteras y que se recomienda la medida inmediata inferior para dar espacio a los tensores o soga sujetadora.
ENVÍO: incluido a todo México vía Mercado Libre.
PAGO: 100% por adelantado en Mercado Libre (tarjeta, OXXO, meses sin intereses). NO contra entrega.
UBICACIÓN: Querétaro, Microparque Industrial Navex Park, Tlacote.
MAYOREO: a partir de 5 piezas.
WhatsApp: https://wa.me/524425957432

Responde CADA pregunta de forma breve y directa (1-2 oraciones).
Si la pregunta NO se relaciona con nuestro negocio, responde "NO_APLICA".
NO inventes precios ni medidas.

Responde en JSON: { "answers": ["respuesta1", "respuesta2", ...] }`
        },
        { role: "user", content: `Preguntas del cliente:\n${questions}` }
      ],
      temperature: 0.3,
      response_format: { type: "json_object" },
      max_tokens: 500
    });

    const result = JSON.parse(response.choices[0].message.content);
    const answers = result.answers || [];

    const mapped = {};
    unansweredSegments.forEach((seg, i) => {
      const answer = answers[i];
      if (answer && answer !== 'NO_APLICA') {
        mapped[seg.question] = answer;
      }
    });

    return mapped;
  } catch (error) {
    console.error("❌ Error in getAIAnswers:", error.message);
    return {};
  }
}

// ────────────────────────────────────────────────────────
// Step 4: AI combines all answers into one natural response
// ────────────────────────────────────────────────────────
async function combineWithAI(segments, userMessage, psid, convo) {
  // Collect structured data for the combine prompt
  const answeredData = [];
  let productQuote = null;

  for (const seg of segments) {
    if (!seg.answer) continue;

    if (seg.answer.type === 'product_quote') {
      productQuote = seg.answer;
      if (seg.answer.sizeAdjusted && seg.answer.requestedSize) {
        answeredData.push(`- Precio: El cliente pidió ${seg.answer.requestedSize}m pero no manejamos medidas con decimales. La medida estándar más cercana es ${seg.answer.width}x${seg.answer.height}m a $${seg.answer.price} con envío incluido. (Es necesario considerar un tamaño menor para dar espacio a los tensores o soga sujetadora.)`);
      } else {
        answeredData.push(`- Precio: Malla de ${seg.answer.width}x${seg.answer.height}m a $${seg.answer.price} con envío incluido`);
      }
    } else {
      answeredData.push(`- ${seg.answer.text}`);
    }
  }

  const unansweredQuestions = segments.filter(s => !s.answer).map(s => s.question);

  // Generate tracked link for product quote
  let trackedLink = null;
  if (productQuote?.productUrl) {
    try {
      trackedLink = await generateClickLink(psid, productQuote.productUrl, {
        productName: productQuote.productName,
        productId: productQuote.productId,
        city: convo?.city,
        stateMx: convo?.stateMx
      });

      // Update conversation state (once, with the single product)
      const { updateConversation } = require("../../conversationManager");
      await updateConversation(psid, {
        lastSharedProductId: productQuote.productId,
        lastSharedProductLink: trackedLink,
        lastQuotedProducts: [{
          width: productQuote.width,
          height: productQuote.height,
          displayText: `${productQuote.width}x${productQuote.height}m`,
          price: productQuote.price,
          productId: productQuote.productId,
          productUrl: productQuote.productUrl,
          productName: productQuote.productName
        }],
        lastIntent: 'multi_question_handled',
        unknownCount: 0
      });
    } catch (e) {
      console.error("❌ Error generating tracked link:", e.message);
    }
  }

  // Build prompt for the combine step
  const dataLines = [];
  dataLines.push(`Mensaje original: "${userMessage}"`);
  dataLines.push(`\nDatos para incluir en la respuesta:`);
  dataLines.push(answeredData.join('\n'));

  if (trackedLink) {
    dataLines.push(`\nEnlace de compra (incluir en su propia línea con "🛒 Cómprala aquí:"): ${trackedLink}`);
  }
  if (productQuote?.wholesaleMinQty) {
    dataLines.push(`Mayoreo: a partir de ${productQuote.wholesaleMinQty} piezas.`);
  }
  if (unansweredQuestions.length > 0) {
    dataLines.push(`\nPreguntas sin respuesta (ignorar, NO mencionar): ${unansweredQuestions.join('; ')}`);
  }

  try {
    const response = await openai.chat.completions.create({
      model: process.env.AI_MODEL || "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Eres una asesora de ventas de Hanlob. Combina los datos en UN solo mensaje natural y conciso.

REGLAS:
- Integra todo de forma fluida — NO hagas listas ni repitas datos
- Si hay cotización, empieza con "Malla sombra raschel confeccionada con refuerzo en las esquinas para una vida útil de hasta 5 años:"
- Si hay enlace de compra, ponlo en su propia línea con "🛒 Cómprala aquí:" DESPUÉS de la descripción del producto
- Si hay info de mayoreo, ponla al final
- IGNORA las preguntas sin respuesta — no digas que no puedes responder
- NO inventes precios, medidas ni datos — usa SOLO los datos proporcionados
- NO agregues URLs que no te haya dado
- Tono amable y profesional, máximo 4-5 oraciones (sin contar enlace y mayoreo)`
        },
        { role: "user", content: dataLines.join('\n') }
      ],
      temperature: 0.5,
      max_tokens: 400
    });

    return { type: "text", text: response.choices[0].message.content.trim() };
  } catch (error) {
    console.error("❌ Error in combineWithAI:", error.message);

    // Fallback: join answers manually
    const textParts = [];
    for (const seg of segments) {
      if (!seg.answer) continue;
      if (seg.answer.type === 'product_quote') {
        textParts.push(`Malla de ${seg.answer.width}x${seg.answer.height}m: $${seg.answer.price} con envío incluido`);
      } else {
        textParts.push(seg.answer.text);
      }
    }
    let fallbackText = textParts.join('\n\n');
    if (trackedLink) {
      fallbackText += `\n\n🛒 Cómprala aquí:\n${trackedLink}`;
    }
    if (productQuote?.wholesaleMinQty) {
      fallbackText += `\n\nA partir de ${productQuote.wholesaleMinQty} piezas manejamos precio de mayoreo.`;
    }
    return { type: "text", text: fallbackText };
  }
}

// ────────────────────────────────────────────────────────
// Main handler
// ────────────────────────────────────────────────────────
async function handleMultiQuestion(userMessage, psid, convo, sourceContext, campaign, campaignContext) {
  console.log(`\n📎 ===== MULTI-QUESTION HANDLER =====`);

  // Step 1: Split into individual questions (AI — no answers)
  const segments = await splitQuestions(userMessage);
  if (!segments || segments.length <= 1) {
    console.log(`📎 ===== END MULTI-QUESTION HANDLER =====\n`);
    return null;
  }

  // Step 2: Try regex/deterministic answers for each segment
  for (const seg of segments) {
    const regexAnswer = await tryRegexAnswer(seg);
    if (regexAnswer) {
      seg.answer = regexAnswer;
      console.log(`  📋 [regex] ${seg.intent}: ✅`);
    } else {
      console.log(`  📋 [regex] ${seg.intent}: –`);
    }
  }

  // Step 3: AI answers for unanswered segments (single batch call)
  const unanswered = segments.filter(s => !s.answer);
  if (unanswered.length > 0) {
    console.log(`  🧠 Asking AI for ${unanswered.length} unanswered segment(s)`);
    const aiAnswers = await getAIAnswers(unanswered, convo);
    for (const seg of unanswered) {
      if (aiAnswers[seg.question]) {
        seg.answer = { type: 'text', text: aiAnswers[seg.question] };
        console.log(`  🧠 [AI] ${seg.intent}: ✅`);
      } else {
        console.log(`  🧠 [AI] ${seg.intent}: – (not applicable)`);
      }
    }
  }

  // If NO answers at all, fall through to normal pipeline
  if (segments.every(s => !s.answer)) {
    console.log(`📎 No answers found, falling through`);
    console.log(`📎 ===== END MULTI-QUESTION HANDLER =====\n`);
    return null;
  }

  // Step 4: AI combines all answers into one natural response
  const response = await combineWithAI(segments, userMessage, psid, convo);

  const answered = segments.filter(s => s.answer).length;
  console.log(`✅ Multi-question: ${answered}/${segments.length} segments answered`);
  console.log(`📎 ===== END MULTI-QUESTION HANDLER =====\n`);

  return response;
}

module.exports = { handleMultiQuestion, splitQuestions, tryRegexAnswer, getAIAnswers, combineWithAI };
