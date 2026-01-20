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

      // Only get ROOT-LEVEL categories (parentId: null), not every product variant
      const rootFamilies = await ProductFamily.find({
        active: true,
        parentId: null
      }).lean();

      if (!rootFamilies || rootFamilies.length === 0) {
        await updateConversation(psid, { lastIntent: "catalog_overview" });
        return { type: "text", text: `En este momento no tengo productos registrados, pero pronto actualizaremos nuestro catálogo.` };
      }

      // Format nicely: "Malla Sombra, Malla Antiáfido y Cinta Plástica"
      let familyNames;
      if (rootFamilies.length === 1) {
        familyNames = rootFamilies[0].name;
      } else if (rootFamilies.length === 2) {
        familyNames = rootFamilies.map(f => f.name).join(" y ");
      } else {
        const lastFamily = rootFamilies.pop();
        familyNames = rootFamilies.map(f => f.name).join(", ") + " y " + lastFamily.name;
      }

      await updateConversation(psid, { lastIntent: "catalog_overview" });
      return {
        type: "text",
        text: `Manejamos ${familyNames}. ¿Qué producto te interesa?`
      };
    }
    return null;
  } catch (error) {
    console.error("❌ Error in handleCatalogOverview:", error);
    await updateConversation(psid, { lastIntent: "catalog_overview" });
    return {
      type: "text",
      text: `Manejamos malla sombra en diferentes medidas y colores. ¿Qué medida necesitas?`
    };
  }
}

module.exports = { handleCatalogOverview };
