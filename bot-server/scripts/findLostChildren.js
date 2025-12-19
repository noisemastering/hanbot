const mongoose = require('mongoose');
require('dotenv').config();

async function findLostChildren() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const ProductFamily = mongoose.model('ProductFamily', new mongoose.Schema({}, { strict: false }));

    // Search for products that should be children of "Confeccionada con Refuerzo"
    console.log('=== Searching for "Triangular" and "Rectangular" ===\n');

    const triangular = await ProductFamily.find({ name: 'Triangular' }).lean();
    console.log(`Found ${triangular.length} "Triangular" product(s):`);
    triangular.forEach(t => {
      console.log(`  - ID: ${t._id}, Gen: ${t.generation}, ParentId: ${t.parentId}`);
    });

    const rectangular = await ProductFamily.find({ name: 'Rectangular' }).lean();
    console.log(`\nFound ${rectangular.length} "Rectangular" product(s):`);
    rectangular.forEach(r => {
      console.log(`  - ID: ${r._id}, Gen: ${r.generation}, ParentId: ${r.parentId}`);
    });

    // Check if there are any products with the old parentId
    console.log('\n=== Checking for products with parentId = 69152f570c0134ee807abe63 ===');
    const withParent = await ProductFamily.find({ parentId: '69152f570c0134ee807abe63' }).lean();
    console.log(`Found ${withParent.length} products with this parentId`);

    // Check for products with names containing "5x5x5", "4x4x4", etc (the sizes we saw earlier)
    console.log('\n=== Searching for specific size products ===');
    const sizes = await ProductFamily.find({
      name: { $in: ['5x5x5', ' 4x4x4', '3x3x3', '2x2x2', '6m x 4m', '4 m x 3 m'] }
    }).lean();
    console.log(`Found ${sizes.length} size products:`);
    sizes.forEach(s => {
      console.log(`  - "${s.name}" (ID: ${s._id}, Gen: ${s.generation}, ParentId: ${s.parentId})`);
    });

    await mongoose.connection.close();
    console.log('\n✅ Done');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

findLostChildren();
