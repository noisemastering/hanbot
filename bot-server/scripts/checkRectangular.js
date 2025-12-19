const mongoose = require('mongoose');
require('dotenv').config();

async function checkRectangular() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const ProductFamily = mongoose.model('ProductFamily', new mongoose.Schema({}, { strict: false }));

    // Find "Rectangular" product
    const rectangular = await ProductFamily.findOne({ name: { $regex: 'rectangular', $options: 'i' } });

    if (!rectangular) {
      console.log('Rectangular not found');
      await mongoose.connection.close();
      return;
    }

    console.log('\nRectangular product:');
    console.log('  ID:', rectangular._id);
    console.log('  Name:', rectangular.name);
    console.log('  Generation:', rectangular.generation);
    console.log('  Sellable:', rectangular.sellable);

    // Find all children of Rectangular
    const children = await ProductFamily.find({ parentId: rectangular._id });

    console.log('\nChildren count:', children.length);

    if (children.length > 0) {
      console.log('\nChildren:');
      children.forEach((child, i) => {
        console.log(`  ${i + 1}. ${child.name} (Gen ${child.generation}, Sellable: ${child.sellable})`);
      });
    } else {
      console.log('\nNo children found for Rectangular');
    }

    // Also check how many products exist in the Products collection
    const Product = mongoose.model('Product', new mongoose.Schema({}, { strict: false }));
    const productCount = await Product.countDocuments();
    console.log('\nTotal products in Products collection:', productCount);

    await mongoose.connection.close();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkRectangular();
