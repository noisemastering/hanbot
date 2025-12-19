const mongoose = require('mongoose');
require('dotenv').config();

async function deleteDuplicates() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const ProductFamily = mongoose.model('ProductFamily', new mongoose.Schema({}, { strict: false }));

    console.log('=== DELETING DUPLICATE ENTRIES ===\n');

    // Duplicate 1: "4 m x 3 m" under Confeccionada con Refuerzo / Rectangular
    // Keep: 694314b6ed2d4185ba470850
    // Delete: 69433793ed2d4185ba4723c2
    console.log('1. Deleting duplicate "4 m x 3 m" (ID: 69433793ed2d4185ba4723c2)...');
    const result1 = await ProductFamily.findByIdAndDelete('69433793ed2d4185ba4723c2');
    if (result1) {
      console.log('   ✅ Deleted:', result1.name);
    } else {
      console.log('   ⚠️  Not found (may have been already deleted)');
    }

    // Duplicate 2: "3 m x 10 m" under Confeccionada sin Refuerzo / Rectangular
    // Keep: 694349eced2d4185ba47711b
    // Delete: 69434a23ed2d4185ba4777db
    console.log('\n2. Deleting duplicate "3 m x 10 m" (ID: 69434a23ed2d4185ba4777db)...');
    const result2 = await ProductFamily.findByIdAndDelete('69434a23ed2d4185ba4777db');
    if (result2) {
      console.log('   ✅ Deleted:', result2.name);
    } else {
      console.log('   ⚠️  Not found (may have been already deleted)');
    }

    console.log('\n✅ Duplicate deletion complete');
    await mongoose.connection.close();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

deleteDuplicates();
