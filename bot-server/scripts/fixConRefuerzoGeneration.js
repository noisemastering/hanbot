const mongoose = require('mongoose');
require('dotenv').config();

async function fixGenerations() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const ProductFamily = mongoose.model('ProductFamily', new mongoose.Schema({}, { strict: false }));

    console.log('=== FIXING GENERATION NUMBERS ===\n');

    // Get "Confeccionada con Refuerzo"
    const conRefuerzo = await ProductFamily.findById('69152f570c0134ee807abe63');

    if (!conRefuerzo) {
      console.log('❌ Confeccionada con Refuerzo not found');
      await mongoose.connection.close();
      return;
    }

    console.log(`Found "${conRefuerzo.name}" (current Gen: ${conRefuerzo.generation})`);
    console.log(`Parent: ${conRefuerzo.parentId}`);

    // Verify parent is "90%" which should be Gen 2
    const parent = await ProductFamily.findById(conRefuerzo.parentId);
    console.log(`Parent "${parent.name}" is Gen ${parent.generation}`);

    if (parent.generation !== 2) {
      console.log('⚠️  Warning: Parent is not Gen 2! Expected structure may be different.');
    }

    // Update "Confeccionada con Refuerzo" to Gen 3
    console.log('\n1. Updating "Confeccionada con Refuerzo" from Gen 2 to Gen 3...');
    conRefuerzo.generation = 3;
    await conRefuerzo.save();
    console.log('   ✅ Updated to Gen 3');

    // Recursively update all descendants
    const updateDescendantsGeneration = async (parentId, expectedGen) => {
      const children = await ProductFamily.find({ parentId });

      for (const child of children) {
        if (child.generation !== expectedGen) {
          console.log(`   Updating "${child.name}" from Gen ${child.generation} to Gen ${expectedGen}`);
          child.generation = expectedGen;
          await child.save();
        }

        // Recursively update this child's descendants
        await updateDescendantsGeneration(child._id, expectedGen + 1);
      }
    };

    console.log('\n2. Updating all descendants...');
    await updateDescendantsGeneration(conRefuerzo._id, 4);
    console.log('   ✅ All descendants updated');

    // Verify the fix
    console.log('\n=== VERIFICATION ===');
    const updated = await ProductFamily.findById('69152f570c0134ee807abe63');
    console.log(`"${updated.name}" is now Gen ${updated.generation}`);

    const sampleChild = await ProductFamily.findOne({ parentId: updated._id });
    if (sampleChild) {
      console.log(`Sample child "${sampleChild.name}" is Gen ${sampleChild.generation}`);
    }

    console.log('\n✅ Generation fix complete');
    await mongoose.connection.close();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

fixGenerations();
