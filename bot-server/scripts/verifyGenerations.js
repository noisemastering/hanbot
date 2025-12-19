const mongoose = require('mongoose');
require('dotenv').config();

async function verifyGenerations() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const ProductFamily = mongoose.model('ProductFamily', new mongoose.Schema({}, { strict: false }));

    // Check "Confeccionada con Refuerzo"
    const conRefuerzo = await ProductFamily.findById('69152f570c0134ee807abe63').lean();
    console.log('\n=== Confeccionada con Refuerzo ===');
    console.log(`Name: ${conRefuerzo.name}`);
    console.log(`Generation: ${conRefuerzo.generation}`);

    // Check its children
    const children = await ProductFamily.find({ parentId: '69152f570c0134ee807abe63' }).lean();
    console.log(`\n=== Direct Children (${children.length}) ===`);
    children.slice(0, 5).forEach(child => {
      console.log(`  - "${child.name}" (Gen ${child.generation})`);
    });

    // Check "Confeccionada sin Refuerzo" for comparison
    const sinRefuerzo = await ProductFamily.findById('6915377d0c0134ee807abf2a').lean();
    console.log('\n=== Confeccionada sin Refuerzo (for comparison) ===');
    console.log(`Name: ${sinRefuerzo.name}`);
    console.log(`Generation: ${sinRefuerzo.generation}`);

    await mongoose.connection.close();
    console.log('\n✅ Done');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

verifyGenerations();
