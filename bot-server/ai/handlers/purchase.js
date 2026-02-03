// ai/handlers/purchase.js
// Handlers for purchase-related intents: store link, how to buy, bulk discount, phone

const { updateConversation } = require("../../conversationManager");
const { generateClickLink } = require("../../tracking");
const { getBusinessInfo } = require("../../businessInfoManager");

const STORE_URL = "https://www.mercadolibre.com.mx/tienda/distribuidora-hanlob";
const WHATSAPP_LINK = "https://wa.me/524425957432";

/**
 * Handle store link request - "Link de la tienda", "Mercado Libre?"
 */
async function handleStoreLinkRequest({ psid, convo }) {
  // Check if conversation is about rollos (need human contact, not directly on ML)
  const isRolloContext = convo?.productInterest === 'rollo' ||
                         convo?.lastIntent?.includes('roll') ||
                         convo?.productSpecs?.productType === 'rollo';

  if (isRolloContext) {
    await updateConversation(psid, {
      lastIntent: "rollo_ml_inquiry",
      handoffRequested: true,
      handoffReason: "Rollo inquiry asking about ML - needs quote",
      handoffTimestamp: new Date()
    });

    return {
      type: "text",
      text: "Los rollos de malla sombra se cotizan directamente con nuestro equipo de ventas.\n\n" +
            "Para darte precio y disponibilidad, necesito:\n" +
            "• Tu código postal (para calcular envío)\n" +
            "• Cantidad de rollos que necesitas\n\n" +
            "Un asesor te contactará en breve para ayudarte con tu cotización."
    };
  }

  const trackedLink = await generateClickLink(psid, STORE_URL, {
    productName: "Tienda Oficial",
    campaignId: convo?.campaignId,
    adSetId: convo?.adSetId,
    adId: convo?.adId,
    userName: convo?.userName,
    city: convo?.city,
    stateMx: convo?.stateMx
  });

  await updateConversation(psid, {
    lastIntent: "store_link_requested",
    unknownCount: 0
  });

  // If no product context yet, confirm ML and ask what they need
  if (!convo?.productInterest) {
    return {
      type: "text",
      text: "¡Sí! Vendemos por Mercado Libre.\n\n" +
            "¿Qué producto te interesa?\n\n" +
            "• Malla Sombra (confeccionada o en rollo)\n" +
            "• Borde Separador para jardín\n" +
            "• Groundcover (malla antimaleza)"
    };
  }

  // Has product context - give store link
  return {
    type: "text",
    text: `¡Sí! Puedes comprar en nuestra Tienda Oficial de Mercado Libre:\n\n` +
          `${trackedLink}\n\n` +
          `¿Te ayudo a encontrar la medida que necesitas?`
  };
}

/**
 * Handle how to buy - "Cómo compro?", "Proceso de compra?"
 */
async function handleHowToBuy({ psid, convo }) {
  const trackedLink = await generateClickLink(psid, STORE_URL, {
    productName: "Tienda Oficial",
    campaignId: convo?.campaignId,
    city: convo?.city,
    stateMx: convo?.stateMx
  });

  await updateConversation(psid, {
    lastIntent: "how_to_buy",
    unknownCount: 0
  });

  return {
    type: "text",
    text: `Para realizar tu compra, visita nuestra Tienda Oficial en Mercado Libre:\n\n` +
          `${trackedLink}\n\n` +
          `Ahí puedes:\n` +
          `1. Seleccionar la medida que necesitas\n` +
          `2. Agregar al carrito\n` +
          `3. Pagar con tarjeta, efectivo o meses sin intereses\n` +
          `4. Proporcionar tu dirección de envío\n` +
          `5. Esperar la entrega en tu domicilio\n\n` +
          `El envío está incluido en la mayoría de los casos. ¿Te puedo ayudar con algo más?`
  };
}

/**
 * Handle bulk discount - "Precio por mayoreo", "Descuento por volumen"
 */
async function handleBulkDiscount({ psid, convo }) {
  const info = await getBusinessInfo();

  // Check if we already gave the bulk discount response recently
  if (convo?.lastIntent === "bulk_discount") {
    return {
      type: "text",
      text: `Como te comenté, para cotizaciones de volumen necesitas comunicarte con nuestros especialistas:\n\n` +
            `💬 WhatsApp: ${WHATSAPP_LINK}\n` +
            `📞 ${info?.phones?.join(" / ") || "442 352 1646"}\n\n` +
            `Ellos podrán darte el precio exacto para la cantidad que necesitas.`
    };
  }

  await updateConversation(psid, {
    lastIntent: "bulk_discount",
    state: "needs_human",
    unknownCount: 0
  });

  return {
    type: "text",
    text: `Los descuentos por volumen aplican para pedidos desde $20,000 MXN en adelante.\n\n` +
          `Para cotizar tu pedido y conocer los descuentos disponibles, te comunico con uno de nuestros especialistas:\n\n` +
          `💬 WhatsApp: ${WHATSAPP_LINK}\n` +
          `📞 ${info?.phones?.join(" / ") || "442 352 1646"}\n` +
          `🕓 ${info?.hours || "Lun-Vie 9am-6pm"}`
  };
}

/**
 * Handle phone request - "Teléfono?", "Número para llamar?"
 */
async function handlePhoneRequest({ psid }) {
  const info = await getBusinessInfo();

  await updateConversation(psid, {
    lastIntent: "phone_request",
    unknownCount: 0
  });

  return {
    type: "text",
    text: `¡Claro! Nuestro teléfono es:\n\n` +
          `📞 ${info?.phones?.[0] || "442 352 1646"}\n` +
          `💬 WhatsApp: ${WHATSAPP_LINK}\n\n` +
          `🕓 Horario: ${info?.hours || "Lun-Vie 9am-6pm"}\n\n` +
          `También puedes comprar directamente en nuestra tienda de Mercado Libre si prefieres.`
  };
}

/**
 * Handle price per square meter - "Precio por metro cuadrado", "Cuánto el m2"
 */
async function handlePricePerSqm({ psid }) {
  await updateConversation(psid, {
    lastIntent: "price_per_sqm",
    unknownCount: 0
  });

  return {
    type: "text",
    text: "Nuestros precios dependen de las dimensiones de la malla, no manejamos un precio fijo por metro cuadrado.\n\n" +
          "¿Qué medida te interesa?"
  };
}

module.exports = {
  handleStoreLinkRequest,
  handleHowToBuy,
  handleBulkDiscount,
  handlePhoneRequest,
  handlePricePerSqm
};
