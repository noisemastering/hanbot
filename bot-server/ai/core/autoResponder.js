// ai/core/autoResponder.js
const { findFamily } = require("../../familySearch");
const ProductSubfamily = require("../../models/ProductSubfamily");

async function autoResponder(cleanMsg) {
  const family = await findFamily(cleanMsg);
  if (!family) return null;

  const subfamilies = await ProductSubfamily.find({ familyId: family._id }).lean();

  // Detectar intención simple
  if (/precio|cu[aá]nto|vale|costo/.test(cleanMsg)) {
    const prices = subfamilies.map(s => s.priceRange || "por cotizar").join(", ");
    return {
      type: "text",
      text: `Los precios de ${family.name.toLowerCase()} varían según la medida 🌿.\n` +
            `Por ejemplo: ${prices}. ¿Quieres que te muestre las medidas disponibles?`
    };
  }

  if (/medida|dimensiones|tamañ|rollo/.test(cleanMsg)) {
    const medidas = subfamilies.flatMap(s => s.dimensions || []).join(", ");
    return {
      type: "text",
      text: `Estas son las medidas más comunes de ${family.name.toLowerCase()}:\n${medidas}\n` +
            `¿Quieres saber cuál conviene para tu proyecto?`
    };
  }

  if (/invernadero|jard[ií]n|estacionamiento|sombra/.test(cleanMsg)) {
    const usos = family.commonUses?.join(", ") || "invernaderos y jardines";
    return {
      type: "text",
      text: `Perfecto 🌞 la ${family.name.toLowerCase()} es ideal para ${usos}.\n` +
            `¿Deseas ver opciones beige o monofilamento?`
    };
  }

  if (/diferencia|distinto|compar/.test(cleanMsg)) {
    const variantes = subfamilies.map(s => s.name).join(" vs ");
    return {
      type: "text",
      text: `La diferencia principal entre ${variantes} está en el tipo de tejido y resistencia.\n` +
            `¿Quieres que te explique cuál conviene para tu uso?`
    };
  }

  return null;
}

module.exports = { autoResponder };
