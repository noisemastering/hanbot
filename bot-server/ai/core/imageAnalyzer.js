// ai/core/imageAnalyzer.js
// Analyzes images sent by users using GPT-4 Vision

/**
 * Analyzes an image URL to extract relevant information about malla sombra needs
 * @param {string} imageUrl - URL of the image to analyze
 * @param {object} openai - OpenAI client instance
 * @returns {object} - Analysis result with extracted information
 */
async function analyzeImage(imageUrl, openai) {
  try {
    console.log(`🖼️  Analyzing image: ${imageUrl}`);

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `Eres un asistente experto en mallas sombra para jardines, patios y espacios exteriores.

NUESTROS PRODUCTOS:
- Mallas sombra en formas RECTANGULARES (incluyendo cuadradas) y TRIANGULARES
- NO vendemos formas L, U, o formas irregulares
- NO ofrecemos servicios de instalación, reparación, o forrado de estructuras existentes

Tu trabajo es analizar imágenes y clasificarlas en una de estas categorías:

CATEGORÍA A - ESPACIO QUE NECESITA SOMBRA:
Si ves un espacio abierto (patio, jardín, terraza, estacionamiento) que podría cubrirse con malla:
1. Identifica el tipo de espacio
2. Identifica la FORMA (rectangular, cuadrado, L, irregular)
3. Estima dimensiones aproximadas si es posible
4. Sugiere las medidas de malla que necesitarían

Si es forma L o irregular, explica que pueden usar DOS mallas rectangulares.

CATEGORÍA B - ESTRUCTURA EXISTENTE (sombrilla, toldo, pérgola con tela):
Si ves una estructura que YA tiene sombra (sombrilla de jardín, toldo, carpa, parasol):
- Responde: "CUSTOM_SERVICE_REQUEST"
- NO intentes analizar dimensiones
- NO sugieras productos

CATEGORÍA C - IMAGEN POSITIVA/AMIGABLE:
Si la imagen es de emojis positivos (caritas felices, pulgares arriba, corazones), stickers amigables, o imágenes que expresan gratitud/felicidad:
- Responde: "POSITIVE_IMAGE"

CATEGORÍA D - IMAGEN NO RELACIONADA:
Si la imagen no es de un espacio exterior, no está relacionada con sombra, y no es positiva/amigable:
- Responde: "UNRELATED_IMAGE"

Responde en español de forma concisa. Para categorías B, C y D, solo responde con el código indicado.`
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Analiza esta imagen. Si es un espacio que necesita sombra, describe el espacio y sugiere medidas. Si es una estructura existente (sombrilla, toldo, etc.) o imagen no relacionada, indica el código correspondiente."
            },
            {
              type: "image_url",
              image_url: {
                url: imageUrl,
                detail: "high"
              }
            }
          ]
        }
      ],
      max_tokens: 500,
      temperature: 0.7
    });

    const analysis = response.choices[0].message.content;

    console.log(`✅ Image analysis completed`);
    console.log(`📝 Analysis: ${analysis.substring(0, 100)}...`);

    // Detect special cases
    const isCustomServiceRequest = analysis.includes("CUSTOM_SERVICE_REQUEST") ||
                                    /sombrilla|toldo|parasol|carpa|pérgola.*tela|forrar|reparar|cambiar.*tela/i.test(analysis);
    const isPositiveImage = analysis.includes("POSITIVE_IMAGE") ||
                            /emoji|carita|feliz|pulgar|coraz[oó]n|gracias|amigable/i.test(analysis);
    const isUnrelated = analysis.includes("UNRELATED_IMAGE");

    // Detect when AI can't properly analyze the image
    const cantAnalyze = /no (puedo|logro|es posible) (ver|analizar|identificar|determinar)/i.test(analysis) ||
                        /imagen (borrosa|oscura|no clara|cortada|incompleta)/i.test(analysis) ||
                        /no (se|está) (ve|clara|visible)/i.test(analysis) ||
                        /necesito más (información|contexto|detalles)/i.test(analysis) ||
                        /no tengo suficiente/i.test(analysis) ||
                        analysis.length < 30; // Very short response = likely couldn't analyze

    return {
      success: true,
      analysis,
      imageUrl,
      isCustomServiceRequest,
      isPositiveImage,
      isUnrelated,
      cantAnalyze
    };

  } catch (error) {
    console.error("❌ Error analyzing image:", error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Generates a helpful response based on image analysis
 * @param {object} analysisResult - Result from analyzeImage()
 * @returns {object} - Response object for the bot
 */
function generateImageResponse(analysisResult) {
  const { getHandoffTimingMessage } = require("../utils/businessHours");

  if (!analysisResult.success) {
    return {
      type: "text",
      text: `Gracias por la imagen. Te comunico con un especialista para ayudarte mejor.\n\n${getHandoffTimingMessage()}`,
      needsHandoff: true,
      handoffReason: "Error al procesar la imagen del cliente"
    };
  }

  // Handle cases where AI couldn't properly analyze the image
  if (analysisResult.cantAnalyze) {
    return {
      type: "text",
      text: `Gracias por la imagen. No logro verla bien, te comunico con un especialista que pueda ayudarte mejor.\n\n${getHandoffTimingMessage()}`,
      needsHandoff: true,
      handoffReason: "No se pudo analizar la imagen correctamente"
    };
  }

  // Handle positive/friendly images (emojis, thumbs up, hearts, etc.)
  if (analysisResult.isPositiveImage) {
    return {
      type: "text",
      text: "¡Gracias! 😊 ¿Hay algo más en lo que pueda ayudarte?"
    };
  }

  // Handle custom service requests (umbrella recovering, repairs, etc.)
  if (analysisResult.isCustomServiceRequest) {
    return {
      type: "text",
      text: "Gracias por la imagen. Veo que tienes una sombrilla/toldo existente.\n\n" +
            "Nosotros vendemos mallas sombra en medidas rectangulares y triangulares para cubrir espacios abiertos, " +
            "pero no ofrecemos servicio de forrado o reparación de estructuras existentes.\n\n" +
            "Si buscas cubrir un espacio abierto con malla sombra, con gusto te ayudo. " +
            "¿Tienes algún área descubierta que quieras proteger del sol?"
    };
  }

  // Handle unrelated images - hand off since we can't help
  if (analysisResult.isUnrelated) {
    return {
      type: "text",
      text: `Gracias por la imagen. Te comunico con un especialista para ayudarte.\n\n${getHandoffTimingMessage()}`,
      needsHandoff: true,
      handoffReason: "Cliente envió imagen no relacionada con mallas sombra"
    };
  }

  // Standard response for spaces that need shade
  const response = `${analysisResult.analysis}\n\n¿Te gustaría ver opciones de mallas sombra que se ajusten a tu espacio? Puedo mostrarte medidas y precios específicos.`;

  return {
    type: "text",
    text: response
  };
}

module.exports = {
  analyzeImage,
  generateImageResponse
};
