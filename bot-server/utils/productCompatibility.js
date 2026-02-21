/**
 * Compatibility layer to convert new Product[] format to legacy CampaignProduct structure
 * This preserves all AI flow logic while using the new product association system
 */

/**
 * Converts an array of Product documents to CampaignProduct-like structure
 * @param {Array} products - Array of Product documents (from convo.availableProducts)
 * @param {Object} campaign - Campaign document (optional, for additional context)
 * @returns {Object} - CampaignProduct-like object with variants, features, name
 */
function convertProductsToCampaignProduct(products, campaign = null) {
  if (!products || products.length === 0) {
    return null;
  }

  // Extract unique features from all products
  const features = [];
  const featureSet = new Set();

  products.forEach(product => {
    // Add features based on product attributes
    if (product.reinforcements && !featureSet.has('Refuerzos en esquinas')) {
      features.push('Refuerzos en esquinas');
      featureSet.add('Refuerzos en esquinas');
    }

    if (product.ojillos && !featureSet.has('Argollas en todo el borde')) {
      features.push('Argollas en todo el borde');
      featureSet.add('Argollas en todo el borde');
    }

    if (product.borderType === 'Reforzado' && !featureSet.has('Borde reforzado')) {
      features.push('Borde reforzado');
      featureSet.add('Borde reforzado');
    }

    if (product.customizable && !featureSet.has('Medidas personalizadas disponibles')) {
      features.push('Medidas personalizadas disponibles');
      featureSet.add('Medidas personalizadas disponibles');
    }
  });

  // If no specific features found, add generic quality feature
  if (features.length === 0) {
    features.push('Fabricación de alta calidad');
  }

  // Convert products to variants array
  const variants = products.map(product => {
    // Parse price (handle both String and Number)
    let price = 0;
    if (typeof product.price === 'string') {
      // Remove currency symbols, commas, and spaces
      const cleanPrice = product.price.replace(/[$,\s]/g, '');
      price = parseFloat(cleanPrice) || 0;
    } else if (typeof product.price === 'number') {
      price = product.price;
    }

    // Get preferred online store link (ProductFamily uses onlineStoreLinks, not mLink)
    const preferredLink = product.onlineStoreLinks?.find(l => l.isPreferred)?.url ||
                         product.onlineStoreLinks?.[0]?.url ||
                         product.mLink || '';

    return {
      size: product.size || 'N/A',
      price: price,
      stock: true, // Assume in stock if listed
      source: preferredLink ? 'mercadolibre' : 'local',
      permalink: preferredLink,
      imageUrl: product.imageUrl || product.thumbnail || ''
    };
  }).filter(variant => variant.size !== 'N/A'); // Filter out products without size

  // Use campaign name if available, otherwise derive from first product
  let name = 'Malla sombra confeccionada';
  if (campaign && campaign.name) {
    name = campaign.name;
  } else if (products[0] && products[0].name) {
    name = products[0].name;
  }

  // Return CampaignProduct-like structure
  return {
    name: name,
    features: features,
    variants: variants,
    suggestClosest: true,
    active: true,
    // Include reference to original products for debugging
    _sourceProducts: products.map(p => p._id)
  };
}

/**
 * Gets campaign product data using the new product association system
 * This replaces: await CampaignProduct.findOne({ campaignRef, active: true })
 *
 * @param {Object} convo - Conversation object (should have availableProducts populated)
 * @param {Object} campaign - Campaign document (optional)
 * @returns {Object|null} - CampaignProduct-like object or null
 */
function getCampaignProductFromConversation(convo, campaign = null) {
  // Use availableProducts from conversation (already populated by productLookup)
  const products = convo.availableProducts || [];

  if (products.length === 0) {
    console.log('⚠️ No products available for this conversation');
    return null;
  }

  console.log(`✅ Converting ${products.length} products to CampaignProduct format`);
  return convertProductsToCampaignProduct(products, campaign);
}

module.exports = {
  convertProductsToCampaignProduct,
  getCampaignProductFromConversation
};
