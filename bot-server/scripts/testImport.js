const mongoose = require('mongoose');
require('dotenv').config();

async function testImport() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const Product = mongoose.model('Product', new mongoose.Schema({}, { strict: false }));
    const ProductFamily = mongoose.model('ProductFamily', new mongoose.Schema({}, { strict: false }));

    // Get first product
    const product = await Product.findOne();
    console.log('\nFirst product to import:');
    console.log('  ID:', product._id);
    console.log('  Name:', product.name);
    console.log('  Size:', product.size);
    console.log('  Price:', product.price);

    // Get Rectangular target family
    const rectangular = await ProductFamily.findOne({ name: { $regex: 'rectangular', $options: 'i' } });
    console.log('\nTarget family (Rectangular):');
    console.log('  ID:', rectangular._id);
    console.log('  Generation:', rectangular.generation);

    // Simulate import - create new ProductFamily from Product
    const productFamilyData = {
      name: product.size ? `${product.name} ${product.size}` : product.name,
      description: product.description || "",
      imageUrl: product.imageUrl || "",
      price: product.price ? parseFloat(product.price) : undefined,
      parentId: rectangular._id,
      generation: rectangular.generation + 1,
      sellable: true,
      available: true,
      active: true
    };

    console.log('\nCreating new ProductFamily with data:');
    console.log(JSON.stringify(productFamilyData, null, 2));

    const newProductFamily = new ProductFamily(productFamilyData);
    await newProductFamily.save();

    console.log('\nSuccess! Created ProductFamily:');
    console.log('  ID:', newProductFamily._id);
    console.log('  Name:', newProductFamily.name);
    console.log('  Generation:', newProductFamily.generation);
    console.log('  ParentId:', newProductFamily.parentId);

    // Verify it was created
    const children = await ProductFamily.find({ parentId: rectangular._id });
    console.log('\nRectangular now has', children.length, 'children');

    await mongoose.connection.close();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

testImport();
