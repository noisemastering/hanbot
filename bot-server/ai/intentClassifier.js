// ai/intentClassifier.js
const { OpenAI } = require("openai");
const mongoose = require("mongoose");

const openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

// Schema para logging de intenciones (para aprendizaje continuo)
const IntentLogSchema = new mongoose.Schema({
  psid: String,
  message: String,
  detectedIntent: String,
  confidence: Number,
  availableIntents: [String],
  timestamp: { type: Date, default: Date.now },
  responseGenerated: Boolean,
  context: Object // campaña, lastIntent, etc.
});

const IntentLog = mongoose.model("IntentLog", IntentLogSchema);

/**
 * Define all available intents with descriptions
 * This is the "brain" of the classification system
 */
const INTENT_DEFINITIONS = {
  // Core intents
  greeting: {
    description: "Usuario saluda o inicia conversación (hola, buenos días, hey, qué tal)",
    priority: 1
  },
  thanks: {
    description: "Usuario agradece o se despide (gracias, perfecto, adiós, bye)",
    priority: 1
  },

  // Product/Catalog intents
  catalog_overview: {
    description: "Usuario pregunta qué productos hay, catálogo general, qué venden",
    priority: 2
  },
  product_search: {
    description: "Usuario busca un producto específico por nombre, tipo o características (malla beige, rollo, confeccionada)",
    priority: 2
  },
  family_inquiry: {
    description: "Usuario pregunta sobre una familia de productos (malla sombra, borde)",
    priority: 2
  },

  // Measures intent (HIGH PRIORITY)
  measures_generic: {
    description: "Usuario pregunta por medidas/tamaños/precios disponibles en general (cuánto cuestan, qué medidas tienen, precios)",
    priority: 3,
    keywords: ["medida", "tamaño", "dimensión", "precio", "cuánto", "cuesta", "vale"]
  },
  measures_specific: {
    description: "Usuario da dimensiones específicas (4x5, de 8 8, 2.80 x 3.80, quiero una de X por Y metros)",
    priority: 3,
    keywords: ["x", "metros", "m²", "de", "por"]
  },
  measures_guidance: {
    description: "Usuario necesita ayuda para medir o menciona medida aproximada (necesito medir bien, aprox, más o menos)",
    priority: 3,
    keywords: ["medir", "aprox", "aproximad", "más o menos"]
  },

  // Service-related intents
  installation: {
    description: "Usuario pregunta por instalación, montaje, colocación, armado (¿la instalan?, ¿viene con montaje?, ¿la colocan?)",
    priority: 3,
    keywords: ["instal", "mont", "coloc", "armar", "poner"]
  },
  shipping: {
    description: "Usuario pregunta por envíos, entregas, domicilio, paquetería (¿hacen envíos?, ¿entregan a domicilio?, ¿cuánto tarda?)",
    priority: 3,
    keywords: ["envío", "entrega", "domicilio", "enviar", "llega", "paquete", "reparto"]
  },
  location: {
    description: "Usuario pregunta dónde están, ubicación, dirección, local (¿dónde quedan?, ¿cuál es su dirección?, ¿tienen tienda?)",
    priority: 3,
    keywords: ["donde", "ubicación", "dirección", "quedan", "local", "tienda", "mapa"]
  },

  // Feature/Specs intents
  colors: {
    description: "Usuario pregunta por colores disponibles (¿qué colores tienen?, ¿viene en verde?, ¿en azul?)",
    priority: 3,
    keywords: ["color", "verde", "azul", "negro", "blanco", "beige", "tono"]
  },
  material_specs: {
    description: "Usuario pregunta por material, calidad, especificaciones técnicas (¿de qué está hecha?, ¿qué material?, durabilidad)",
    priority: 2,
    keywords: ["material", "calidad", "duración", "resistente", "tejido"]
  },

  // Purchase-related
  details_request: {
    description: "Usuario pide más detalles, quiere ver un producto, o solicita información específica (dame más detalles, dejame ver, muéstrame, enseñame, ver la de, quiero ver)",
    priority: 3,
    keywords: ["detalles", "detalle", "más información", "más info", "especificaciones", "cuéntame más", "ver más", "dejame ver", "muéstrame", "enseñame", "quiero ver", "ver la", "ver el"]
  },
  buying_intent: {
    description: "Usuario quiere comprar, pedir, ordenar el producto (quiero comprar, lo quiero, me lo llevo, cómo lo compro, dónde compro)",
    priority: 4, // HIGH PRIORITY - conversion critical!
    keywords: ["comprar", "compro", "quiero", "pedir", "ordenar", "llevar", "adquirir", "necesito"]
  },
  payment_methods: {
    description: "Usuario pregunta formas de pago (¿cómo puedo pagar?, ¿aceptan tarjeta?, transferencia)",
    priority: 3,
    keywords: ["pago", "pagar", "tarjeta", "efectivo", "transferencia", "mercadopago"]
  },
  stock_availability: {
    description: "Usuario pregunta si hay stock, disponibilidad (¿tienen?, ¿hay disponible?, ¿cuándo llega?)",
    priority: 3,
    keywords: ["hay", "tienen", "disponible", "stock", "existencia"]
  },

  // Fallback
  unknown: {
    description: "No se puede clasificar claramente en ninguna otra intención",
    priority: 0
  }
};

