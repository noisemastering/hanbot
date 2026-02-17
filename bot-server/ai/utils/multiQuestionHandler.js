// ai/utils/multiQuestionHandler.js
// Handles messages with multiple questions by splitting, routing each to the right handler, and combining answers

const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

const { INTENTS } = require("../classifier");
const { dispatch } = require("../intentDispatcher");
const ProductFamily = require("../../models/ProductFamily");
const { generateClickLink } = require("../../tracking");

// Intent values for the split+classify prompt
const AVAILABLE_INTENTS = Object.values(INTENTS).join(", ");

/**
 * Split a multi-question message into individual segments and classify each one.
 * Single AI call to split + classify in one shot.
 *
 * @param {string} userMessage - The user's full message
 * @returns {Array|null} Array of { question, intent } or null if single question / error
 */
async function splitAndClassify(userMessage) {
  try {
    const response = await openai.chat.completions.create({
      model: process.env.AI_MODEL || "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Eres un analizador de mensajes para un chatbot de ventas de malla sombra en México.

Tu tarea: dividir el mensaje del usuario en preguntas individuales y clasificar cada una.

INTENTS DISPONIBLES: ${AVAILABLE_INTENTS}

REGLAS:
- Si el mensaje tiene solo 1 pregunta sobre 1 producto/medida, responde con un array vacío []
- Si tiene 2+ preguntas O pide precio/info de 2+ medidas diferentes, sepáralas
- Cada medida diferente (ej: "2x4 y 5x6") es un segment separado con intent "price_query"
- Reformula cada pregunta como oración completa en español, incluyendo las dimensiones exactas
- Usa los intents exactos de la lista

Ejemplo: "Precio para 2x4m y 5x6m" →
{ "segments": [
  { "question": "¿Cuánto cuesta la malla de 2x4 metros?", "intent": "price_query" },
  { "question": "¿Cuánto cuesta la malla de 5x6 metros?", "intent": "price_query" }
]}

Responde ÚNICAMENTE con JSON:
{ "segments": [{ "question": "pregunta reformulada", "intent": "intent_key" }] }`
        },
        { role: "user", content: userMessage }
      ],
      temperature: 0.1,
      response_format: { type: "json_object" },
      max_tokens: 300
    });

    const result = JSON.parse(response.choices[0].message.content);
    const segments = result.segments;

    if (!Array.isArray(segments) || segments.length <= 1) {
      console.log(`📎 splitAndClassify: single question or empty, returning null`);
      return null;
    }

    console.log(`📎 splitAndClassify: ${segments.length} segments found:`, segments.map(s => s.intent).join(", "));
    return segments;
  } catch (error) {
    console.error("❌ Error in splitAndClassify:", error.message);
    return null;
  }
}

/**
 * Get an answer for a single question segment by routing to the appropriate handler.
 *
 * @param {object} segment - { question, intent }
 * @param {string} psid - User's PSID
 * @param {object} convo - Conversation state
 * @param {object} sourceContext - Source context
 * @param {object} campaign - Campaign object
 * @returns {string|null} Answer text or null
 */
async function getAnswerForSegment(segment, psid, convo, sourceContext, campaign) {
  try {
    // 1. If price_query or size_specification with dimensions, look up actual product
    if (segment.intent === "price_query" || segment.intent === "size_specification") {
      const dimMatch = segment.question.match(/(\d+(?:[.,]\d+)?)\s*[xX×*]\s*(\d+(?:[.,]\d+)?)/);
      if (dimMatch) {
        const d1 = parseFloat(dimMatch[1].replace(',', '.'));
        const d2 = parseFloat(dimMatch[2].replace(',', '.'));
        const w = Math.min(Math.floor(d1), Math.floor(d2));
        const h = Math.max(Math.floor(d1), Math.floor(d2));

        const answer = await lookupProductPrice(w, h, psid, convo);
        if (answer) {
          console.log(`  ✅ Segment "${segment.intent}" answered with product lookup for ${w}x${h}`);
          return answer;
        }
      }
    }

    // 2. Try intent dispatcher (covers location, shipping, payment, catalog, etc.)
    const classification = {
      intent: segment.intent,
      entities: {},
      confidence: 0.9
    };

    const dispatchResult = await dispatch(classification, {
      psid,
      convo,
      userMessage: segment.question
    });

    if (dispatchResult && dispatchResult.text) {
      console.log(`  ✅ Segment "${segment.intent}" answered by dispatcher`);
      return dispatchResult.text;
    }

    // 3. Product-specific intents — if in a product flow, get product description
    if (segment.intent === "product_inquiry" || segment.intent === "price_query") {
      const currentFlow = convo?.currentFlow || convo?.productInterest;

      if (currentFlow === "malla_sombra") {
        const { getMallaDescription } = require("../flows/mallaFlow");
        const desc = await getMallaDescription();
        console.log(`  ✅ Segment "${segment.intent}" answered by getMallaDescription`);
        return desc;
      }
    }

    // 4. No handler found — return null, combiner will handle gracefully
    console.log(`  ⚠️ Segment "${segment.intent}" has no handler, returning null`);
    return null;
  } catch (error) {
    console.error(`❌ Error getting answer for segment "${segment.intent}":`, error.message);
    return null;
  }
}

/**
 * Look up a product by dimensions and return a price answer string.
 */
async function lookupProductPrice(w, h, psid, convo) {
  try {
    const sizeRegex = new RegExp(
      `^\\s*(${w}\\s*m?\\s*[xX×]\\s*${h}|${h}\\s*m?\\s*[xX×]\\s*${w})\\s*m?\\s*$`, 'i'
    );

    const products = await ProductFamily.find({
      sellable: true,
      active: true,
      size: sizeRegex
    }).sort({ price: 1 }).lean();

    if (products.length === 0) return null;

    const product = products[0];
    const price = product.price ? `$${product.price.toLocaleString('es-MX')}` : null;
    if (!price) return null;

    // Try to get ML link
    let linkText = '';
    const storeLink = product.onlineStoreLinks?.find(l => l.platform === 'mercadolibre' || l.platform === 'mercado_libre');
    if (storeLink?.url) {
      try {
        const tracked = await generateClickLink(psid, storeLink.url, {
          reason: 'multi_size_quote',
          productId: product._id,
          size: `${w}x${h}`,
          userName: convo?.userName
        });
        linkText = `\n${tracked}`;
      } catch (e) {
        linkText = `\n${storeLink.url}`;
      }
    }

    return `Malla de ${w}x${h}m: ${price} con envío gratis${linkText}`;
  } catch (err) {
    console.error(`❌ Error looking up product ${w}x${h}:`, err.message);
    return null;
  }
}

/**
 * Combine multiple segment answers into a single natural response using AI.
 *
 * @param {string} userMessage - Original user message
 * @param {Array} segmentAnswers - Array of { question, answer } pairs
 * @param {object} convo - Conversation state
 * @returns {string} Combined response text
 */
async function combineAnswers(userMessage, segmentAnswers, convo) {
  try {
    const answeredSegments = segmentAnswers
      .map((s, i) => {
        if (s.answer) {
          return `Pregunta ${i + 1}: "${s.question}"\nRespuesta: ${s.answer}`;
        }
        return `Pregunta ${i + 1}: "${s.question}"\nRespuesta: (sin respuesta disponible)`;
      })
      .join("\n\n");

    const response = await openai.chat.completions.create({
      model: process.env.AI_MODEL || "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Eres una vendedora amigable de malla sombra en México. Combina las siguientes respuestas en un solo mensaje natural y fluido.

REGLAS:
- Responde TODAS las preguntas del cliente en un solo mensaje
- Sé concisa pero completa — no repitas información
- Si una pregunta no tiene respuesta, reconócela brevemente
- Usa un tono amigable y profesional, como una vendedora real
- NO uses listas con viñetas ni numeración — escribe de forma conversacional
- Termina con una pregunta para mantener la conversación
- NO inventes información que no esté en las respuestas proporcionadas`
        },
        {
          role: "user",
          content: `Mensaje original del cliente: "${userMessage}"\n\n${answeredSegments}`
        }
      ],
      temperature: 0.6,
      max_tokens: 500
    });

    const combined = response.choices[0].message.content;
    console.log(`📎 combineAnswers: combined ${segmentAnswers.length} answers into one response`);
    return combined;
  } catch (error) {
    console.error("❌ Error in combineAnswers:", error.message);
    // Fallback: join non-null answers with double newline
    return segmentAnswers
      .filter(s => s.answer)
      .map(s => s.answer)
      .join("\n\n");
  }
}

