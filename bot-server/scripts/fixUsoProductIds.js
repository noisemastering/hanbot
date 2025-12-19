// Script to fix existing Usos/Grupos that have product IDs stored as strings
const mongoose = require('mongoose');
require('dotenv').config();

const Uso = require('../models/Uso');
const Grupo = require('../models/Grupo');

async function fixProductIds() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Fix Usos
    const usos = await Uso.find({});
    console.log(`Found ${usos.length} Usos to check`);

    let usosFixed = 0;
    for (const uso of usos) {
      let needsUpdate = false;

      // Convert products array
      if (uso.products && Array.isArray(uso.products)) {
        const fixedProducts = uso.products.map(id => {
          if (typeof id === 'string') {
            needsUpdate = true;
            return new mongoose.Types.ObjectId(id);
          }
          return id;
        });

        if (needsUpdate) {
          uso.products = fixedProducts;
        }
      }

      if (needsUpdate) {
        await uso.save();
        usosFixed++;
        console.log(`✅ Fixed Uso: ${uso.name}`);
      }
    }

    // Fix Grupos
    const grupos = await Grupo.find({});
    console.log(`Found ${grupos.length} Grupos to check`);

    let gruposFixed = 0;
    for (const grupo of grupos) {
      let needsUpdate = false;

      // Convert products array
      if (grupo.products && Array.isArray(grupo.products)) {
        const fixedProducts = grupo.products.map(id => {
          if (typeof id === 'string') {
            needsUpdate = true;
            return new mongoose.Types.ObjectId(id);
          }
          return id;
        });

        if (needsUpdate) {
          grupo.products = fixedProducts;
        }
      }

      // Convert suggestedProducts array
      if (grupo.suggestedProducts && Array.isArray(grupo.suggestedProducts)) {
        const fixedSuggestedProducts = grupo.suggestedProducts.map(id => {
          if (typeof id === 'string') {
            needsUpdate = true;
            return new mongoose.Types.ObjectId(id);
          }
          return id;
        });

        if (needsUpdate) {
          grupo.suggestedProducts = fixedSuggestedProducts;
        }
      }

      if (needsUpdate) {
        await grupo.save();
        gruposFixed++;
        console.log(`✅ Fixed Grupo: ${grupo.name}`);
      }
    }

    console.log(`\n✅ Migration complete!`);
    console.log(`   Usos fixed: ${usosFixed}/${usos.length}`);
    console.log(`   Grupos fixed: ${gruposFixed}/${grupos.length}`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

fixProductIds();
