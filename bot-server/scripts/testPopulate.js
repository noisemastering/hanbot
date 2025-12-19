const mongoose = require('mongoose');
require('dotenv').config();

const Uso = require('../models/Uso');
const ProductFamily = require('../models/ProductFamily');

async function test() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Get first Uso
    const uso = await Uso.findOne({ name: 'Uso de prueba' });
    console.log('\n📦 Raw Uso:');
    console.log('Name:', uso.name);
    console.log('Products array:', uso.products);
    console.log('First product type:', typeof uso.products[0]);
    console.log('First product instanceof ObjectId:', uso.products[0] instanceof mongoose.Types.ObjectId);

    // Try to find the product directly
    const productId = uso.products[0];
    console.log('\n🔍 Looking for product with ID:', productId);

    const product = await ProductFamily.findById(productId);
    console.log('Found product:', product ? product.name : 'NOT FOUND');

    // Try populate
    console.log('\n🔄 Testing populate:');
    const populatedUso = await Uso.findOne({ name: 'Uso de prueba' })
      .populate('products');
    console.log('First product after populate:', populatedUso.products[0]);
    console.log('Type:', typeof populatedUso.products[0]);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

test();
