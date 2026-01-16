/**
 * Match ML listings to inventory products
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const ProductFamily = require('../models/ProductFamily');

const axios = require('axios');

const mlListings = [
  { mlId: '2707972264', title: 'Malla Sombra 90% Raschel Beige De 6mx4m Reforzada' },
  { mlId: '801000953', title: 'Lona Sombra 90% Raschel Beige De 4mx3m Reforzada' },
  { mlId: '2740535092', title: 'Malla Sombra 90% Raschel Beige De 5mx4m Reforzada' },
  { mlId: '1986999963', title: 'Malla Sombra 90% Raschel Beige De 6mx5m Reforzada' },
  { mlId: '1987051665', title: 'Lona Sombra 4m X 4m Lista Para Instalar' },
  { mlId: '2019043977', title: 'Malla Sombra 90% Raschel Beige De 5mx3m Reforzada' },
  { mlId: '2706075200', title: 'Malla Sombra 90% Raschel Beige De 6mx3m Reforzada' },
  { mlId: '1990721207', title: 'Malla Sombra 90% Raschel Beige De 3mx3m Reforzada' },
  { mlId: '1984383929', title: 'Malla Sombra 90% Raschel Beige De 5mx5m Reforzada' },
  { mlId: '1997468643', title: 'Malla Sombra 90% Raschel Beige De 7mx5m Reforzada' },
  { mlId: '3462012456', title: 'Malla Sombra 90% Raschell Beige De 3mx2m Reforzada' },
  { mlId: '2727308608', title: 'Malla Sombra 90% Raschel Beige De 4mx2m Reforzada' },
  { mlId: '1984372647', title: 'Malla Sombra 90% Raschel Beige De 7mx3m Reforzada' },
  { mlId: '2705920400', title: 'Malla Sombra 6mx6m 90% Beige Raschel Reforzada' },
  { mlId: '2050173695', title: 'Malla Sombra 90% Raschell Beige De 6mx2m Reforzada' },
  { mlId: '2705870874', title: 'Malla Sombra 90% Raschell Beige De 5mx10m Reforzada' },
  { mlId: '850951332', title: 'Malla Sombra 90% Raschel Beige De 2mx2m Reforzada' },
  { mlId: '2727296298', title: 'Malla Sombra 90% Raschel Beige De 5mx8m Reforzada' },
  { mlId: '828811925', title: 'Malla Sombra 90% 5x5x5 M Triangulo Velaria Raschel Beige' },
  { mlId: '2036260711', title: 'Malla Sombra 6x8 90% Beige Raschel Reforzada' },
  { mlId: '1995870309', title: 'Malla Sombra 90% Raschell Beige De 4mx8m Reforzada' },
  { mlId: '948918220', title: 'Malla Sombra 90% Raschel Beige De 3mx8m Reforzada' },
  { mlId: '1990721445', title: 'Malla Sombra 90% Raschel Beige De 5mx2m Reforzada' },
  { mlId: '828762858', title: 'Malla Sombra 90% 3x3x3 M Triangulo Velaria Raschel Beige' },
  { mlId: '2969270018', title: 'Malla Sombra 6x7 90% Beige Raschel Reforzada' },
  { mlId: '2735939846', title: 'Malla Sombra 90% Raschell Beige De 4mx10m Reforzada' },
  { mlId: '828801204', title: 'Malla Sombra 90% 4x4x4 M Triangulo Velaria Raschel Beige' },
  { mlId: '2050147673', title: 'Malla Sombra 90% Raschel Beige De 5mx9m Reforzada' },
  { mlId: '2050109383', title: 'Malla Sombra 90% Raschel Beige De 4mx9m Reforzada' },
  { mlId: '1954195117', title: 'Malla Sombra 90% Raschell Beige De 2mx7m Reforzada' },
  { mlId: '1396745742', title: 'Malla Sombra 6x10 90% Beige Raschel Reforzada' },
  { mlId: '2868830514', title: 'Malla Sombra 90% Raschel Beige De 3mx10m Reforzada' },
  { mlId: '1954196465', title: 'Malla Sombra 90% Raschell Beige De 2mx10m Reforzada' },
  { mlId: '1323267451', title: 'Malla Sombra 90% 2x2x2 Mt Triangulo Velaria Raschel Beige' },
  { mlId: '1300999171', title: 'Malla Sombra 90% Raschel Beige De 3mx9m Reforzada' },
  { mlId: '1359507319', title: 'Malla Sombra 8x8 90% Beige Raschel Reforzada' },
  { mlId: '1954164669', title: 'Malla Sombra 90% Raschell Beige De 2mx9m Reforzada' },
  { mlId: '1335138588', title: 'Malla Sombra 7x7 90% Beige Raschel Reforzada' },
  { mlId: '1386613937', title: 'Malla Sombra 7x10 90% Beige Raschel Reforzada' },
  { mlId: '1397182168', title: 'Malla Sombra 7x8 90% Beige Raschel Reforzada' },
  { mlId: '1333000556', title: 'Malla Sombra 6x9 90% Beige Raschel Reforzada' },
  { mlId: '1954112273', title: 'Malla Sombra 90% Raschell Beige De 8mx2m Reforzada' },
  { mlId: '1443194404', title: 'Malla Sombra 90% Raschel Beige De 7mx9m Reforzada' },
  { mlId: '1903527839', title: 'Malla Sombra 90% Raschel Beige De 4mx11m Reforzada' },
  { mlId: '1617804656', title: 'Malla Sombra 90% Raschel Beige De 5mx11m Reforzada' }
];

const MercadoLibreAuth = require('../models/MercadoLibreAuth');

// Fetch price from ML API using OAuth token
async function fetchMLPrice(mlId, accessToken) {
  try {
    const response = await axios.get(`https://api.mercadolibre.com/items/MLM${mlId}`, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
    });
    return {
      price: response.data.price,
      sku: response.data.seller_custom_field || null,
      status: response.data.status
    };
  } catch (err) {
    // Don't spam console, just return null
    return null;
  }
}

// Get access token from stored OAuth (use seller 482595248 which owns these items)
async function getAccessToken() {
  const auth = await MercadoLibreAuth.findOne({ sellerId: '482595248', active: true });
  if (!auth) {
    // Fallback to any active token
    const fallback = await MercadoLibreAuth.findOne({ active: true }).sort({ updatedAt: -1 });
    return fallback?.accessToken || null;
  }
  return auth.accessToken;
}

function parseDimensions(title) {
  // Triangular: 5x5x5, 3x3x3, etc.
  const triMatch = title.match(/(\d+)x(\d+)x(\d+)/i);
  if (triMatch) {
    return { type: 'triangular', dims: `${triMatch[1]} m x ${triMatch[2]} m x ${triMatch[3]} m` };
  }

  // Rectangular: 6mx4m, 4mx3m, 6x8, etc.
  const rectMatch = title.match(/(\d+)\s*m?\s*x\s*(\d+)\s*m?/i);
  if (rectMatch) {
    return { type: 'rectangular', dims: `${rectMatch[1]} m x ${rectMatch[2]} m` };
  }

  return null;
}

// Normalize dimension name for comparison (remove extra spaces, handle variations)
function normalizeDimName(name) {
  return name
    .toLowerCase()
    .replace(/\s+/g, ' ')           // Multiple spaces to single
    .replace(/(\d+)\s*m?\s*x\s*/gi, '$1 m x ')  // Normalize "6mx4m" → "6 m x 4 m x"
    .replace(/\s*m\s*$/i, ' m')     // Ensure ends with " m"
    .trim();
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB\n');

  // Find the product categories - BOTH con refuerzo AND sin refuerzo
  const raschel = await ProductFamily.findOne({ name: 'Malla Sombra Raschel' });
  const ninety = await ProductFamily.findOne({ parentId: raschel._id, name: '90%' });

  const conRefuerzo = await ProductFamily.findOne({ parentId: ninety._id, name: /Confeccionada con Refuerzo/i });
  const sinRefuerzo = await ProductFamily.findOne({ parentId: ninety._id, name: /Confeccionada sin Refuerzo/i });

  // Get all rectangular and triangular categories
  const rectConRef = await ProductFamily.findOne({ parentId: conRefuerzo._id, name: 'Rectangular' });
  const triConRef = await ProductFamily.findOne({ parentId: conRefuerzo._id, name: 'Triangular' });
  const rectSinRef = await ProductFamily.findOne({ parentId: sinRefuerzo._id, name: 'Rectangular' });

  // Get ALL products from both categories
  const rectConRefProducts = await ProductFamily.find({ parentId: rectConRef._id, sellable: true });
  const triProducts = await ProductFamily.find({ parentId: triConRef._id, sellable: true });
  const rectSinRefProducts = rectSinRef ? await ProductFamily.find({ parentId: rectSinRef._id, sellable: true }) : [];

  // Combine all rectangular products
  const rectProducts = [...rectConRefProducts, ...rectSinRefProducts];

  console.log('📦 Products in inventory:');
  console.log(`   Rectangular (con refuerzo): ${rectConRefProducts.length}`);
  console.log(`   Rectangular (sin refuerzo): ${rectSinRefProducts.length}`);
  console.log(`   Triangular: ${triProducts.length}`);
  console.log('');

  let matched = [];
  let notFound = [];

  // Helper to find product with normalized name matching
  function findProduct(products, targetDims) {
    const normalizedTarget = normalizeDimName(targetDims);

    // Try exact normalized match
    let product = products.find(p => normalizeDimName(p.name) === normalizedTarget);

    // Try swapped orientation (6x4 → 4x6)
    if (!product) {
      const nums = targetDims.match(/\d+/g);
      if (nums && nums.length >= 2) {
        const swapped = `${nums[1]} m x ${nums[0]} m`;
        const normalizedSwapped = normalizeDimName(swapped);
        product = products.find(p => normalizeDimName(p.name) === normalizedSwapped);
      }
    }

    return product;
  }

  for (const { mlId, title } of mlListings) {
    const parsed = parseDimensions(title);

    if (!parsed) {
      console.log(`❌ Could not parse: ${title}`);
      continue;
    }

    let product = null;

    if (parsed.type === 'triangular') {
      product = findProduct(triProducts, parsed.dims);
    } else {
      product = findProduct(rectProducts, parsed.dims);
    }

    if (product) {
      console.log(`✅ MLM-${mlId} → ${product.name} (ID: ${product._id})`);
      matched.push({ mlId, product, title });
    } else {
      console.log(`❓ MLM-${mlId} → ${parsed.dims} NOT IN INVENTORY`);
      notFound.push({ mlId, dims: parsed.dims, type: parsed.type, title });
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log('SUMMARY');
  console.log('='.repeat(50));
  console.log(`✅ Matched: ${matched.length}/${mlListings.length}`);
  console.log(`❓ Not found: ${notFound.length}/${mlListings.length}`);

  if (notFound.length > 0) {
    console.log('\n📋 MISSING SIZES (need to add to inventory):');
    const uniqueMissing = [...new Set(notFound.map(x => `${x.dims} (${x.type})`))];
    uniqueMissing.forEach(m => console.log(`   - ${m}`));
  }

  // === UPDATE MATCHED PRODUCTS ===
  if (process.argv.includes('--update')) {
    console.log('\n' + '='.repeat(50));
    console.log('UPDATING MATCHED PRODUCTS (fetching prices from ML API)');
    console.log('='.repeat(50));

    // Get OAuth token
    const accessToken = await getAccessToken();
    if (accessToken) {
      console.log('🔐 Using OAuth token for ML API\n');
    } else {
      console.log('⚠️ No OAuth token found, prices may not be fetched\n');
    }

    for (const { mlId, product, title } of matched) {
      const mlItemId = `MLM${mlId}`;
      const mlLink = `https://articulo.mercadolibre.com.mx/MLM-${mlId}`;

      // Fetch current price from ML
      const mlData = await fetchMLPrice(mlId, accessToken);

      const updateData = {
        mlItemId: mlItemId,
        mlLink: mlLink
      };

      if (mlData) {
        if (mlData.price) updateData.price = mlData.price;
        if (mlData.sku) updateData.sku = mlData.sku;
      }

      await ProductFamily.findByIdAndUpdate(product._id, updateData);

      const priceStr = mlData?.price ? `$${mlData.price}` : 'price N/A';
      const skuStr = mlData?.sku ? `SKU: ${mlData.sku}` : '';
      console.log(`✅ ${product.name} → ${mlItemId} | ${priceStr} ${skuStr}`);
    }

    // Mark unlinked products in these categories as inactive
    console.log('\n📴 Marking unlinked products as inactive...');

    const matchedIds = matched.map(m => m.product._id.toString());
    const allProducts = [...rectProducts, ...triProducts];

    let deactivated = 0;
    for (const product of allProducts) {
      if (!matchedIds.includes(product._id.toString()) && !product.mlItemId) {
        await ProductFamily.findByIdAndUpdate(product._id, { available: false });
        console.log(`   ❌ Deactivated: ${product.name}`);
        deactivated++;
      }
    }

    console.log(`\n✅ Done! Updated ${matched.length} products, deactivated ${deactivated} products.`);
  } else {
    console.log('\n💡 Run with --update flag to apply changes:');
    console.log('   node scripts/matchMLListings.js --update');
  }

  await mongoose.disconnect();
}

main().catch(console.error);
