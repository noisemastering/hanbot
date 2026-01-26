// ai/flows/leadCaptureFlow.js
// Lead capture flow for distributor/wholesale campaigns
// Offers PDF catalog OR collects: name, zip, POI(s) + dimensions, quantity, WhatsApp/email

const { updateConversation, getConversation } = require("../../conversationManager");
const { INTENTS } = require("../classifier");
const Campaign = require("../../models/Campaign");

/**
 * Lead capture stages
 */
const STAGES = {
  INITIAL: "initial",              // Offer catalog or quote
  AWAITING_CATALOG_CHOICE: "awaiting_catalog_choice",
  AWAITING_NAME: "awaiting_name",
  AWAITING_ZIPCODE: "awaiting_zipcode",
  AWAITING_PRODUCTS: "awaiting_products",    // POI(s) with dimensions
  AWAITING_QUANTITY: "awaiting_quantity",
  AWAITING_CONTACT: "awaiting_contact",      // WhatsApp or email
  COMPLETE: "complete"
};

/**
 * Check if this flow should handle the message
 */
function shouldHandle(classification, sourceContext, convo, userMessage, campaign) {
  // Only handle if campaign goal is lead_capture or cotizacion with catalog
  if (!campaign) return false;

  const goal = campaign.conversationGoal;
  if (goal !== "lead_capture" && goal !== "cotizacion") return false;

  // Check if we're already in lead capture flow
  if (convo?.lastIntent?.startsWith("lead_")) return true;

  // Check if campaign has catalog (PDF)
  if (campaign.catalog?.url) return true;

  // Check if audience is reseller/distributor
  if (campaign.audience?.type === "reseller") return true;

  return false;
}

/**
 * Handle lead capture flow
 */
async function handle(classification, sourceContext, convo, psid, campaign, userMessage = '') {
  const msg = (userMessage || '').toLowerCase().trim();
  const lastIntent = convo?.lastIntent || '';

  console.log(`📋 Lead capture flow - lastIntent: ${lastIntent}, msg: "${msg.substring(0, 50)}"`);

  // Get current lead data from conversation
  const leadData = convo?.leadData || {};

  // Determine current stage from lastIntent
  let stage = STAGES.INITIAL;
  if (lastIntent.startsWith("lead_")) {
    stage = lastIntent.replace("lead_", "");
  }

  // STAGE: Initial - offer catalog or start collecting info
  if (stage === STAGES.INITIAL || !lastIntent.startsWith("lead_")) {
    return await handleInitial(psid, campaign, msg, convo);
  }

  // STAGE: Awaiting catalog choice (sí/no to catalog)
  if (stage === STAGES.AWAITING_CATALOG_CHOICE) {
    return await handleCatalogChoice(psid, campaign, msg, classification);
  }

  // STAGE: Awaiting name
  if (stage === STAGES.AWAITING_NAME) {
    return await handleName(psid, msg, leadData);
  }

  // STAGE: Awaiting zip code
  if (stage === STAGES.AWAITING_ZIPCODE) {
    return await handleZipcode(psid, msg, leadData);
  }

  // STAGE: Awaiting products (POIs with dimensions)
  if (stage === STAGES.AWAITING_PRODUCTS) {
    return await handleProducts(psid, msg, leadData);
  }

  // STAGE: Awaiting quantity
  if (stage === STAGES.AWAITING_QUANTITY) {
    return await handleQuantity(psid, msg, leadData);
  }

  // STAGE: Awaiting contact (WhatsApp or email)
  if (stage === STAGES.AWAITING_CONTACT) {
    return await handleContact(psid, msg, leadData, campaign);
  }

  return null;
}

/**
 * Initial stage - offer catalog or quote
 */
