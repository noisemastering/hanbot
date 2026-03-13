// ai/core/autoResponder.js
const { findFamily } = require("../../familySearch");
const ProductSubfamily = require("../../models/ProductSubfamily");

async function autoResponder(cleanMsg) {
  const family = await findFamily(cleanMsg);
  if (!family) return null;

  // 🔴 SKIP if message contains multiple questions (let fallback handle it)
  const multiQuestionIndicators = [
    /\by\s+(si|funciona|repele|tiempo|entrega|pago|forma|cuanto|donde)/i, // "y si funciona"
    /\btambién|además|ademas/i, // también, además
    /\?.*\?/,  // múltiples signos de interrogación
    /,.*\b(y|si|tiempo|entrega|pago|forma)/i // comas seguidas de otras preguntas
  ];

  const isMultiQuestion = multiQuestionIndicators.some(regex => regex.test(cleanMsg));
  if (isMultiQuestion) {
    console.log("⏩ Multi-question detected in autoResponder, skipping to fallback");
    return null; // Let fallback handle it
  }

  const subfamilies = await ProductSubfamily.find({ familyId: family._id }).lean();

  // Detectar intención simple
  if (/precio|cu[aá]nto|vale|costo/.test(cleanMsg)) {
    const prices = subfamilies.map(s => s.priceRange).filter(Boolean);
    const priceText = prices.length <= 3
      ? prices.join(", ")
      : `desde ${prices[0]} hasta ${prices[prices.length - 1]}`;
    return {
      type: "text",
      text: `Los precios de ${family.name.toLowerCase()} varían según la medida.\n` +
            `${priceText ? `Por ejemplo: ${priceText}. ` : ''}¿Qué medida te interesa?`
    };
  }

  if (/medida|dimensiones|tamañ|rollo/.test(cleanMsg)) {
    const medidas = subfamilies.flatMap(s => s.dimensions || []);
    const medidasText = medidas.length <= 3
      ? medidas.join(", ")
      : `desde ${medidas[0]} hasta ${medidas[medidas.length - 1]}`;
    return {
      type: "text",
      text: `Manejamos varias medidas de ${family.name.toLowerCase()}${medidasText ? `: ${medidasText}` : ''}.\n` +
            `¿Qué medida necesitas?`
    };
  }

  if (/invernadero|jard[ií]n|estacionamiento|sombra/.test(cleanMsg)) {
    const usos = family.commonUses?.slice(0, 3).join(", ") || "invernaderos y jardines";
    return {
      type: "text",
      text: `La ${family.name.toLowerCase()} es ideal para ${usos}.\n` +
            `¿Qué medida necesitas?`
    };
  }

  if (/diferencia|distinto|compar/.test(cleanMsg)) {
    const variantes = subfamilies.slice(0, 3).map(s => s.name);
    const varText = variantes.length <= 2 ? variantes.join(" y ") : variantes.slice(0, 2).join(", ") + " y " + variantes[2];
    return {
      type: "text",
      text: `La diferencia principal entre ${varText} está en el tipo de tejido y resistencia.\n` +
            `¿Quieres que te explique cuál conviene para tu uso?`
    };
  }

  return null;
}

module.exports = { autoResponder };
