// familySearch.js
const ProductFamily = require("./models/ProductFamily");

async function findFamily(query) {
  try {
    const q = query.toLowerCase();
    const families = await ProductFamily.find({ active: true }).lean();

    // Busca coincidencia parcial en nombre o descripción
    const match = families.find(f =>
      q.includes(f.name.toLowerCase()) ||
      f.description?.toLowerCase().includes(q)
    );

    if (!match) return null;

    // Contar si tiene productos vendibles asociados (children that are sellable)
    const sellableCount = await ProductFamily.countDocuments({
      parentId: match._id,
      sellable: true,
      active: true
    });

    return {
      name: match.name,
      active: match.active,
      hasProducts: sellableCount > 0,
      description: match.description,
    };
  } catch (err) {
    console.error("❌ Error buscando familia:", err);
    return null;
  }
}

module.exports = { findFamily };
