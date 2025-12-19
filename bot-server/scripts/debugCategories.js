const mongoose = require('mongoose');
require('dotenv').config();

async function debugCategories() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const ProductFamily = mongoose.model('ProductFamily', new mongoose.Schema({}, { strict: false }));

    // Get the old Raschel
    const raschelOld = await ProductFamily.findById('68f6c372bfaca6a28884afd7');
    console.log('\n=== Malla Sombra Raschel (old) ===');
    console.log(`Name: ${raschelOld.name}`);
    console.log(`Generation: ${raschelOld.generation}`);
    console.log(`ParentId: ${raschelOld.parentId}`);

    // Get its children
    const children = await ProductFamily.find({ parentId: raschelOld._id }).lean();
    console.log(`\nDirect children: ${children.length}`);

    if (children.length > 0) {
      console.log('\nFirst 5 children:');
      children.slice(0, 5).forEach(child => {
        console.log(`  - ${child.name} (Gen ${child.generation})`);
      });

      // Now simulate what buildHierarchicalName would return for the first child
      console.log('\n=== Simulating buildHierarchicalName for first child ===');
      const firstChild = children[0];

      // Build hierarchy
      const hierarchy = [];
      let current = firstChild;

      while (current) {
        hierarchy.unshift({
          name: current.name,
          generation: current.generation
        });

        if (current.parentId) {
          current = await ProductFamily.findById(current.parentId).lean();
        } else {
          current = null;
        }
      }

      console.log('Hierarchy:', hierarchy.map(h => `${h.name} (Gen ${h.generation})`).join(' → '));

      // Extract category (Gen 1)
      const category = hierarchy.find(h => h.generation === 1)?.name || null;
      const subcategory = hierarchy.find(h => h.generation === 2)?.name || null;

      console.log(`\nCategory (Gen 1): ${category}`);
      console.log(`Subcategory (Gen 2): ${subcategory}`);
      console.log(`\n⚠️  Category is ${category ? 'SET' : 'NULL'} - this is why products ${category ? 'WILL' : 'WON\'T'} show up in tabs!`);
    }

    await mongoose.connection.close();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

debugCategories();
