// ai/core/catalog.js
const { updateConversation } = require("../../conversationManager");
const ProductFamily = require("../../models/ProductFamily");
const ProductSubfamily = require("../../models/ProductSubfamily");

async function handleCatalogOverview(cleanMsg, psid) {
  try {
    if (
      /\b(que|qué)\b.*\b(prod(uctos|utos)|vendes|manej(a|an)|tienes|ofreces|cat[aá]logo|disponibles|manej[aá]is)\b/i.test(cleanMsg)
      || /\b(cat[aá]logo|productos disponibles|qué vendes|qué manejas)\b/i.test(cleanMsg)
    ) {
      console.log("📋 Catalog overview requested");

      const families = await ProductFamily.find({ active: true }).lean();
      if (!families || families.length === 0) {
        await updateConversation(psid, { lastIntent: "catalog_overview" });
        return { type: "text", text: `En este momento no tengo productos registrados 😔, pero pronto actualizaremos nuestro catálogo.` };
      }

      const familyNames = families.map(f => f.name).join(" y ");
      const subfamilies = await ProductSubfamily.find({ available: true }).lean();
      const mallaFamily = families.find(f => f.name && f.name.toLowerCase().includes("malla sombra"));
      let mallaSubs = "";

      if (mallaFamily) {
        const relatedSubs = subfamilies.filter(s => s.familyId && mallaFamily._id && s.familyId.toString() === mallaFamily._id.toString());
        if (relatedSubs.length > 0) {
          mallaSubs = relatedSubs.map(s => s.name).join(" y ");
        }
      }

      await updateConversation(psid, { lastIntent: "catalog_overview" });
      return {
        type: "text",
        text:
          `En Hanlob manejamos actualmente ${familyNames.toLowerCase()} 🌿.\n` +
          (mallaSubs ? `La malla sombra está disponible en versiones ${mallaSubs}.\n` : "") +
          `¿Quieres que te muestre algunas opciones o precios?`
      };
    }
    return null;
  } catch (error) {
    console.error("❌ Error in handleCatalogOverview:", error);
    // Return a fallback response instead of throwing
    await updateConversation(psid, { lastIntent: "catalog_overview" });
    return {
      type: "text",
      text: `Manejo malla sombra en diferentes medidas y colores 🌿\n\n¿Qué medida necesitas o quieres ver el catálogo completo?`
    };
  }
}

module.exports = { handleCatalogOverview };
