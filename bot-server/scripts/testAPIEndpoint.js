// Test the PUT endpoint like the frontend does
require('dotenv').config();
const axios = require('axios');
const mongoose = require('mongoose');
const ProductFamily = require('../models/ProductFamily');

async function testAPI() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Find a sellable product
    const product = await ProductFamily.findOne({ sellable: true });
    console.log(`📝 Testing with product: ${product.name} (ID: ${product._id})\n`);

    // Prepare data exactly like the frontend does
    const updateData = {
      name: product.name,
      description: product.description,
      sellable: true,
      price: product.price,
      onlineStoreLinks: [
        {
          url: 'https://mercadolibre.com.mx/test',
          store: 'Mercado Libre',
          isPreferred: true
        }
      ]
    };

    console.log('📤 Sending PUT request with data:');
    console.log(JSON.stringify(updateData, null, 2));

    // Call the API endpoint
    const response = await axios.put(
      `https://hanbot-production.up.railway.app/product-families/${product._id}`,
      updateData,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer hanlob_admin_2025'
        }
      }
    );

    console.log('\n✅ API Response:', response.data.success ? 'SUCCESS' : 'FAILED');
    console.log('📥 Response data:');
    console.log(`   Name: ${response.data.data.name}`);
    console.log(`   Sellable: ${response.data.data.sellable}`);
    console.log(`   onlineStoreLinks:`, response.data.data.onlineStoreLinks);

    // Verify by fetching from database
    const verified = await ProductFamily.findById(product._id);
    console.log('\n🔍 Verified from database:');
    console.log(`   onlineStoreLinks:`, verified.onlineStoreLinks);

    if (verified.onlineStoreLinks && verified.onlineStoreLinks.length > 0) {
      console.log('\n🎉 SUCCESS! The API endpoint works correctly!');
    } else {
      console.log('\n❌ FAILED! Links were not saved via API!');
    }

    await mongoose.disconnect();
  } catch (error) {
    console.error('\n❌ Error:', error.response?.data || error.message);
    process.exit(1);
  }
}

testAPI();
