// scripts/auditMLLinks.js
// Audit all ML links to verify they point to correct products

const mongoose = require('mongoose');
const axios = require('axios');
require('dotenv').config();
const ProductFamily = require('../models/ProductFamily');
const { getValidMLToken } = require('../mlTokenManager');
const { extractMLItemId } = require('../utils/mlPriceSync');

async function auditLinks() {
  await mongoose.connect(process.env.MONGODB_URI);

  // Get all products with ML links
  const products = await ProductFamily.find({
    'onlineStoreLinks.0': { $exists: true }
  }).lean();

  console.log(`Found ${products.length} products with links\n`);

  // Get ML token
  let token;
  try {
    token = await getValidMLToken();
  } catch (err) {
    console.error('Could not get ML token:', err.message);
    await mongoose.disconnect();
    return;
  }

  // Collect all ML item IDs
  const itemsToCheck = [];
  for (const product of products) {
    for (const link of product.onlineStoreLinks) {
      if (link.url && link.url.includes('mercadolibre')) {
        const mlId = extractMLItemId(link.url);
        if (mlId) {
          itemsToCheck.push({
            productId: product._id,
            productName: product.name,
            mlItemId: mlId,
            url: link.url
          });
        }
      }
    }
  }

  console.log(`Found ${itemsToCheck.length} ML links to audit\n`);
  console.log('='.repeat(80));

  // Fetch ML items in batches of 20
  const results = { matches: [], mismatches: [], errors: [] };

  for (let i = 0; i < itemsToCheck.length; i += 20) {
    const batch = itemsToCheck.slice(i, i + 20);
    const ids = batch.map(b => b.mlItemId).join(',');

    try {
      const response = await axios.get('https://api.mercadolibre.com/items', {
        params: { ids },
        headers: { Authorization: `Bearer ${token}` }
      });

      for (const item of response.data) {
        const check = batch.find(b => b.mlItemId === item.body?.id);
        if (!check) continue;

        if (item.code !== 200 || !item.body) {
          results.errors.push({
            ...check,
            error: item.body?.message || 'Item not found'
          });
          continue;
        }

        const mlTitle = item.body.title.toLowerCase();
        const productName = check.productName.toLowerCase();

        // Extract dimensions from both
        const productDims = productName.match(/(\d+(?:\.\d+)?)\s*[mx×]\s*(\d+(?:\.\d+)?)/i);
        const mlDims = mlTitle.match(/(\d+(?:\.\d+)?)\s*[mx×]\s*(\d+(?:\.\d+)?)/i);

        let dimsMatch = false;
        if (productDims && mlDims) {
          const p1 = parseFloat(productDims[1]);
          const p2 = parseFloat(productDims[2]);
          const m1 = parseFloat(mlDims[1]);
          const m2 = parseFloat(mlDims[2]);
          // Check both orientations
          dimsMatch = (p1 === m1 && p2 === m2) || (p1 === m2 && p2 === m1);
        }

        const result = {
          productName: check.productName,
          mlTitle: item.body.title,
          mlId: item.body.id,
          mlPrice: item.body.price,
          mlStatus: item.body.status,
          dimsMatch
        };

        if (dimsMatch) {
          results.matches.push(result);
        } else {
          results.mismatches.push(result);
        }
      }
    } catch (err) {
      console.error('Batch error:', err.message);
    }
  }

  // Print results
  console.log('\n✅ MATCHES (' + results.matches.length + '):\n');
  results.matches.forEach(m => {
    console.log('  ' + m.productName + ' → ' + m.mlTitle.substring(0, 50) + '...');
  });

  console.log('\n\n⚠️  MISMATCHES (' + results.mismatches.length + '):\n');
  results.mismatches.forEach(m => {
    console.log('  Product: ' + m.productName);
    console.log('  ML Item: ' + m.mlTitle);
    console.log('  ML ID: ' + m.mlId + ' | Price: $' + m.mlPrice + ' | Status: ' + m.mlStatus);
    console.log('');
  });

  if (results.errors.length > 0) {
    console.log('\n\n❌ ERRORS (' + results.errors.length + '):\n');
    results.errors.forEach(e => {
      console.log('  ' + e.productName + ': ' + e.error);
    });
  }

  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY:');
  console.log('  Matches: ' + results.matches.length);
  console.log('  Mismatches: ' + results.mismatches.length);
  console.log('  Errors: ' + results.errors.length);

  await mongoose.disconnect();
}

auditLinks();
