// hybridSearch.js
require("dotenv").config();
const axios = require("axios");
const ProductFamily = require("./models/ProductFamily");
const { getValidMLToken } = require("./mlTokenManager");


async function findProductFamily(query) {
  const rx = buildLooseRegex(query);
  if (!rx) return null;

  const fam = await ProductFamily.findOne({
    $or: [
      { name: rx },
      { keywords: rx },
      { description: rx }
    ]
  }).lean();

  if (!fam) return null;

  return {
    name: fam.name,
    description: fam.description,
    features: fam.features,
    commonUses: fam.commonUses,
    imageUrl: fam.imageUrl
  };
}


function buildLooseRegex(query) {
  if (!query) return null;

  const q = query.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const genericIntents = [
    "que productos tienes",
    "que productos manejas",
    "que vendes",
    "que tienes",
    "cuales productos tienes",
    "que productos ofreces",
    "muestras tus productos",
    "productos?"
  ];

  // Si el usuario solo está preguntando por productos, no hagas regex; deja que use el catálogo genérico
  if (genericIntents.some(p => q.includes(p))) {
    console.log("🧠 Consulta genérica detectada, usando búsqueda general de catálogo.");
    return null;
  }

  // Palabras de relleno
  const stopWords = [
    "tienes", "hay", "quiero", "busco", "vendes", "me", "puedes",
    "una", "un", "de", "el", "la", "los", "las", "por", "para", "con", "en"
  ];

  const words = q.split(/\s+/).filter(w => w.length > 2 && !stopWords.includes(w));

  if (words.length === 0) return null;

  const pattern = words.join(".*");
  return new RegExp(pattern, "i");
}



async function findLocalProduct(query) {
  try {
    const rx = buildLooseRegex(query);
    if (!rx) {
      console.log("⚠️ Regex no válido para query:", query);
      return null;
    }

    console.log("🔍 Ejecutando búsqueda local en ProductFamily con regex:", rx);
    // 🚫 Evita búsquedas genéricas como "invernadero", "jardín", "huerto"
    const genericContexts = ["invernadero", "jardin", "jardín", "huerto", "plantas"];
    if (genericContexts.some(ctx => query.toLowerCase().includes(ctx))) {
      console.log("⚠️ Consulta genérica de contexto detectada, sin coincidencia directa de producto.");
      return null;
    }

    // Search in ProductFamily for sellable, active products with price
    const docs = await ProductFamily.find({
      sellable: true,
      active: true,
      price: { $exists: true, $gt: 0 },
      $or: [
        { name: rx },
        { description: rx },
        { marketingDescription: rx },
      ],
    }).lean().exec();

    console.log(`📦 Resultados encontrados en ProductFamily (${docs.length}):`);
    docs.forEach((d, i) => console.log(`   [${i + 1}] ${d.name} - $${d.price}`));

    if (!docs || docs.length === 0) {
      console.log("⚠️ Sin coincidencias locales para:", query);
      return null;
    }

    const colorKeywords = ["negra", "beige", "verde", "blanca", "azul"];
    const mentionedColor = colorKeywords.find(c => query.toLowerCase().includes(c));
    let bestMatch = docs[0];

    if (mentionedColor) {
      const filtered = docs.filter(d =>
        d.name?.toLowerCase().includes(mentionedColor) ||
        d.description?.toLowerCase().includes(mentionedColor)
      );
      if (filtered.length > 0) {
        bestMatch = filtered[0];
        console.log(`🎯 Coincidencia exacta encontrada por color "${mentionedColor}": ${bestMatch.name}`);
      } else {
        console.log(`⚠️ No se encontró coincidencia exacta para color "${mentionedColor}", usando genérico.`);
      }
    }

    // Get preferred link from onlineStoreLinks
    const preferredLink = bestMatch.onlineStoreLinks?.find(l => l.isPreferred)?.url ||
                         bestMatch.onlineStoreLinks?.[0]?.url || "";

    return {
        name: bestMatch.name,
        price: bestMatch.price || "Consultar precio",
        permalink: preferredLink,
        imageUrl: bestMatch.imageUrl || bestMatch.thumbnail || "",
        source: "inventario",
        isFromML: false
    };
  } catch (err) {
    console.error("❌ Error buscando en ProductFamily:", err.message || err);
    return null;
  }
}

async function findMLProduct(query) {
  try {
    const token = await getValidMLToken();

    // 1) Obtener user_id del token autorizado (el vendedor correcto)
    const me = await axios.get("https://api.mercadolibre.com/users/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const userId = me.data.id;

    // 2) Buscar items de ese vendedor
    const list = await axios.get(
      `https://api.mercadolibre.com/users/${userId}/items/search`,
      {
        params: { q: query || "malla sombra", limit: 5 },
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    const results = list.data.results;
    if (!Array.isArray(results) || results.length === 0) return null;

    // Toma el primero (o podrías aplicar scoring/filtrado adicional)
    const itemId = results[0];

    // 3) Detalles del ítem
    const detail = await axios.get(
      `https://api.mercadolibre.com/items/${itemId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const p = detail.data;
    return {
        name: p.title,
        price: p.price || "Consultar precio",
        permalink: p.permalink,
        imageUrl: p.thumbnail || (p.pictures && p.pictures[0]?.url) || "",
        source: "ml",
        isFromML: true
        };

  } catch (err) {
    const payload = err.response?.data || err.message;
    console.error("❌ Error buscando en Mercado Libre:", payload);
    return null;
  }
}

/**
 * Búsqueda híbrida:
 * 1) Intenta en Mongo (catálogo local)
 * 2) Si no hay, intenta en Mercado Libre del vendedor autenticado
 * 3) Si no hay, intenta un fallback general "malla sombra" (opcional)
 */
async function getProduct(query) {
  console.log(`🧠 Buscando producto localmente: "${query}"`);
  let product = await findLocalProduct(query);
  if (product) return product;

  console.log(`🔁 No encontrado en MongoDB, buscando en Mercado Libre: ${query}`);
  product = await findMLProduct(query);
  if (product) return product;

  console.warn(`⚠️ No se encontraron resultados para: ${query}`);

  // Fallback final a algo genérico (evita loops infinitos)
  if ((query || "").toLowerCase() !== "malla sombra") {
    product = await findLocalProduct("malla sombra");
    if (product) return product;

    product = await findMLProduct("malla sombra");
    if (product) return product;
  }

  return null;
}

module.exports = { getProduct, findProductFamily };
