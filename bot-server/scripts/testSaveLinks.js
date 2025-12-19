// Test script to directly save onlineStoreLinks to a product
require('dotenv').config();
const mongoose = require('mongoose');
const ProductFamily = require('../models/ProductFamily');

async function testSave() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Find a sellable product
    const product = await ProductFamily.findOne({ sellable: true });

    if (!product) {
      console.log('❌ No sellable products found');
      process.exit(1);
    }

    console.log(`\n📝 Testing with product: ${product.name}`);
    console.log(`   Current onlineStoreLinks:`, product.onlineStoreLinks);

    // Add a test link
    product.onlineStoreLinks = [{
      url: 'https://test.com/product',
      store: 'Test Store',
      isPreferred: true
    }];

    console.log(`\n💾 Attempting to save with links:`, product.onlineStoreLinks);

    await product.save();

    console.log(`\n✅ Save completed!`);

    // Fetch it back to verify
    const verified = await ProductFamily.findById(product._id);
    console.log(`\n🔍 Verified data from database:`);
    console.log(`   onlineStoreLinks:`, verified.onlineStoreLinks);

    if (verified.onlineStoreLinks && verified.onlineStoreLinks.length > 0) {
      console.log(`\n🎉 SUCCESS! Links were saved and retrieved!`);
    } else {
      console.log(`\n❌ FAILED! Links were not saved!`);
    }

    await mongoose.disconnect();
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

testSave();
