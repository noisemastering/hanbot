// ai/core/humanSalesHandler.js
// Handles multi-step flow for human-sellable products (requires zip, size/color selection, quantity)

const { updateConversation } = require("../../conversationManager");
const ProductFamily = require("../../models/ProductFamily");
const ZipCode = require("../../models/ZipCode");
const { parseDimensions } = require("../../measureHandler");

/**
 * Detects if user mentioned a human-sellable product
 * If message contains dimensions, validates that the product size matches
 */
async function detectHumanSellableProduct(userMessage) {
  const msg = userMessage.toLowerCase().trim();

  // Extract dimensions from message (e.g., "4 x 100" → {width: 4, height: 100})
  const requestedDimensions = parseDimensions(msg);

  // Search for product mentions in the message
  const products = await ProductFamily.find({
    requiresHumanAdvisor: true,
    sellable: true,
    available: true
  }).populate('parentId');

  for (const product of products) {
    const productName = product.name.toLowerCase();
    const parentName = product.parentId?.name?.toLowerCase() || '';

    // Check if message contains product or parent name
    if (msg.includes(productName) || (parentName && msg.includes(parentName))) {
      // If message contains dimensions, validate product size matches
      if (requestedDimensions && product.size) {
        const sizeMatch = product.size.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i);
        if (sizeMatch) {
          const productWidth = parseFloat(sizeMatch[1]);
          const productHeight = parseFloat(sizeMatch[2]);

          // Check if dimensions match (within 0.2m tolerance for rounding)
          // This prevents 3.7x100 from matching a 4x100 request
          const dimensionTolerance = 0.2;
          const matchesDirect =
            Math.abs(productWidth - requestedDimensions.width) <= dimensionTolerance &&
            Math.abs(productHeight - requestedDimensions.height) <= dimensionTolerance;
          const matchesSwapped =
            Math.abs(productWidth - requestedDimensions.height) <= dimensionTolerance &&
            Math.abs(productHeight - requestedDimensions.width) <= dimensionTolerance;

          if (!matchesDirect && !matchesSwapped) {
            console.log(`⚠️ Product "${product.name}" (${product.size}) doesn't match requested dimensions ${requestedDimensions.width}x${requestedDimensions.height}`);
            continue; // Skip this product, dimensions don't match
          }
        }
      }

      return product;
    }
  }

  return null;
}

/**
 * Main handler for human sales flow
 */
async function handleHumanSalesFlow(userMessage, psid, convo) {
  try {
    const msg = userMessage.toLowerCase().trim();

    // If we're in a sales flow state, handle the current step
    if (convo.humanSalesState) {
      return await handleCurrentStep(msg, psid, convo);
    }

    // Otherwise, check if user mentioned a human-sellable product
    const product = await detectHumanSellableProduct(userMessage);
    if (product) {
      return await startHumanSalesFlow(product, psid, convo);
    }

    return null; // Not a human sales interaction
  } catch (error) {
    console.error("❌ Error in handleHumanSalesFlow:", error);
    return null;
  }
}

/**
 * Start the human sales flow by asking for zipcode
 */
async function startHumanSalesFlow(product, psid, convo) {
  await updateConversation(psid, {
    humanSalesState: 'asking_zipcode',
    humanSalesCurrentProduct: product._id,
    state: 'active'
  });

  return {
    type: "text",
    text: `¡Perfecto! Para cotizar el envío de ${product.parentId?.name || product.name}, necesito tu código postal 📍\n\n¿Cuál es tu código postal?`
  };
}

/**
 * Handle the current step based on conversation state
 */
async function handleCurrentStep(msg, psid, convo) {
  switch (convo.humanSalesState) {
    case 'asking_zipcode':
      return await handleZipcodeResponse(msg, psid, convo);

    case 'asking_product_selection':
      return await handleProductSelectionResponse(msg, psid, convo);

    case 'asking_quantity':
      return await handleQuantityResponse(msg, psid, convo);

    case 'asking_more_items':
      return await handleMoreItemsResponse(msg, psid, convo);

    default:
      return null;
  }
}

/**
 * Handle zipcode response
 */