/**
 * Main handler: split multi-question message, route each segment, combine answers.
 *
 * @param {string} userMessage - The user's full message
 * @param {string} psid - User's PSID
 * @param {object} convo - Conversation state
 * @param {object} sourceContext - Source context
 * @param {object} campaign - Campaign object
 * @param {object} campaignContext - Campaign AI context
 * @returns {object|null} Response object or null to fall through to normal pipeline
 */
async function handleMultiQuestion(userMessage, psid, convo, sourceContext, campaign, campaignContext) {
  console.log(`\n📎 ===== MULTI-QUESTION HANDLER =====`);

  // 1. Split and classify
  const segments = await splitAndClassify(userMessage);
  if (!segments || segments.length <= 1) {
    console.log(`📎 Not a multi-question, falling through`);
    console.log(`📎 ===== END MULTI-QUESTION HANDLER =====\n`);
    return null;
  }

  // 2. Get answer for each segment
  const segmentAnswers = [];
  for (const segment of segments) {
    const answer = await getAnswerForSegment(segment, psid, convo, sourceContext, campaign);
    segmentAnswers.push({ question: segment.question, answer });
  }

  // 3. If ALL answers are null, fall through to normal pipeline
  if (segmentAnswers.every(s => !s.answer)) {
    console.log(`📎 All segments unanswered, falling through`);
    console.log(`📎 ===== END MULTI-QUESTION HANDLER =====\n`);
    return null;
  }

  // 4. Combine answers into a single natural response
  const combinedResponse = await combineAnswers(userMessage, segmentAnswers, convo);

  // 5. Update conversation
  const { updateConversation } = require("../../conversationManager");
  await updateConversation(psid, { lastIntent: "multi_question_handled" });

  console.log(`✅ Multi-question handled: ${segmentAnswers.filter(s => s.answer).length}/${segmentAnswers.length} segments answered`);
  console.log(`📎 ===== END MULTI-QUESTION HANDLER =====\n`);

  return { type: "text", text: combinedResponse };
}

module.exports = { handleMultiQuestion, splitAndClassify, getAnswerForSegment, combineAnswers };