async function handleInitial(psid, campaign, msg, convo) {
  const hasCatalog = campaign?.catalog?.url;

  // Check if user is asking for catalog
  const wantsCatalog = /cat[aá]logo|lista.*precios?|precios?.*lista|pdf|ver.*precios/i.test(msg);

  // Check if user wants a quote directly
  const wantsQuote = /cotiza|presupuesto|precio.*especial|mayoreo|cantidad|cuant[oa]s?.*piezas/i.test(msg);

  if (wantsCatalog && hasCatalog) {
    // Send catalog directly
    await updateConversation(psid, { lastIntent: "lead_awaiting_catalog_choice" });
    return {
      type: "text",
      text: `¡Claro! Aquí está nuestro catálogo con lista de precios:\n\n📄 ${campaign.catalog.url}\n\n¿Te gustaría una cotización personalizada para tu pedido?`
    };
  }

  if (wantsQuote || !wantsCatalog) {
    // Start collecting lead info
    await updateConversation(psid, { lastIntent: "lead_awaiting_name" });
    return {
      type: "text",
      text: "¡Con gusto te preparo una cotización!\n\n¿Me puedes dar tu nombre para el presupuesto?"
    };
  }

  // Default: offer both options
  if (hasCatalog) {
    await updateConversation(psid, { lastIntent: "lead_awaiting_catalog_choice" });
    return {
      type: "text",
      text: "¡Hola! Tenemos precios especiales para distribuidores.\n\n¿Te gustaría:\n• Ver el catálogo con lista de precios\n• Una cotización personalizada para tu pedido"
    };
  } else {
    await updateConversation(psid, { lastIntent: "lead_awaiting_name" });
    return {
      type: "text",
      text: "¡Hola! Tenemos precios especiales para distribuidores.\n\nPara prepararte una cotización, ¿me puedes dar tu nombre?"
    };
  }
}

/**
 * Handle catalog choice response
 */
async function handleCatalogChoice(psid, campaign, msg, classification) {
  const wantsCatalog = /cat[aá]logo|lista|ver|s[ií]|pdf/i.test(msg);
  const wantsQuote = /cotiza|presupuesto|personal|no|pedido/i.test(msg);

  if (wantsCatalog && campaign?.catalog?.url) {
    await updateConversation(psid, { lastIntent: "lead_catalog_sent" });
    return {
      type: "text",
      text: `📄 Aquí está el catálogo:\n${campaign.catalog.url}\n\n¿Te gustaría también una cotización personalizada?`
    };
  }

  // Start quote flow
  await updateConversation(psid, { lastIntent: "lead_awaiting_name" });
  return {
    type: "text",
    text: "¡Perfecto! Para prepararte la cotización, ¿me puedes dar tu nombre?"
  };
}

/**
 * Handle name input
 */
async function handleName(psid, msg, leadData) {
  // Extract name (first meaningful text)
  const name = msg.replace(/^(me llamo|soy|mi nombre es)\s*/i, '').trim();

  if (name.length < 2) {
    return {
      type: "text",
      text: "¿Me puedes dar tu nombre completo?"
    };
  }

  // Save name and ask for zip code
  await updateConversation(psid, {
    lastIntent: "lead_awaiting_zipcode",
    leadData: { ...leadData, name }
  });

  return {
    type: "text",
    text: `Gracias ${name}. ¿De qué código postal nos escribes?`
  };
}

/**
 * Handle zip code input
 */
async function handleZipcode(psid, msg, leadData) {
  // Extract zip code (5 digits in Mexico)
  const zipMatch = msg.match(/\b(\d{5})\b/);

  if (!zipMatch) {
    // Maybe they gave city/state instead
    const location = msg.trim();
    if (location.length >= 3) {
      await updateConversation(psid, {
        lastIntent: "lead_awaiting_products",
        leadData: { ...leadData, location }
      });
      return {
        type: "text",
        text: `Perfecto, ${location}.\n\n¿Qué productos y medidas te interesan?\n(Ej: "5 mallas de 4x5m y 3 de 3x4m")`
      };
    }

    return {
      type: "text",
      text: "¿Me puedes dar tu código postal o ciudad?"
    };
  }

  const zipcode = zipMatch[1];

  await updateConversation(psid, {
    lastIntent: "lead_awaiting_products",
    leadData: { ...leadData, zipcode }
  });

  return {
    type: "text",
    text: `Perfecto, CP ${zipcode}.\n\n¿Qué productos y medidas te interesan?\n(Ej: "5 mallas de 4x5m y 3 de 3x4m")`
  };
}

