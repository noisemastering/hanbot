const mongoose = require('mongoose');
require('dotenv').config();

async function recalculateGenerations() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const ProductFamily = mongoose.model('ProductFamily', new mongoose.Schema({}, { strict: false }));

    console.log('=== RECALCULATING ALL GENERATIONS ===\n');

    // Step 1: Find all root products (parentId = null)
    const roots = await ProductFamily.find({ parentId: null }).lean();
    console.log(`Found ${roots.length} root products\n`);

    let updateCount = 0;

    // Recursive function to update generations
    const updateGenerationsRecursive = async (parentId, expectedGeneration) => {
      const children = await ProductFamily.find({ parentId });

      for (const child of children) {
        if (child.generation !== expectedGeneration) {
          console.log(`Updating "${child.name}" (ID: ${child._id}) from Gen ${child.generation} to Gen ${expectedGeneration}`);

          // Use updateOne to bypass pre-save hook
          await ProductFamily.updateOne(
            { _id: child._id },
            { $set: { generation: expectedGeneration } }
          );
          updateCount++;
        }

        // Recursively update this child's descendants
        await updateGenerationsRecursive(child._id, expectedGeneration + 1);
      }
    };

    // Step 2: Update each root to Gen 1 (if not already)
    for (const root of roots) {
      if (root.generation !== 1 && root.generation !== undefined) {
        console.log(`Updating root "${root.name}" (ID: ${root._id}) from Gen ${root.generation} to Gen 1`);
        await ProductFamily.updateOne(
          { _id: root._id },
          { $set: { generation: 1 } }
        );
        updateCount++;
      } else if (root.generation === undefined) {
        console.log(`Setting root "${root.name}" (ID: ${root._id}) to Gen 1 (was undefined)`);
        await ProductFamily.updateOne(
          { _id: root._id },
          { $set: { generation: 1 } }
        );
        updateCount++;
      }

      // Update all descendants of this root
      await updateGenerationsRecursive(root._id, 2);
    }

    console.log(`\n✅ Updated ${updateCount} products`);

    // Verification: Check "Confeccionada con Refuerzo"
    console.log('\n=== VERIFICATION ===');
    const conRefuerzo = await ProductFamily.findById('69152f570c0134ee807abe63').lean();
    console.log(`"Confeccionada con Refuerzo" is now Gen ${conRefuerzo.generation}`);

    const children = await ProductFamily.find({ parentId: '69152f570c0134ee807abe63' }).lean();
    console.log(`It has ${children.length} direct children`);
    if (children.length > 0) {
      console.log('Sample children:');
      children.slice(0, 3).forEach(c => {
        console.log(`  - "${c.name}" (Gen ${c.generation})`);
      });
    }

    await mongoose.connection.close();
    console.log('\n✅ Done');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

recalculateGenerations();
