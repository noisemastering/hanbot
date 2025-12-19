const mongoose = require('mongoose');
require('dotenv').config();

async function checkMissing() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const ProductFamily = mongoose.model('ProductFamily', new mongoose.Schema({}, { strict: false }));

    // Get ALL products from database
    const all = await ProductFamily.find({}).lean();
    console.log(`Total products in database: ${all.length}`);

    // Find the old Raschel
    const raschel = await ProductFamily.findById('68f6c372bfaca6a28884afd7');
    console.log(`\nMalla Sombra Raschel exists: ${!!raschel}`);

    if (raschel) {
      // Find its children
      const children = await ProductFamily.find({ parentId: '68f6c372bfaca6a28884afd7' }).lean();
      console.log(`Children: ${children.length}`);

      children.forEach(child => {
        console.log(`  - ${child.name} (Gen ${child.generation}, ID: ${child._id})`);
      });

      // Check if these IDs are in the "all" array
      console.log(`\n Checking if children are in full product list...`);
      children.forEach(child => {
        const found = all.find(p => p._id.toString() === child._id.toString());
        console.log(`  - ${child.name}: ${found ? 'FOUND in list' : 'NOT FOUND'}`);
      });
    }

    await mongoose.connection.close();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkMissing();
