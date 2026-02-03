// ai/handlers/products.js
// Handlers for product-related intents: catalog, comparison, largest/smallest

const { updateConversation } = require("../../conversationManager");
const { getAvailableSizes } = require("../../measureHandler");
const { generateClickLink } = require("../../tracking");
const ProductFamily = require("../../models/ProductFamily");

/**
 * Handle catalog request - "Muéstrame las opciones", "Qué medidas tienen"
 */
async function handleCatalogRequest({ psid, convo }) {
  await updateConversation(psid, {
    lastIntent: "catalog_request",
    unknownCount: 0
  });

  // Don't dump entire product list - ask for dimensions instead
  // This follows the CLAUDE.md rule: "NEVER dump long product lists"
  return {
    type: "text",
    text: "Tenemos mallas sombra beige en varias medidas, desde 2x2m hasta 6x10m, y también rollos de 100m.\n\n" +
          "Para darte el precio exacto, ¿qué medida necesitas para tu proyecto?"
  };
}

/**
 * Handle product comparison - "Diferencia entre raschel y monofilamento"
 */
async function handleProductComparison({ entities, psid, userMessage }) {
  await updateConversation(psid, {
    lastIntent: "product_comparison",
    unknownCount: 0
  });

  // Check what products are being compared
  const isRaschelMono = /raschel.*monofilamento|monofilamento.*raschel/i.test(userMessage);
  const isConfeccionadaRollo = /confeccionada.*rollo|rollo.*confeccionada/i.test(userMessage);

  if (isRaschelMono) {
    return {
      type: "text",
      text: "**Malla Raschel** (tejido raschel):\n" +
            "• Material económico y ligero\n" +
            "• Ideal para uso temporal o agricultura\n" +
            "• Porcentajes: 35%, 50%, 70%, 80%, 90%\n\n" +
            "**Malla Monofilamento** (hilo continuo):\n" +
            "• Mayor durabilidad y resistencia\n" +
            "• Para uso permanente o industrial\n" +
            "• Mejor resistencia al viento\n\n" +
            "¿Qué tipo te interesa?"
    };
  }

  if (isConfeccionadaRollo) {
    return {
      type: "text",
      text: "**Malla Confeccionada**:\n" +
            "• Lista para instalar\n" +
            "• Con argollas en todo el perímetro\n" +
            "• Medidas de 2x2m hasta 6x10m\n" +
            "• Ideal para patios, cocheras, terrazas\n\n" +
            "**Rollo de Malla**:\n" +
            "• 100 metros de largo\n" +
            "• Para proyectos grandes o profesionales\n" +
            "• Tú defines la medida que necesitas\n\n" +
            "¿Qué tipo te interesa?"
    };
  }

  // General comparison question
  return {
    type: "text",
    text: "Tenemos diferentes tipos de malla según tu necesidad:\n\n" +
          "• **Confeccionada**: lista para instalar con argollas\n" +
          "• **Rollos**: 100m para proyectos grandes\n" +
          "• **Raschel**: económica y ligera\n" +
          "• **Monofilamento**: máxima durabilidad\n\n" +
          "¿Para qué la necesitas? Así te recomiendo la mejor opción."
  };
}

/**
 * Handle largest product query - "La más grande", "Medida máxima"
 */
async function handleLargestProduct({ psid, convo }) {
  const availableSizes = await getAvailableSizes(convo);

  if (availableSizes.length > 0) {
    // Sort by area (largest first)
    const sorted = [...availableSizes].sort((a, b) => {
      const areaA = (a.width || 0) * (a.height || 0);
      const areaB = (b.width || 0) * (b.height || 0);
      return areaB - areaA;
    });

    const largest = sorted[0];

    // Try to find the product for ML link
    try {
      const sizeVariants = [largest.sizeStr, largest.sizeStr.replace('m', ''), largest.sizeStr + 'm'];
      const product = await ProductFamily.findOne({
        size: { $in: sizeVariants },
        sellable: true,
        active: { $ne: false }
      }).lean();

      if (product) {
        const preferredLink = product.onlineStoreLinks?.find(l => l.isPreferred)?.url ||
                             product.onlineStoreLinks?.[0]?.url;

        if (preferredLink) {
          const trackedLink = await generateClickLink(psid, preferredLink, {
            productName: product.name,
            productId: product._id,
            city: convo?.city,
            stateMx: convo?.stateMx
          });

          await updateConversation(psid, {
            lastIntent: "largest_product_shown",
            unknownCount: 0
          });

          return {
            type: "text",
            text: `Nuestra malla sombra confeccionada más grande es de **${largest.sizeStr}** a **$${largest.price}** con envío incluido.\n\n` +
                  `Viene reforzada con argollas en todo el perímetro, lista para instalar.\n\n` +
                  `Cómprala aquí:\n${trackedLink}`
          };
        }
      }
    } catch (err) {
      console.error("Error fetching largest product:", err);
    }

    // Fallback without link
    await updateConversation(psid, {
      lastIntent: "largest_product_shown",
      unknownCount: 0
    });

    return {
      type: "text",
      text: `Nuestra malla sombra confeccionada más grande es de **${largest.sizeStr}** a **$${largest.price}**.\n\n` +
            `Viene reforzada con argollas en todo el perímetro, lista para instalar. ¿Te interesa?`
    };
  }

  // Fallback
  return {
    type: "text",
    text: "Nuestra malla sombra confeccionada más grande es de 6x10m. ¿Te paso el precio y link?"
  };
}

/**
 * Handle smallest product query - "La más chica", "Medida mínima"
 */
async function handleSmallestProduct({ psid, convo }) {
  const availableSizes = await getAvailableSizes(convo);

  if (availableSizes.length > 0) {
    // Sort by area (smallest first)
    const sorted = [...availableSizes].sort((a, b) => {
      const areaA = (a.width || 0) * (a.height || 0);
      const areaB = (b.width || 0) * (b.height || 0);
      return areaA - areaB;
    });

    const smallest = sorted[0];

    await updateConversation(psid, {
      lastIntent: "smallest_product_shown",
      unknownCount: 0
    });

    return {
      type: "text",
      text: `Nuestra malla sombra confeccionada más pequeña es de **${smallest.sizeStr}** a **$${smallest.price}**.\n\n` +
            `¿Te interesa o necesitas una medida diferente?`
    };
  }

  return {
    type: "text",
    text: "Nuestra malla sombra confeccionada más pequeña es de 2x2m. ¿Te paso el precio?"
  };
}

/**
 * Handle durability query - "Cuánto tiempo dura?", "Vida útil?"
 */
async function handleDurabilityQuery({ psid }) {
  await updateConversation(psid, {
    lastIntent: "durability_query",
    unknownCount: 0
  });

  return {
    type: "text",
    text: "La malla sombra reforzada tiene una vida útil de 8 a 10 años aproximadamente, dependiendo de:\n\n" +
          "• Exposición al sol y clima\n" +
          "• Tensión de la instalación\n" +
          "• Mantenimiento (limpieza ocasional)\n\n" +
          "Nuestras mallas son de alta calidad con protección UV, por lo que son muy resistentes a la intemperie.\n\n" +
          "¿Qué medida te interesa?"
  };
}

module.exports = {
  handleCatalogRequest,
  handleProductComparison,
  handleLargestProduct,
  handleSmallestProduct,
  handleDurabilityQuery
};
