const mongoose = require('mongoose');
require('dotenv').config();

async function checkConRefuerzo() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const ProductFamily = mongoose.model('ProductFamily', new mongoose.Schema({}, { strict: false }));

    // Find "Confeccionada con Refuerzo"
    const conRefuerzo = await ProductFamily.findById('69152f570c0134ee807abe63').lean();

    if (!conRefuerzo) {
      console.log('❌ Confeccionada con Refuerzo not found');
      await mongoose.connection.close();
      return;
    }

    console.log('✅ Found "Confeccionada con Refuerzo"');
    console.log(`   Name: ${conRefuerzo.name}`);
    console.log(`   Generation: ${conRefuerzo.generation}`);
    console.log(`   ParentId: ${conRefuerzo.parentId}`);
    console.log(`   Sellable: ${conRefuerzo.sellable}`);

    // Get all descendants recursively
    const getAllDescendants = async (parentId) => {
      const children = await ProductFamily.find({ parentId }).lean();
      const descendants = [...children];

      for (const child of children) {
        const childDescendants = await getAllDescendants(child._id);
        descendants.push(...childDescendants);
      }

      return descendants;
    };

    const descendants = await getAllDescendants(conRefuerzo._id);
    console.log(`\n📦 Total descendants: ${descendants.length}`);

    if (descendants.length > 0) {
      console.log('\nAll descendants:');
      descendants.forEach(d => {
        console.log(`  - "${d.name}" (Gen ${d.generation}, Sellable: ${d.sellable}, ID: ${d._id})`);
      });
    }

    await mongoose.connection.close();
    console.log('\n✅ Done');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkConRefuerzo();
