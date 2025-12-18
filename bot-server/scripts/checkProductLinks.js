// Script to check if any ProductFamily documents have onlineStoreLinks
require('dotenv').config();
const mongoose = require('mongoose');
const ProductFamily = require('../models/ProductFamily');

async function checkLinks() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Get all sellable products
    const sellableProducts = await ProductFamily.find({ sellable: true });

    console.log(`\nFound ${sellableProducts.length} sellable products\n`);

    let withLinks = 0;
    let withoutLinks = 0;

    for (const product of sellableProducts) {
      const hasLinks = product.onlineStoreLinks && product.onlineStoreLinks.length > 0;

      if (hasLinks) {
        withLinks++;
        console.log(`✅ ${product.name}`);
        console.log(`   Links: ${product.onlineStoreLinks.length}`);
        product.onlineStoreLinks.forEach(link => {
          console.log(`   - ${link.store}: ${link.url} ${link.isPreferred ? '(preferred)' : ''}`);
        });
      } else {
        withoutLinks++;
        console.log(`❌ ${product.name} - NO LINKS`);
      }
    }

    console.log(`\n=== Summary ===`);
    console.log(`Total sellable products: ${sellableProducts.length}`);
    console.log(`With links: ${withLinks}`);
    console.log(`Without links: ${withoutLinks}`);

    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkLinks();