/**
 * Handle products/dimensions input
 */
async function handleProducts(psid, msg, leadData) {
  // Just capture the raw text - human will interpret
  const products = msg.trim();

  if (products.length < 3) {
    return {
      type: "text",
      text: "¿Qué productos y medidas necesitas? Por ejemplo: \"10 mallas de 4x5m\""
    };
  }

  await updateConversation(psid, {
    lastIntent: "lead_awaiting_quantity",
    leadData: { ...leadData, products }
  });

  return {
    type: "text",
    text: "¿Cuántas piezas en total necesitas?"
  };
}

/**
 * Handle quantity input
 */
async function handleQuantity(psid, msg, leadData) {
  // Extract number
  const qtyMatch = msg.match(/(\d+)/);
  const quantity = qtyMatch ? parseInt(qtyMatch[1]) : null;

  // If they already included quantity in products, skip
  if (!quantity && leadData.products?.match(/\d+\s*(piezas?|mallas?|unidades?)/i)) {
    await updateConversation(psid, {
      lastIntent: "lead_awaiting_contact",
      leadData: { ...leadData, quantity: "included in products" }
    });
    return {
      type: "text",
      text: "Por último, ¿cuál es tu número de WhatsApp o correo para enviarte la cotización?"
    };
  }

  if (!quantity) {
    return {
      type: "text",
      text: "¿Cuántas piezas necesitas aproximadamente?"
    };
  }

  await updateConversation(psid, {
    lastIntent: "lead_awaiting_contact",
    leadData: { ...leadData, quantity }
  });

  return {
    type: "text",
    text: `${quantity} piezas, anotado.\n\nPor último, ¿cuál es tu número de WhatsApp o correo para enviarte la cotización?`
  };
}

/**
 * Handle contact input (WhatsApp or email)
 */
async function handleContact(psid, msg, leadData, campaign) {
  // Try to extract phone or email
  const phoneMatch = msg.match(/(\+?\d[\d\s\-]{8,})/);
  const emailMatch = msg.match(/[\w.-]+@[\w.-]+\.\w+/);

  let contact = null;
  let contactType = null;

  if (phoneMatch) {
    contact = phoneMatch[1].replace(/[\s\-]/g, '');
    contactType = "whatsapp";
  } else if (emailMatch) {
    contact = emailMatch[0];
    contactType = "email";
  }

  if (!contact) {
    return {
      type: "text",
      text: "¿Me puedes dar tu número de WhatsApp (con lada) o correo electrónico?"
    };
  }

  // Complete! Save all lead data
  const completeLead = {
    ...leadData,
    contact,
    contactType,
    capturedAt: new Date()
  };

  await updateConversation(psid, {
    lastIntent: "lead_complete",
    leadData: completeLead,
    handoffRequested: true,
    handoffReason: `Lead capture complete: ${leadData.name} - ${leadData.products}`,
    handoffTimestamp: new Date()
  });

  // Build summary for user
  const summary = [
    `Nombre: ${leadData.name}`,
    leadData.zipcode ? `CP: ${leadData.zipcode}` : `Ubicación: ${leadData.location}`,
    `Productos: ${leadData.products}`,
    leadData.quantity !== "included in products" ? `Cantidad: ${leadData.quantity} piezas` : null,
    `Contacto: ${contact}`
  ].filter(Boolean).join('\n');

  return {
    type: "text",
    text: `¡Perfecto! Ya tengo todos los datos:\n\n${summary}\n\nUn especialista te contactará pronto con la cotización. ¡Gracias!`
  };
}

module.exports = {
  handle,
  shouldHandle,
  STAGES
};
