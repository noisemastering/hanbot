// mlTokenManager.js
// ⚠️ DEPRECATED: This file will be replaced by the new multi-tenant OAuth system
// ⚠️ Please migrate to: utils/mercadoLibreOAuth.js
// ⚠️ For multi-seller support, use the /ml/oauth endpoints
require("dotenv").config();
const axios = require("axios");

let accessToken = process.env.ML_ACCESS_TOKEN || null;
let refreshToken = process.env.ML_REFRESH_TOKEN || null;
// guardamos el expiry en epoch ms; si no lo sabemos, forzamos refresh en la primera llamada
let accessTokenExpiryMs = 0;

function willExpireSoon() {
  const now = Date.now();
  // refresca 60s antes de expirar
  return !accessToken || now >= (accessTokenExpiryMs - 60_000);
}

async function refreshMLTokenIfNeeded() {
  if (!willExpireSoon()) return accessToken;

  if (!process.env.ML_CLIENT_ID || !process.env.ML_CLIENT_SECRET) {
    throw new Error("Faltan ML_CLIENT_ID/ML_CLIENT_SECRET en el .env");
  }
  if (!refreshToken) {
    throw new Error("No hay ML_REFRESH_TOKEN disponible para refrescar el access token.");
  }

  console.log("🔄 Refrescando token de Mercado Libre...");
  try {
    const resp = await axios.post(
      "https://api.mercadolibre.com/oauth/token",
      new URLSearchParams({
        grant_type: "refresh_token",
        client_id: process.env.ML_CLIENT_ID,
        client_secret: process.env.ML_CLIENT_SECRET,
        refresh_token: refreshToken,
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    accessToken = resp.data.access_token;
    refreshToken = resp.data.refresh_token || refreshToken; // a veces devuelven uno nuevo
    const expiresInSec = resp.data.expires_in ?? 21600; // fallback 6h
    accessTokenExpiryMs = Date.now() + expiresInSec * 1000;

    console.log("✅ Nuevo token obtenido automáticamente");
    return accessToken;
  } catch (err) {
    const payload = err.response?.data || err.message;
    console.error("❌ Error refrescando token de ML:", payload);
    throw err;
  }
}

async function getValidMLToken() {
  // Prefer the DB-stored seller auth (utils/mercadoLibreOAuth) — it holds the
  // CURRENT, self-refreshing token. The env token below rotates out of sync
  // (→ invalid_grant) and must only be a fallback, not the primary source.
  try {
    const { getValidAccessToken } = require("./utils/mercadoLibreOAuth");
    const MercadoLibreAuth = require("./models/MercadoLibreAuth");
    const auth = await MercadoLibreAuth.findOne({ active: true }).select("sellerId").lean();
    const sellerId = auth?.sellerId || process.env.ML_SELLER_ID;
    if (sellerId) {
      const token = await getValidAccessToken(sellerId);
      if (token) return token;
    }
  } catch (e) {
    console.warn("⚠️ DB ML token unavailable, falling back to env token:", e.message);
  }
  // Legacy env-based fallback
  await refreshMLTokenIfNeeded();
  return accessToken;
}

module.exports = {
  getValidMLToken,
  refreshMLTokenIfNeeded, // lo exporto por si lo quieres usar explícitamente
};
