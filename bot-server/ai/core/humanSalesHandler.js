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

    case 'asking_neighborhood':
      return await handleNeighborhoodResponse(msg, psid, convo);

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

  // Check if there are multiple neighborhoods for this zip code
  if (zipInfo.hasMultipleNeighborhoods && zipInfo.neighborhoods.length > 1) {
    console.log(`🏘️ Zip code ${zipcode} has ${zipInfo.neighborhoods.length} neighborhoods, asking user to pick`);

    await updateConversation(psid, {
      humanSalesState: 'asking_neighborhood',
      humanSalesZipcode: zipcode,
      humanSalesPendingNeighborhoods: zipInfo.neighborhoods
    });

    // Build neighborhood list
    let responseText = `📍 El código postal ${zipcode} tiene varias colonias:\n\n`;

    // If more than 5 neighborhoods, show first 5 with message about more
    const maxToShow = 5;
    const toShow = zipInfo.neighborhoods.slice(0, maxToShow);

    toShow.forEach((n, i) => {
      responseText += `${i + 1}. ${n.name}\n`;
    });

    if (zipInfo.neighborhoods.length > maxToShow) {
      responseText += `... y ${zipInfo.neighborhoods.length - maxToShow} más\n`;
    }

    responseText += `\n¿En cuál colonia estás? (puedes escribir el nombre o el número)`;

    return {
      type: "text",
      text: responseText
    };
  }

  // Single neighborhood or none - proceed with normal flow
  return await proceedAfterLocation(zipcode, zipInfo, psid, convo);
}

/**
 * Handle neighborhood selection response
 */
async function handleNeighborhoodResponse(msg, psid, convo) {
  const neighborhoods = convo.humanSalesPendingNeighborhoods || [];
  const msgLower = msg.toLowerCase().trim();

  // Try to match by number
  const numMatch = msg.match(/^(\d+)$/);
  if (numMatch) {
    const idx = parseInt(numMatch[1]) - 1;
    if (idx >= 0 && idx < neighborhoods.length) {
      const selected = neighborhoods[idx];
      return await selectNeighborhoodAndProceed(selected.name, psid, convo);
    }
  }

  // Try to match by name (partial match)
  const normalizedMsg = msgLower.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  for (const n of neighborhoods) {
    const normalizedName = n.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (normalizedName.includes(normalizedMsg) || normalizedMsg.includes(normalizedName)) {
      return await selectNeighborhoodAndProceed(n.name, psid, convo);
    }
  }

  // Check if there are similar matches
  const closeMatches = neighborhoods.filter(n => {
    const normalizedName = n.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    // Check if any word matches
    const msgWords = normalizedMsg.split(/\s+/);
    const nameWords = normalizedName.split(/\s+/);
    return msgWords.some(w => nameWords.some(nw => nw.includes(w) || w.includes(nw)));
  });

  if (closeMatches.length === 1) {
    return await selectNeighborhoodAndProceed(closeMatches[0].name, psid, convo);
  } else if (closeMatches.length > 1 && closeMatches.length <= 3) {
    let responseText = "Encontré varias colonias similares:\n\n";
    closeMatches.forEach((n, i) => {
      responseText += `${i + 1}. ${n.name}\n`;
    });
    responseText += "\n¿Cuál es la tuya?";
    return { type: "text", text: responseText };
  }

  // No match found
  return {
    type: "text",
    text: "No encontré esa colonia. Por favor escribe el nombre o número de la lista, o si prefieres dame otro código postal."
  };
}

/**
 * Select neighborhood and proceed to product options
 */
async function selectNeighborhoodAndProceed(neighborhoodName, psid, convo) {
  const zipcode = convo.humanSalesZipcode;
  const zipInfo = await ZipCode.lookup(zipcode);

  await updateConversation(psid, {
    humanSalesNeighborhood: neighborhoodName,
    humanSalesPendingNeighborhoods: []
  });

  console.log(`✅ User selected neighborhood: ${neighborhoodName}`);
  return await proceedAfterLocation(zipcode, zipInfo, psid, convo, neighborhoodName);
}

/**
 * Continue flow after location is confirmed (zipcode + optional neighborhood)
 */
