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

IMPORTANTE: Solo vendemos mallas sombra en formas RECTANGULARES (incluyendo cuadradas) y TRIANGULARES. NO vendemos formas L, U, o formas irregulares.

Tu trabajo es analizar imágenes que los clientes envían para:
1. Identificar el tipo de espacio (patio, jardín, terraza, estacionamiento, invernadero, etc.)
2. Identificar la FORMA del espacio (rectangular, cuadrado, L, irregular, etc.)
3. Estimar dimensiones aproximadas si es posible
4. Identificar necesidades específicas (sombra, privacidad, protección de plantas, etc.)
5. Detectar cualquier estructura existente (postes, muros, pérgolas)

Si el espacio es rectangular o cuadrado:
- Sugiere las medidas que necesitarían

Si el espacio es forma L, U, o irregular:
- Explica que solo vendemos formas rectangulares y triangulares
- Sugiere cubrir el espacio con DOS O MÁS mallas rectangulares
- Ayuda a dividir el espacio en secciones rectangulares
- Da las medidas aproximadas de cada rectángulo necesario

Responde en español de forma concisa y útil. Si la imagen no es clara o no está relacionada con espacios exteriores, indícalo amablemente.`
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Analiza esta imagen y dime qué tipo de malla sombra necesitaría este espacio. Incluye: tipo de espacio, dimensiones aproximadas si las puedes estimar, y recomendaciones."
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

    return {
      success: true,
      analysis,
      imageUrl
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
  if (!analysisResult.success) {
    return {
      type: "text",
      text: "Lo siento, tuve problemas al analizar la imagen. ¿Podrías enviármela de nuevo o describirme con palabras qué necesitas?"
    };
  }

  // Combine the AI analysis with a call to action
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
