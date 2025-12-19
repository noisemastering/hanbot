const fetch = require('node-fetch');

async function checkDuplicates() {
  try {
    const response = await fetch('http://localhost:3000/product-families/sellable');
    const json = await response.json();

    const products = json.data.filter(p =>
      p.category === 'Malla Sombra Raschel' && p.subcategory === '90%'
    );

    console.log('Total products in Malla Sombra Raschel / 90%:', products.length);
    console.log('\nAll products:');

    const names = {};
    products.forEach(p => {
      const name = p.displayName || p.name;
      if (!names[name]) names[name] = [];
      names[name].push({
        id: p._id,
        generation: p.generation,
        name: p.name
      });
    });

    // Show all products
    Object.keys(names).sort().forEach(displayName => {
      const entries = names[displayName];
      console.log(`\n${displayName}:`);
      entries.forEach(e => {
        console.log(`  - ID: ${e.id}, Gen: ${e.generation}, Name: ${e.name}`);
      });
      if (entries.length > 1) {
        console.log(`  ⚠️  DUPLICATE! (${entries.length} entries)`);
      }
    });

  } catch (error) {
    console.error('Error:', error);
  }
}

checkDuplicates();