async function proceedAfterLocation(zipcode, zipInfo, psid, convo, neighborhood = null) {
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
  let locationText = `📍 ${zipInfo.city}, ${zipInfo.state}`;
  if (neighborhood) {
    locationText = `📍 ${neighborhood}, ${zipInfo.city}, ${zipInfo.state}`;
  }

  // If only 1 option, auto-select it
  if (options.length === 1) {
    const selectedProduct = options[0];
    const price = selectedProduct.price ? `$${selectedProduct.price}` : 'Consultar precio';

    await updateConversation(psid, {
      humanSalesState: 'asking_quantity',
      humanSalesZipcode: zipcode,
      humanSalesNeighborhood: neighborhood,
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

  // Build response based on number of options
  let responseText = `✅ ¡Perfecto! Veo que estás en:\n${locationText}\n\n`;
  const productName = currentProduct.parentId?.name || currentProduct.name;

  if (options.length > 3) {
    // More than 3 options: show range (smallest to largest)
    // Extract numeric values from names for sorting (e.g., "35%" -> 35)
    const optionsWithValues = options.map(opt => {
      const numMatch = opt.name.match(/(\d+)/);
      return { ...opt.toObject(), numValue: numMatch ? parseInt(numMatch[1]) : 0 };
    }).sort((a, b) => a.numValue - b.numValue);

    const smallest = optionsWithValues[0];
    const largest = optionsWithValues[optionsWithValues.length - 1];
    const smallPrice = smallest.price ? `$${smallest.price}` : 'consultar precio';
    const largePrice = largest.price ? `$${largest.price}` : 'consultar precio';

    responseText += `Tenemos ${productName} desde ${smallest.name} (${smallPrice}) hasta ${largest.name} (${largePrice}).\n\n`;
    responseText += `¿Qué porcentaje o medida necesitas?`;
  } else {
    // 2-3 options: list them all naturally
    responseText += `Tenemos ${productName} en:\n\n`;

    options.forEach((option) => {
      const price = option.price ? `$${option.price}` : 'Consultar precio';
      responseText += `• ${option.name} - ${price}\n`;
    });

    responseText += `\n¿Cuál te interesa?`;
  }

  await updateConversation(psid, {
    humanSalesState: 'asking_product_selection',
    humanSalesZipcode: zipcode,
    humanSalesNeighborhood: neighborhood,
    humanSalesLocation: zipInfo
  });

  return {
    type: "text",
    text: responseText,
    metadata: { availableOptions: options.map(o => o._id.toString()) }
  };
}

/**
 * Handle product selection response - understands natural language
 * Examples: "50 y 70%", "el de 80", "35%", "1 y 3", "la primera"
 */
async function handleProductSelectionResponse(msg, psid, convo) {
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

  if (options.length === 0) {
    return {
      type: "text",
      text: "No hay opciones disponibles. Un asesor te contactará pronto."
    };
  }

  // Parse user selection - try multiple methods
  const selectedIndices = parseProductSelection(msg, options);

  if (selectedIndices.length === 0) {
    // Couldn't understand, ask again with examples
    const exampleOptions = options.slice(0, 2).map(o => {
      const percentMatch = o.name.match(/(\d+)%?/);
      return percentMatch ? percentMatch[1] + "%" : o.name;
    }).join(" o ");

    return {
      type: "text",
      text: `No entendí tu selección. ¿Cuál opción te interesa? Por ejemplo: "${exampleOptions}"`
    };
  }

  // Handle multiple selections (e.g., "50 y 70%")
  if (selectedIndices.length > 1) {
    const selectedNames = selectedIndices.map(i => options[i].name).join(" y ");

    // Store multiple selections for sequential processing
    await updateConversation(psid, {
      humanSalesState: 'asking_quantity',
      humanSalesCurrentProduct: options[selectedIndices[0]]._id,
      humanSalesPendingSelections: selectedIndices.slice(1).map(i => options[i]._id)
    });

    return {
      type: "text",
      text: `¡Perfecto! Has seleccionado: ${selectedNames} 📦\n\nEmpecemos con ${options[selectedIndices[0]].name}. ¿Cuántos rollos necesitas de este?`
    };
  }

  // Single selection
  const selectedProduct = options[selectedIndices[0]];

  await updateConversation(psid, {
    humanSalesState: 'asking_quantity',
    humanSalesCurrentProduct: selectedProduct._id
  });

  return {
    type: "text",
    text: `¡Perfecto! Has seleccionado: ${selectedProduct.name} 📦\n\n¿Cuántos rollos necesitas?`
  };
}

/**
 * Parse user's product selection from natural language
 * Returns array of indices (0-based) of matched options
 */
function parseProductSelection(msg, options) {
  const selectedIndices = [];
  const msgLower = msg.toLowerCase();

  // Extract all numbers and percentages from message
  // Matches: "50", "50%", "70 %", etc.
  const numbersInMsg = [...msgLower.matchAll(/(\d+)\s*%?/g)].map(m => parseInt(m[1]));

  // Try to match by percentage/number in option name
  for (let i = 0; i < options.length; i++) {
    const optionName = options[i].name.toLowerCase();

    // Extract percentage from option name (e.g., "35%" from "35% - Rollo...")
    const optionPercentMatch = optionName.match(/(\d+)%?/);
    const optionPercent = optionPercentMatch ? parseInt(optionPercentMatch[1]) : null;

    // Check if any number in message matches this option's percentage
    if (optionPercent && numbersInMsg.includes(optionPercent)) {
      if (!selectedIndices.includes(i)) {
        selectedIndices.push(i);
      }
    }
  }

  // If we found matches by percentage, return them
  if (selectedIndices.length > 0) {
    return selectedIndices;
  }

  // Try matching by list number (1, 2, 3, etc.) - but only if no percentage match
  for (const num of numbersInMsg) {
    if (num >= 1 && num <= options.length) {
      const idx = num - 1;
      if (!selectedIndices.includes(idx)) {
        selectedIndices.push(idx);
      }
    }
  }

  // Try matching ordinals (primero, segundo, etc.)
  const ordinals = [
    { pattern: /\b(primer[oa]?|1er[oa]?)\b/i, index: 0 },
    { pattern: /\b(segund[oa]?|2d[oa]?)\b/i, index: 1 },
    { pattern: /\b(tercer[oa]?|3er[oa]?)\b/i, index: 2 },
    { pattern: /\b(cuart[oa]?|4t[oa]?)\b/i, index: 3 },
    { pattern: /\b(quint[oa]?|5t[oa]?)\b/i, index: 4 }
  ];

  for (const ord of ordinals) {
    if (ord.pattern.test(msgLower) && ord.index < options.length) {
      if (!selectedIndices.includes(ord.index)) {
        selectedIndices.push(ord.index);
      }
    }
  }

  return selectedIndices;
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

  // Check if there are pending selections (user selected multiple products like "50 y 70%")
  const pendingSelections = convo.humanSalesPendingSelections || [];

  if (pendingSelections.length > 0) {
    // Move to next pending selection
    const nextProductId = pendingSelections[0];
    const remainingSelections = pendingSelections.slice(1);
    const nextProduct = await ProductFamily.findById(nextProductId);

    await updateConversation(psid, {
      humanSalesState: 'asking_quantity',
      humanSalesCart: updatedCart,
      humanSalesCurrentProduct: nextProductId,
      humanSalesPendingSelections: remainingSelections
    });

    return {
      type: "text",
      text: `✅ Agregado: ${quantity}x ${selectedProduct.name}\n\n` +
            `Ahora para ${nextProduct?.name || 'el siguiente producto'}, ¿cuántos rollos necesitas?`
    };
  }

  // No pending selections - go to "more items?" flow
  await updateConversation(psid, {
    humanSalesState: 'asking_more_items',
    humanSalesCart: updatedCart,
    humanSalesCurrentProduct: null,
    humanSalesPendingSelections: []
  });

  // Build cart summary
  let summaryText = `✅ Agregado al pedido:\n`;
  summaryText += `• ${quantity}x ${selectedProduct.name}\n\n`;
  summaryText += `📋 Resumen de tu pedido:\n`;

  updatedCart.forEach((item, index) => {
    summaryText += `${index + 1}. ${item.quantity}x ${item.productName}\n`;
  });

  const locationLine = convo.humanSalesNeighborhood
    ? `📍 ${convo.humanSalesNeighborhood}, CP ${convo.humanSalesZipcode}`
    : `📍 Código postal: ${convo.humanSalesZipcode}`;
  summaryText += `\n${locationLine}\n\n`;
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
    const neighborhood = convo.humanSalesNeighborhood;

    let orderSummary = `🛒 NUEVO PEDIDO - Requiere cotización de envío\n\n`;
    orderSummary += `📋 Productos:\n`;
    cart.forEach((item, index) => {
      orderSummary += `${index + 1}. ${item.quantity}x ${item.productName}\n`;
    });
    if (neighborhood) {
      orderSummary += `\n📍 Colonia: ${neighborhood}\n`;
    }
    orderSummary += `\n📍 Código Postal: ${zipcode}\n`;
    orderSummary += `\n⏰ ${new Date().toLocaleString('es-MX')}\n`;

    // Clear sales state
    await updateConversation(psid, {
      humanSalesState: null,
      humanSalesCart: [],
      humanSalesZipcode: null,
      humanSalesNeighborhood: null,
      humanSalesPendingNeighborhoods: [],
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
