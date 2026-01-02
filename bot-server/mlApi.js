// ⚠️ DEPRECATED: This file will be replaced by the new multi-tenant OAuth system
// ⚠️ Please migrate to: utils/mercadoLibreOAuth.js
// ⚠️ For multi-seller support, use the /ml/oauth endpoints
require("dotenv").config();
const axios = require("axios");

let accessToken = process.env.ML_ACCESS_TOKEN;
let refreshToken = process.env.ML_REFRESH_TOKEN;

// 🔁 Refresca el token automáticamente si expira
async function refreshAccessToken() {
  try {
    console.log("🔄 Refrescando token de Mercado Libre...");
    const res = await axios.post("https://api.mercadolibre.com/oauth/token", null, {
      params: {
        grant_type: "refresh_token",
        client_id: process.env.ML_APP_ID,
        client_secret: process.env.ML_CLIENT_SECRET,
        refresh_token: refreshToken,
      },
    });

    accessToken = res.data.access_token;
    refreshToken = res.data.refresh_token;

    console.log("✅ Nuevo token obtenido automáticamente");

    // Actualizar variables de entorno en memoria
    process.env.ML_ACCESS_TOKEN = accessToken;
    process.env.ML_REFRESH_TOKEN = refreshToken;

    return accessToken;
  } catch (error) {
    console.error("❌ Error al refrescar token:", error.response?.data || error.message);
    throw error;
  }
}

// 🔍 Obtiene productos (primero local, luego ML)
async function getProductData(query) {
  try {
    console.log(`🧠 Buscando producto en Mercado Libre (vendedor Hanlob): ${query}`);

    // Verifica o renueva token antes de cada llamada
    const token = accessToken;

    // 1️⃣ Obtener el user_id real vinculado al token
    const userRes = await axios.get("https://api.mercadolibre.com/users/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const userId = userRes.data.id;

    // 2️⃣ Buscar productos del vendedor
    const res = await axios.get(
      `https://api.mercadolibre.com/users/${userId}/items/search`,
      {
        params: { q: query, limit: 5 },
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    const results = res.data.results;
    if (!results || results.length === 0) {
      console.warn(`⚠️ No se encontraron productos para: ${query}`);
      return null;
    }

    // 3️⃣ Obtener detalles del primer producto
    const itemId = results[0];
    const detailRes = await axios.get(`https://api.mercadolibre.com/items/${itemId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const p = detailRes.data;
    return {
      name: p.title,
      price: p.price || "Consultar precio",
      permalink: p.permalink,
      imageUrl: p.thumbnail || p.pictures?.[0]?.url,
    };
  } catch (error) {
    if (error.response?.data?.message === "invalid access token") {
      console.warn("⚠️ Token expirado, intentando refrescar...");
      await refreshAccessToken();
      return getProductData(query); // 🔁 Reintenta con el nuevo token
    }

    console.error("❌ Error al obtener datos de producto:", error.response?.data || error.message);
    return null;
  }
}

module.exports = { getProductData };
// Refrescar cada 5 horas automáticamente (tokens duran 6h)
setInterval(refreshAccessToken, 5 * 60 * 60 * 1000);
