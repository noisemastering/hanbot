// Test against LOCAL server which has the fix
require('dotenv').config();
const axios = require('axios');
const mongoose = require('mongoose');
const ProductFamily = require('../models/ProductFamily');

async function testLocal() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Find a sellable product
    const product = await ProductFamily.findOne({
      sellable: true,
      $or: [
        { onlineStoreLinks: { $exists: false } },
        { onlineStoreLinks: { $size: 0 } }
      ]
    });

    console.log(`📝 Testing with: ${product.name} (ID: ${product._id})`);
    console.log(`   Current links:`, product.onlineStoreLinks || []);

    // Test data
    const updateData = {
      name: product.name,
      sellable: true,
      onlineStoreLinks: [
        {
          url: 'https://articulo.mercadolibre.com.mx/MLM-WORKS',
          store: 'Mercado Libre',
          isPreferred: true
        }
      ]
    };

    console.log('\n📤 Testing against LOCALHOST:3000...\n');

    // Call LOCAL API
    const response = await axios.put(
      `http://localhost:3000/product-families/${product._id}`,
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
    const verified = await ProductFamily.findById(product._id);
    console.log('\n🔍 Database onlineStoreLinks:', verified.onlineStoreLinks);

    const hasCorrectLink = verified.onlineStoreLinks &&
                          verified.onlineStoreLinks.length > 0 &&
                          verified.onlineStoreLinks[0].url.includes('MLM-WORKS');

    if (hasCorrectLink) {
      console.log('\n🎉 SUCCESS! The fix WORKS on localhost!');
      console.log('\n✅ Once Railway deploys, it will work in production too.');
    } else {
      console.log('\n❌ Something is still wrong with the code.');
    }

    await mongoose.disconnect();
  } catch (error) {
    console.error('\n❌ Error:', error.response?.data || error.message);
    process.exit(1);
  }
}

testLocal();
