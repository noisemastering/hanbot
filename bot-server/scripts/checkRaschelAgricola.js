const mongoose = require('mongoose');
require('dotenv').config();

async function checkRaschelAgricola() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const ProductFamily = mongoose.model('ProductFamily', new mongoose.Schema({}, { strict: false }));

    // Get the proper Gen 1 Raschel
    const raschelAgricola = await ProductFamily.findById('693990956a5f32d1d58dbd5b');
    console.log('\n=== Malla Sombra Raschel Agrícola ===');
    console.log(`Name: ${raschelAgricola.name}`);
    console.log(`Generation: ${raschelAgricola.generation}`);
    console.log(`ParentId: ${raschelAgricola.parentId}`);

    // Find all descendants (recursive search)
    async function findAllDescendants(parentId, level = 1) {
      const children = await ProductFamily.find({ parentId }).lean();
      let allDescendants = [...children];

      for (const child of children) {
        const grandchildren = await findAllDescendants(child._id, level + 1);
        allDescendants = [...allDescendants, ...grandchildren];
      }

      return allDescendants;
    }

    const allDescendants = await findAllDescendants(raschelAgricola._id);
    console.log(`\nTotal descendants: ${allDescendants.length}`);

    // Group by generation
    const byGen = {};
    allDescendants.forEach(d => {
      if (!byGen[d.generation]) byGen[d.generation] = [];
      byGen[d.generation].push(d);
    });

    console.log('\nDescendants by generation:');
    Object.keys(byGen).sort().forEach(gen => {
      console.log(`  Gen ${gen}: ${byGen[gen].length} products`);
    });

    // Check which have prices
    const withPrices = allDescendants.filter(d =>
      (d.price !== null && d.price !== undefined) ||
      (d.wholesalePrice !== null && d.wholesalePrice !== undefined)
    );

    console.log(`\nDescendants with prices: ${withPrices.length}`);

    if (withPrices.length > 0) {
      console.log('\nSample products with prices:');
      withPrices.slice(0, 10).forEach(p => {
        console.log(`  - ${p.name} (Gen ${p.generation}): price=${p.price}, wholesale=${p.wholesalePrice}`);
      });
    } else {
      console.log('\n⚠️  NO descendants have prices set!');
      console.log('\nFirst 10 descendants (showing they have no prices):');
      allDescendants.slice(0, 10).forEach(p => {
        console.log(`  - ${p.name} (Gen ${p.generation}): price=${p.price}, wholesale=${p.wholesalePrice}`);
      });
    }

    await mongoose.connection.close();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkRaschelAgricola();
