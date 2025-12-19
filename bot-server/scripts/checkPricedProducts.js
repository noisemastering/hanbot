const mongoose = require('mongoose');
require('dotenv').config();

async function checkPricedProducts() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const ProductFamily = mongoose.model('ProductFamily', new mongoose.Schema({}, { strict: false }));

    // Check all Gen 1 categories
    const gen1Products = await ProductFamily.find({ generation: 1 }).sort({ name: 1 });
    console.log('\n=== Gen 1 Categories ===');
    gen1Products.forEach(p => {
      console.log(`- ${p.name} (ID: ${p._id})`);
    });

    // Check for Raschel specifically
    console.log('\n=== Searching for Raschel ===');
    const raschel = await ProductFamily.findOne({ name: { $regex: /raschel/i } });
    if (raschel) {
      console.log(`Found: ${raschel.name} (Gen ${raschel.generation})`);
      console.log(`ID: ${raschel._id}`);
      console.log(`ParentId: ${raschel.parentId}`);

      // Find all descendants
      const children = await ProductFamily.find({ parentId: raschel._id });
      console.log(`\nDirect children: ${children.length}`);

      // Check for products with prices under Raschel
      const withPrice = await ProductFamily.find({
        parentId: raschel._id,
        $or: [
          { price: { $exists: true, $ne: null } },
          { wholesalePrice: { $exists: true, $ne: null } }
        ]
      });
      console.log(`Children with prices: ${withPrice.length}`);
    } else {
      console.log('Raschel not found');
    }

    // Check all products with prices
    console.log('\n=== All Products with Prices ===');
    const allWithPrices = await ProductFamily.find({
      $or: [
        { price: { $exists: true, $ne: null } },
        { wholesalePrice: { $exists: true, $ne: null } }
      ]
    }).sort({ generation: 1, name: 1 });

    console.log(`Total products with prices: ${allWithPrices.length}\n`);

    // Group by generation
    const byGen = {};
    allWithPrices.forEach(p => {
      if (!byGen[p.generation]) byGen[p.generation] = [];
      byGen[p.generation].push(p);
    });

    Object.keys(byGen).sort().forEach(gen => {
      console.log(`\nGeneration ${gen}: ${byGen[gen].length} products`);
      byGen[gen].slice(0, 5).forEach(p => {
        console.log(`  - ${p.name} (price: ${p.price}, wholesale: ${p.wholesalePrice})`);
      });
      if (byGen[gen].length > 5) {
        console.log(`  ... and ${byGen[gen].length - 5} more`);
      }
    });

    await mongoose.connection.close();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkPricedProducts();
