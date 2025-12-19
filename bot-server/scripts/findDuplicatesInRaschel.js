const mongoose = require('mongoose');
require('dotenv').config();

async function findDuplicates() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const ProductFamily = mongoose.model('ProductFamily', new mongoose.Schema({}, { strict: false }));

    // Find "Malla Sombra Raschel" root
    const raschel = await ProductFamily.findOne({
      name: 'Malla Sombra Raschel',
      parentId: null
    }).lean();

    if (!raschel) {
      console.log('❌ Malla Sombra Raschel not found');
      await mongoose.connection.close();
      return;
    }

    console.log(`✅ Found Malla Sombra Raschel (ID: ${raschel._id})`);

    // Find 90% subcategory
    const ninety = await ProductFamily.findOne({
      name: '90%',
      parentId: raschel._id
    }).lean();

    if (!ninety) {
      console.log('❌ 90% subcategory not found');
      await mongoose.connection.close();
      return;
    }

    console.log(`✅ Found 90% subcategory (ID: ${ninety._id})`);

    // Get all descendants under 90%
    const getAllDescendants = async (parentId) => {
      const children = await ProductFamily.find({ parentId }).lean();
      const descendants = [...children];

      for (const child of children) {
        const childDescendants = await getAllDescendants(child._id);
        descendants.push(...childDescendants);
      }

      return descendants;
    };

    const allProducts = await getAllDescendants(ninety._id);
    console.log(`\n📦 Total products under Malla Sombra Raschel / 90%: ${allProducts.length}`);

    // Build displayName for each product
    const buildDisplayName = async (product) => {
      const hierarchy = [];
      let current = product;

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

      const displayParts = hierarchy
        .filter(h => h.generation >= 3)
        .map(h => h.name);

      return displayParts.length > 0 ? displayParts.join(' - ') : product.name;
    };

    // Build map of displayName -> products
    const nameMap = {};
    for (const product of allProducts) {
      const displayName = await buildDisplayName(product);
      if (!nameMap[displayName]) {
        nameMap[displayName] = [];
      }
      nameMap[displayName].push({
        id: product._id.toString(),
        name: product.name,
        generation: product.generation,
        parentId: product.parentId?.toString()
      });
    }

    // Find duplicates
    console.log('\n=== CHECKING FOR DUPLICATES ===');
    const duplicates = Object.entries(nameMap).filter(([_, products]) => products.length > 1);

    if (duplicates.length === 0) {
      console.log('✅ No duplicates found!');
    } else {
      console.log(`⚠️  Found ${duplicates.length} duplicate displayName(s):`);
      duplicates.forEach(([displayName, products]) => {
        console.log(`\n"${displayName}" appears ${products.length} times:`);
        products.forEach(p => {
          console.log(`  - ID: ${p.id}, Name: "${p.name}", Gen: ${p.generation}`);
        });
      });
    }

    // Check for "Confeccionada con Refuerzo" and "Confeccionada sin Refuerzo"
    console.log('\n=== CHECKING FOR SPECIFIC PRODUCTS ===');

    const conRefuerzo = allProducts.filter(p => p.name.includes('Confeccionada con Refuerzo'));
    const sinRefuerzo = allProducts.filter(p => p.name.includes('Confeccionada sin Refuerzo'));

    console.log(`\n"Confeccionada con Refuerzo" products: ${conRefuerzo.length}`);
    conRefuerzo.forEach(p => {
      console.log(`  - "${p.name}" (Gen ${p.generation}, ID: ${p._id})`);
    });

    console.log(`\n"Confeccionada sin Refuerzo" products: ${sinRefuerzo.length}`);
    sinRefuerzo.forEach(p => {
      console.log(`  - "${p.name}" (Gen ${p.generation}, ID: ${p._id})`);
    });

    // Check for the specific duplicate mentioned
    console.log('\n=== CHECKING SPECIFIC DUPLICATE ===');
    const rectangular3x10 = Object.entries(nameMap).find(([name, _]) =>
      name.includes('Confeccionada sin Refuerzo') &&
      name.includes('Rectangular') &&
      name.includes('3 m x 10 m')
    );

    if (rectangular3x10) {
      const [displayName, products] = rectangular3x10;
      console.log(`"${displayName}":`);
      products.forEach(p => {
        console.log(`  - ID: ${p.id}, Name: "${p.name}", Gen: ${p.generation}`);
      });
      if (products.length > 1) {
        console.log(`  ⚠️  DUPLICATE CONFIRMED! ${products.length} entries with same displayName`);
      }
    }

    await mongoose.connection.close();
    console.log('\n✅ Done');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

findDuplicates();