async function handleZipcodeResponse(msg, psid, convo) {
  // Extract zipcode (5 digits)
  const zipcodeMatch = msg.match(/\b(\d{5})\b/);

  if (!zipcodeMatch) {
    return {
      type: "text",
      text: "Por favor ingresa un código postal válido de 5 dígitos. Por ejemplo: 64000"
    };
  }

  const zipcode = zipcodeMatch[1];

  // Lookup zipcode in database
  const zipInfo = await ZipCode.lookup(zipcode);

  if (!zipInfo) {
    return {
      type: "text",
      text: `No encontré el código postal ${zipcode}. ¿Podrías verificarlo? Debe ser un CP de 5 dígitos de México.`
    };
  }

  // Get available product options (sizes/colors) for the current product
  const currentProduct = await ProductFamily.findById(convo.humanSalesCurrentProduct)
    .populate('parentId');

  if (!currentProduct) {
    return {
      type: "text",
      text: "Lo siento, hubo un error. ¿Podrías decirme nuevamente qué producto te interesa?"
    };
  }

  // Find all sellable children of the parent product (different sizes/colors)
  const options = await ProductFamily.find({
    parentId: currentProduct.parentId?._id || currentProduct._id,
    sellable: true,
    available: true,
    requiresHumanAdvisor: true
  }).sort({ priority: -1, name: 1 });

  if (options.length === 0) {
    return {
      type: "text",
      text: "Lo siento, no encontré opciones disponibles para este producto. Un asesor te contactará pronto."
    };
  }

  // Build location confirmation
  const locationText = `📍 ${zipInfo.city}, ${zipInfo.state}`;

  // If only 1 option, auto-select it
  if (options.length === 1) {
    const selectedProduct = options[0];
    const price = selectedProduct.price ? `$${selectedProduct.price}` : 'Consultar precio';

    await updateConversation(psid, {
      humanSalesState: 'asking_quantity',
      humanSalesZipcode: zipcode,
      humanSalesLocation: zipInfo,
      humanSalesCurrentProduct: selectedProduct._id
    });

    return {
      type: "text",
      text: `✅ ¡Perfecto! Veo que estás en:\n${locationText}\n\n` +
            `El producto disponible es: ${selectedProduct.name} - ${price}\n\n` +
            `¿Cuántos rollos necesitas?`
    };
  }

  // Build numbered list with prices (2+ options)
  let responseText = `✅ ¡Perfecto! Veo que estás en:\n${locationText}\n\n`;
  responseText += `Tenemos las siguientes opciones de ${currentProduct.parentId?.name || currentProduct.name}:\n\n`;

  options.forEach((option, index) => {
    const price = option.price ? `$${option.price}` : 'Consultar precio';
    responseText += `${index + 1}. ${option.name} - ${price}\n`;
  });

  responseText += `\n¿Cuál opción te interesa? Responde con el número.`;

  await updateConversation(psid, {
    humanSalesState: 'asking_product_selection',
    humanSalesZipcode: zipcode,
    humanSalesLocation: zipInfo
  });

  return {
    type: "text",
    text: responseText,
    metadata: { availableOptions: options.map(o => o._id.toString()) }
  };
}

/**
 * Handle product selection response
 */
async function handleProductSelectionResponse(msg, psid, convo) {
  // Extract number selection (1-based)
  const numberMatch = msg.match(/\b(\d+)\b/);

  if (!numberMatch) {
    return {
      type: "text",
      text: "Por favor responde con el número de la opción que te interesa (ejemplo: 1)"
    };
  }

  const selection = parseInt(numberMatch[1]);

  // Get current product to find available options
  const currentProduct = await ProductFamily.findById(convo.humanSalesCurrentProduct)
    .populate('parentId');

  if (!currentProduct) {
    return {
      type: "text",
      text: "Hubo un error. ¿Podrías decirme nuevamente qué opción te interesa?"
    };
  }

  // Get the same options list we showed before
  const options = await ProductFamily.find({
    parentId: currentProduct.parentId?._id || currentProduct._id,
    sellable: true,
    available: true,
    requiresHumanAdvisor: true
  }).sort({ priority: -1, name: 1 });

  if (selection < 1 || selection > options.length) {
    return {
      type: "text",
      text: options.length === 1
        ? "Solo hay una opción disponible. Responde con 1 para seleccionarla."
        : `Por favor selecciona un número entre 1 y ${options.length}`
    };
  }

  const selectedProduct = options[selection - 1];

  await updateConversation(psid, {
    humanSalesState: 'asking_quantity',
    humanSalesCurrentProduct: selectedProduct._id
  });

  return {
    type: "text",
    text: `Perfecto! Has seleccionado: ${selectedProduct.name} 📦\n\n¿Cuántos rollos necesitas?`
  };
}

