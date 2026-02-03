// ai/handlers/logistics.js
// Handlers for logistics intents: shipping, location, payment, delivery time

const { updateConversation } = require("../../conversationManager");
const { getBusinessInfo } = require("../../businessInfoManager");
const { detectMexicanLocation } = require("../../mexicanLocations");

/**
 * Handle shipping query - "Hacen envíos?", "Envían a mi ciudad?"
 */
async function handleShipping({ entities, psid, convo, userMessage }) {
  // Check if location was mentioned in the query
  const locationInfo = entities.location ? { normalized: entities.location } : await detectMexicanLocation(userMessage);

  if (locationInfo) {
    await updateConversation(psid, {
      lastIntent: "shipping_query",
      city: locationInfo.normalized,
      unknownCount: 0
    });

    return {
      type: "text",
      text: `¡Sí! Enviamos a ${locationInfo.normalized} y a todo el país a través de Mercado Libre.\n\n` +
            `El envío está incluido en la mayoría de los productos.\n\n` +
            `¿Qué medida te interesa?`
    };
  }

  // Check product context for specific response
  const isRollInterest = convo?.productInterest === 'rollo' || convo?.lastIntent?.includes('roll');

  if (isRollInterest) {
    await updateConversation(psid, {
      lastIntent: "awaiting_zipcode",
      unknownCount: 0
    });

    return {
      type: "text",
      text: "Enviamos a todo el país.\n\n" +
            "Para rollos de malla sombra y pedidos de mayoreo, necesitamos tu código postal para calcular el envío.\n\n" +
            "¿Me lo compartes?"
    };
  }

  await updateConversation(psid, {
    lastIntent: "shipping_query",
    unknownCount: 0
  });

  return {
    type: "text",
    text: "Enviamos a todo el país.\n\n" +
          "En rollos de malla sombra y pedidos de mayoreo, necesitamos tu código postal para calcular el envío.\n\n" +
          "En todos nuestros demás productos, enviamos a través de Mercado Libre con envío incluido.\n\n" +
          "¿Qué producto te interesa?"
  };
}

/**
 * Handle location query - "Dónde están?", "Tienen tienda física?"
 */
async function handleLocation({ psid, userMessage }) {
  const businessInfo = await getBusinessInfo();

  // Check if they want to visit physically
  const wantsPhysicalVisit = /f[ií]sicamente|en\s+persona|ir\s+a\s+ver|verlo|visitarlos/i.test(userMessage);

  await updateConversation(psid, {
    lastIntent: "location_query",
    unknownCount: 0
  });

  if (wantsPhysicalVisit) {
    return {
      type: "text",
      text: `Nos ubicamos en Querétaro. Somos principalmente tienda en línea, pero si gustas visitarnos puedes contactarnos para coordinar:\n\n` +
            `📍 ${businessInfo?.address || 'Calle Loma de San Gremal 108, bodega 73'}\n` +
            `📞 ${businessInfo?.phones?.[0] || '442 352 1646'}\n` +
            `💬 WhatsApp: https://wa.me/524425957432\n\n` +
            `También puedes ver todos nuestros productos en nuestra Tienda Oficial de Mercado Libre con envío a todo el país.`
    };
  }

  return {
    type: "text",
    text: `Estamos ubicados en Querétaro pero enviamos a todo el país.\n\n` +
          `📍 ${businessInfo?.address || 'Calle Loma de San Gremal 108, bodega 73'}\n` +
          `🕓 ${businessInfo?.hours || 'Lun-Vie 9am-6pm'}\n` +
          `📞 ${businessInfo?.phones?.[0] || '442 352 1646'}\n\n` +
          `¿Te gustaría ver nuestros productos?`
  };
}

/**
 * Handle location mention - user says where they're from
 * "Soy de Monterrey", "Vivo en Jalisco"
 */
async function handleLocationMention({ psid, userMessage }) {
  const locationInfo = await detectMexicanLocation(userMessage);

  if (locationInfo) {
    await updateConversation(psid, {
      lastIntent: "location_mentioned",
      city: locationInfo.normalized,
      unknownCount: 0
    });

    return {
      type: "text",
      text: `¡Sí! Enviamos a ${locationInfo.normalized} a través de Mercado Libre.\n\n` +
            `¿Qué medida de malla sombra necesitas?`
    };
  }

  // Could not detect location - ask for clarification
  await updateConversation(psid, {
    lastIntent: "location_mentioned",
    unknownCount: 0
  });

  return {
    type: "text",
    text: "Enviamos a todo el país por Mercado Libre.\n\n" +
          "¿Qué producto te interesa?"
  };
}

/**
 * Handle payment query - "Cómo pago?", "Aceptan tarjeta?"
 */
async function handlePayment({ psid }) {
  await updateConversation(psid, {
    lastIntent: "payment_query",
    unknownCount: 0
  });

  return {
    type: "text",
    text: "Puedes pagar de forma segura a través de Mercado Libre:\n\n" +
          "• Tarjeta de crédito/débito\n" +
          "• Transferencia bancaria\n" +
          "• Efectivo en OXXO/7-Eleven\n" +
          "• Hasta 12 meses sin intereses\n\n" +
          "¿Qué producto te interesa?"
  };
}

/**
 * Handle pay on delivery query - "Pago al entregar?", "Contra entrega?"
 */
async function handlePayOnDelivery({ psid }) {
  await updateConversation(psid, {
    lastIntent: "pay_on_delivery_query",
    unknownCount: 0
  });

  return {
    type: "text",
    text: "El pago es 100% POR ADELANTADO en Mercado Libre al momento de hacer tu pedido.\n\n" +
          "No manejamos pago contra entrega.\n\n" +
          "Aceptan tarjeta, efectivo en OXXO, o meses sin intereses. ¿Te paso el link para que puedas hacer tu pedido?"
  };
}

/**
 * Handle delivery time query - "Cuándo llega?", "Tiempo de entrega?"
 */
async function handleDeliveryTime({ psid }) {
  await updateConversation(psid, {
    lastIntent: "delivery_time_query",
    unknownCount: 0
  });

  return {
    type: "text",
    text: "Tiempos de entrega:\n\n" +
          "• CDMX y zona metropolitana: 1-2 días hábiles\n" +
          "• Interior de la República: 3-5 días hábiles\n\n" +
          "El pago se realiza en Mercado Libre al momento de hacer el pedido. ¿Qué medida te interesa?"
  };
}

/**
 * Handle shipping included query - "Ya incluye envío?", "El precio es con entrega?"
 */
async function handleShippingIncluded({ psid }) {
  await updateConversation(psid, {
    lastIntent: "shipping_included_query",
    unknownCount: 0
  });

  return {
    type: "text",
    text: "¡Sí! El envío está incluido en el precio o se calcula automáticamente en Mercado Libre dependiendo de tu ubicación.\n\n" +
          "En la mayoría de los casos el envío es gratis."
  };
}

module.exports = {
  handleShipping,
  handleLocation,
  handleLocationMention,
  handlePayment,
  handlePayOnDelivery,
  handleDeliveryTime,
  handleShippingIncluded
};
