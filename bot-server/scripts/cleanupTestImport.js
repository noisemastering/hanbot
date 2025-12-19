const mongoose = require('mongoose');
require('dotenv').config();

async function cleanup() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const ProductFamily = mongoose.model('ProductFamily', new mongoose.Schema({}, { strict: false }));

    // Find Rectangular
    const rectangular = await ProductFamily.findOne({ name: { $regex: 'rectangular', $options: 'i' } });

    // Delete all children of Rectangular
    const result = await ProductFamily.deleteMany({ parentId: rectangular._id });

    console.log(`Deleted ${result.deletedCount} children from Rectangular`);

    // Verify
    const children = await ProductFamily.find({ parentId: rectangular._id });
    console.log(`Rectangular now has ${children.length} children`);

    await mongoose.connection.close();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

cleanup();
