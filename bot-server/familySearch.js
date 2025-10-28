// familySearch.js
const ProductFamily = require("./models/ProductFamily");
const Product = require("./models/Product");

async function findFamily(query) {
  try {
    const q = query.toLowerCase();
    const families = await ProductFamily.find({}).lean();

    // Busca coincidencia parcial en nombre o descripción
    const match = families.find(f =>
      q.includes(f.name.toLowerCase()) ||
      f.description?.toLowerCase().includes(q)
    );

    if (!match) return null;

    // Contar si tiene productos asociados
    const productCount = await Product.countDocuments({ familyId: match._id });

    return {
      name: match.name,
      active: match.active,
      hasProducts: productCount > 0,
      description: match.description,
    };
  } catch (err) {
    console.error("❌ Error buscando familia:", err);
    return null;
  }
}

module.exports = { findFamily };
