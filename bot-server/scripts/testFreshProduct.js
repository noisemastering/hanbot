// Test with a product that has NO existing links
require('dotenv').config();
const axios = require('axios');
const mongoose = require('mongoose');
const ProductFamily = require('../models/ProductFamily');

async function testFresh() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Find a sellable product with NO links
    const product = await ProductFamily.findOne({
      sellable: true,
      $or: [
        { onlineStoreLinks: { $exists: false } },
        { onlineStoreLinks: { $size: 0 } }
      ]
    });

    if (!product) {
      console.log('All products have links! Using first sellable product...');
      const anyProduct = await ProductFamily.findOne({ sellable: true });
      // Clear its links first
      anyProduct.onlineStoreLinks = [];
      await anyProduct.save();
      console.log(`Cleared links from: ${anyProduct.name}\n`);
    }

    const testProduct = product || await ProductFamily.findOne({ sellable: true });

    console.log(`📝 Testing with: ${testProduct.name} (ID: ${testProduct._id})`);
    console.log(`   Current links:`, testProduct.onlineStoreLinks || []);

    // Send update with NEW link
    const updateData = {
      name: testProduct.name,
      sellable: true,
      onlineStoreLinks: [
        {
          url: 'https://articulo.mercadolibre.com.mx/MLM-12345',
          store: 'Mercado Libre',
          isPreferred: true
        }
      ]
    };

    console.log('\n📤 Sending update with NEW link...\n');

    const response = await axios.put(
      `https://hanbot-production.up.railway.app/product-families/${testProduct._id}`,
      updateData,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer hanlob_admin_2025'
        }
      }
    );

    console.log('📥 Response onlineStoreLinks:', response.data.data.onlineStoreLinks);

    // Verify from database
    const verified = await ProductFamily.findById(testProduct._id);
    console.log('\n🔍 Database onlineStoreLinks:', verified.onlineStoreLinks);

    const hasCorrectLink = verified.onlineStoreLinks &&
                          verified.onlineStoreLinks.length > 0 &&
                          verified.onlineStoreLinks[0].url.includes('MLM-12345');

    if (hasCorrectLink) {
      console.log('\n🎉 SUCCESS! New link was saved correctly!');
    } else {
      console.log('\n❌ FAILED! Link was not updated.');
      console.log('Expected: MLM-12345');
      console.log('Got:', verified.onlineStoreLinks?.[0]?.url || 'nothing');
    }

    await mongoose.disconnect();
  } catch (error) {
    console.error('\n❌ Error:', error.response?.data || error.message);
    process.exit(1);
  }
}

testFresh();