/**
 * Classify user intent using OpenAI
 * @param {string} message - User's message
 * @param {object} context - Conversation context (psid, lastIntent, campaign, etc.)
 * @returns {object} - { intent, confidence, reasoning }
 */
async function classifyIntent(message, context = {}) {
  try {
    const intentList = Object.keys(INTENT_DEFINITIONS)
      .filter(key => key !== 'unknown')
      .map(key => `- ${key}: ${INTENT_DEFINITIONS[key].description}`)
      .join('\n');

    const systemPrompt = `Eres un clasificador de intenciones para un chatbot de ventas de mallas sombra en México.

Tu trabajo es clasificar el mensaje del usuario en UNA de las siguientes intenciones:

${intentList}

CONTEXTO IMPORTANTE:
- Los usuarios escriben con errores, abreviaciones, y mensajes incompletos
- El español mexicano usa mucho slang y modismos
- Las dimensiones pueden escribirse de muchas formas: "4x5", "de 4 5", "4 por 5 metros"
- Si mencionan números con "x" o "por", probablemente es measures_specific
- Si preguntan "cuánto" sin dar medidas, es measures_generic

REGLAS DE PRIORIDAD:
1. Si dice "quiero comprar", "lo compro", "me lo llevo" → buying_intent (MUY IMPORTANTE!)
2. Si hay dimensiones específicas (números + x/por) → measures_specific
3. Si pregunta instalación/montaje/colocación → installation
4. Si pregunta ubicación/dirección/dónde → location
5. Si pregunta envíos/entregas → shipping
6. Si pregunta colores → colors

Responde ÚNICAMENTE con este formato JSON (sin explicaciones adicionales):
{
  "intent": "nombre_de_la_intencion",
  "confidence": 0.95,
  "reasoning": "Breve razón de 1 línea"
}`;

    const userPrompt = `Mensaje del usuario: "${message}"

${context.lastIntent ? `Última intención detectada: ${context.lastIntent}` : ''}
${context.campaignRef ? `Usuario viene de campaña: ${context.campaignRef}` : ''}

Clasifica esta intención:`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Fast and cheap, perfect for classification
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.1, // Low temp for consistent classification
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(response.choices[0].message.content);

    // Log for learning
    await logIntent({
      psid: context.psid,
      message,
      detectedIntent: result.intent,
      confidence: result.confidence,
      availableIntents: Object.keys(INTENT_DEFINITIONS),
      context: {
        lastIntent: context.lastIntent,
        campaignRef: context.campaignRef
      }
    });

    console.log(`🧠 AI Intent: ${result.intent} (${(result.confidence * 100).toFixed(0)}%) - ${result.reasoning}`);

    return result;

  } catch (error) {
    console.error("❌ Error clasificando intención:", error.message);

    // Fallback to pattern-based detection
    return {
      intent: "unknown",
      confidence: 0,
      reasoning: "Error en clasificación AI, usando fallback"
    };
  }
}

/**
 * Log intent classification for continuous learning
 */
async function logIntent(data) {
  try {
    await IntentLog.create(data);
  } catch (error) {
    console.error("⚠️ Error logging intent:", error.message);
  }
}

/**
 * Get intent statistics for analysis
 */
async function getIntentStats(days = 7) {
  const since = new Date();
  since.setDate(since.getDate() - days);

  try {
    const stats = await IntentLog.aggregate([
      { $match: { timestamp: { $gte: since } } },
      {
        $group: {
          _id: "$detectedIntent",
          count: { $sum: 1 },
          avgConfidence: { $avg: "$confidence" }
        }
      },
      { $sort: { count: -1 } }
    ]);

    return stats;
  } catch (error) {
    console.error("❌ Error obteniendo estadísticas:", error);
    return [];
  }
}

/**
 * Get low-confidence classifications for review
 */
async function getLowConfidenceClassifications(threshold = 0.7, limit = 50) {
  try {
    return await IntentLog.find({
      confidence: { $lt: threshold }
    })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
  } catch (error) {
    console.error("❌ Error obteniendo clasificaciones de baja confianza:", error);
    return [];
  }
}

module.exports = {
  classifyIntent,
  getIntentStats,
  getLowConfidenceClassifications,
  INTENT_DEFINITIONS
};
