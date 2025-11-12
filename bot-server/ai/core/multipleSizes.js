// ai/core/multipleSizes.js
const { parseDimensions, getAvailableSizes, findClosestSizes, generateSizeResponse } = require("../../measureHandler");
const { getBusinessInfo } = require("../../businessInfoManager");
const { updateConversation } = require("../../conversationManager");

/**
 * Extracts all dimension patterns from a message
 * @param {string} message - User's message
 * @returns {Array} - Array of dimension objects {width, height, area, rawText}
 */
function extractAllDimensions(message) {
  const dimensions = [];
  const patterns = [
    /(\d+(?:\.\d+)?)\s*[xX×*]\s*(\d+(?:\.\d+)?)\s*m?(?:ts?)?(?:\.)?/g,  // "10x3", "10 x 3", "10*3", "10x3m"
    /(\d+(?:\.\d+)?)\s+por\s+(\d+(?:\.\d+)?)\s*m?(?:ts?)?(?:\.)?/gi,      // "10 por 3"
    /(?:de|medida)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/gi                // "de 10 3", "medida 10 3"
  ];

  // Try each pattern
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(message)) !== null) {
      const width = parseFloat(match[1]);
      const height = parseFloat(match[2]);

      // Avoid duplicates (same dimension already found)
      const isDuplicate = dimensions.some(d =>
        (Math.abs(d.width - width) < 0.01 && Math.abs(d.height - height) < 0.01) ||
        (Math.abs(d.width - height) < 0.01 && Math.abs(d.height - width) < 0.01)  // swapped
      );

      if (!isDuplicate) {
        dimensions.push({
          width,
          height,
          area: width * height,
          rawText: match[0]
        });
      }
    }
  }

  return dimensions;
}

/**
 * Handles requests for multiple sizes in a single message
 * @param {string} message - User's message
 * @param {string} psid - User's PSID
 * @param {object} convo - Conversation state
 * @param {string} campaignRef - Optional campaign reference
 * @returns {object|null} - Response object or null
 */
async function handleMultipleSizes(message, psid, convo, campaignRef = null) {
  console.log("📏 Handling multiple size request:", message);

  // Extract all dimensions from message
  const dimensions = extractAllDimensions(message);

  if (dimensions.length < 2) {
    console.log("⚠️ Less than 2 dimensions found, not a multi-size request");
    return null;
  }

  console.log(`📏 Found ${dimensions.length} dimensions:`, dimensions.map(d => `${d.width}x${d.height}`).join(", "));

  // Get available sizes
  const availableSizes = await getAvailableSizes(campaignRef);
  const businessInfo = await getBusinessInfo();

  // Build response parts for each dimension
  const responseParts = [];

  for (const dim of dimensions) {
    const { bigger, exact } = findClosestSizes(dim, availableSizes);

    if (exact) {
      // We have this size exactly!
      responseParts.push(`**${dim.width}x${dim.height}m**: Sí tenemos, $${exact.price}`);
    } else if (bigger) {
      // We have a size that can cover this dimension
      responseParts.push(`**${dim.width}x${dim.height}m**: No tenemos exacta, pero ${bigger.sizeStr} te cubre ($${bigger.price})`);
    } else {
      // Size too large - needs custom fabrication
      const largest = availableSizes[availableSizes.length - 1];
      responseParts.push(`**${dim.width}x${dim.height}m**: Medida especial (nuestra más grande estándar es ${largest?.sizeStr || "10x5m"}). Requiere cotización.`);
    }
  }

  // Check if any size needs custom fabrication
  const needsCustom = dimensions.some(dim => {
    const { exact } = findClosestSizes(dim, availableSizes);
    return !exact;
  });

  // Build final response
  let finalText = responseParts.join("\n\n");

  if (needsCustom && businessInfo) {
    finalText += `\n\n**Para medidas personalizadas**, contáctanos:\n📞 ${businessInfo.phones?.join(" / ")}\n🕓 ${businessInfo.hours}`;
  }

  finalText += `\n\n¿Te interesa alguna de estas opciones?`;

  await updateConversation(psid, {
    lastIntent: "multiple_sizes_request",
    state: "active",
    unknownCount: 0
  });

  return {
    type: "text",
    text: finalText
  };
}

module.exports = { handleMultipleSizes, extractAllDimensions };