/**
 * Handle quantity response
 */
async function handleQuantityResponse(msg, psid, convo) {
  // Extract quantity
  const quantityMatch = msg.match(/\b(\d+)\b/);

  if (!quantityMatch) {
    return {
      type: "text",
      text: "Por favor indica la cantidad de rollos que necesitas (ejemplo: 3)"
    };
  }

  const quantity = parseInt(quantityMatch[1]);

  if (quantity < 1 || quantity > 1000) {
    return {
      type: "text",
      text: "Por favor indica una cantidad válida entre 1 y 1000 rollos."
    };
  }

  // Get selected product
  const selectedProduct = await ProductFamily.findById(convo.humanSalesCurrentProduct);

  if (!selectedProduct) {
    return {
      type: "text",
      text: "Hubo un error. Empecemos de nuevo."
    };
  }

  // Add to cart
  const cartItem = {
    productId: selectedProduct._id,
    productName: selectedProduct.name,
    quantity: quantity
  };

  const updatedCart = [...(convo.humanSalesCart || []), cartItem];

  await updateConversation(psid, {
    humanSalesState: 'asking_more_items',
    humanSalesCart: updatedCart,
    humanSalesCurrentProduct: null
  });

  // Build cart summary
  let summaryText = `✅ Agregado al pedido:\n`;
  summaryText += `• ${quantity}x ${selectedProduct.name}\n\n`;
  summaryText += `📋 Resumen de tu pedido:\n`;

  updatedCart.forEach((item, index) => {
    summaryText += `${index + 1}. ${item.quantity}x ${item.productName}\n`;
  });

  summaryText += `\n📍 Código postal: ${convo.humanSalesZipcode}\n\n`;
  summaryText += `¿Deseas agregar otro producto? (Sí/No)`;

  return {
    type: "text",
    text: summaryText
  };
}

/**
 * Handle "want more items" response
 */
async function handleMoreItemsResponse(msg, psid, convo) {
  const wantsMore = /\b(s[ií]|ok|dale|claro|por\s*supuesto|quiero)\b/i.test(msg);
  const doesntWantMore = /\b(no|nop|neg|gracias|listo|ya|terminé|suficiente)\b/i.test(msg);

  if (wantsMore) {
    await updateConversation(psid, {
      humanSalesState: 'asking_zipcode', // Start over for new product (same zipcode will be reused if needed)
      humanSalesCurrentProduct: null
    });

    return {
      type: "text",
      text: "¡Perfecto! ¿Qué otro producto te interesa?"
    };
  }

  if (doesntWantMore) {
    // Finalize order and notify human advisor
    const cart = convo.humanSalesCart || [];
    const zipcode = convo.humanSalesZipcode;

    let orderSummary = `🛒 NUEVO PEDIDO - Requiere cotización de envío\n\n`;
    orderSummary += `📋 Productos:\n`;
    cart.forEach((item, index) => {
      orderSummary += `${index + 1}. ${item.quantity}x ${item.productName}\n`;
    });
    orderSummary += `\n📍 Código Postal: ${zipcode}\n`;
    orderSummary += `\n⏰ ${new Date().toLocaleString('es-MX')}\n`;

    // Clear sales state
    await updateConversation(psid, {
      humanSalesState: null,
      humanSalesCart: [],
      humanSalesZipcode: null,
      humanSalesCurrentProduct: null,
      handoffRequested: true,
      handoffReason: 'human_sellable_product_order',
      handoffTimestamp: new Date(),
      state: 'needs_human'
    });

    // TODO: Send notification to human advisor (Slack/Email/Dashboard)
    console.log("📧 ORDER SUMMARY:", orderSummary);

    return {
      type: "text",
      text: `¡Perfecto! He registrado tu pedido. Un asesor te contactará pronto para confirmar disponibilidad y calcular el costo de envío a tu código postal.\n\n${orderSummary}\n\n¿Hay algo más en lo que pueda ayudarte?`
    };
  }

  // Unclear response
  return {
    type: "text",
    text: "¿Deseas agregar otro producto a tu pedido? Por favor responde Sí o No."
  };
}

module.exports = {
  handleHumanSalesFlow,
  detectHumanSellableProduct
};
