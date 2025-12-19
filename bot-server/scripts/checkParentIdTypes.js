const mongoose = require('mongoose');
require('dotenv').config();

async function checkParentIdTypes() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const ProductFamily = mongoose.model('ProductFamily', new mongoose.Schema({}, { strict: false }));

    // Check the types stored in the database
    const triangular = await ProductFamily.findById('691537aa0c0134ee807abf3a').lean();
    const rectangular = await ProductFamily.findById('6942d85ba539ce7f9f28429b').lean();

    console.log('=== TYPE INSPECTION ===\n');
    console.log('Triangular:');
    console.log(`  parentId value: ${triangular.parentId}`);
    console.log(`  parentId type: ${typeof triangular.parentId}`);
    console.log(`  parentId constructor: ${triangular.parentId?.constructor?.name}`);

    console.log('\nRectangular:');
    console.log(`  parentId value: ${rectangular.parentId}`);
    console.log(`  parentId type: ${typeof rectangular.parentId}`);
    console.log(`  parentId constructor: ${rectangular.parentId?.constructor?.name}`);

    // Try different query approaches
    console.log('\n=== QUERY TESTS ===');

    // Test 1: String query
    const test1 = await ProductFamily.find({ parentId: '69152f570c0134ee807abe63' }).lean();
    console.log(`\nString query: Found ${test1.length} results`);

    // Test 2: ObjectId query
    const test2 = await ProductFamily.find({ parentId: mongoose.Types.ObjectId('69152f570c0134ee807abe63') }).lean();
    console.log(`ObjectId query: Found ${test2.length} results`);

    // Test 3: Direct comparison with triangular's parentId
    const test3 = await ProductFamily.find({ parentId: triangular.parentId }).lean();
    console.log(`Direct parentId query: Found ${test3.length} results`);

    if (test3.length > 0) {
      console.log('Sample results:');
      test3.slice(0, 3).forEach(p => {
        console.log(`  - "${p.name}" (Gen ${p.generation})`);
      });
    }

    await mongoose.connection.close();
    console.log('\n✅ Done');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkParentIdTypes();
