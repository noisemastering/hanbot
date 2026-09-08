// ai/marketplace/index.js
//
// The MARKETPLACE LAYER. A "point of sale" (PointOfSale doc) is a place a customer
// can buy. Each POS declares a `kind` that selects a price ADAPTER:
//   - 'mercadolibre'   → live ML price via mlPriceLookup (the historical core).
//   - 'http_price_api' → the POS's own price endpoint (the price-API contract).
//
// The company's CORE store is the PointOfSale with `isDefault:true` — interchangeable
// (flip the flag to move the core store). Every product quotes/links/prices against
// the default POS UNLESS a campaign routes specific products to an ALTERNATE POS
// (Ad.workflowSetup.altMarketplace). Only price/refund/delivery come from the
// alternate; everything else stays on the default channel + existing flows.
const axios = require("axios");
const { getMLPrice } = require("../utils/mlPriceLookup");

let PointOfSale;
function posModel() {
  if (!PointOfSale) PointOfSale = require("../../models/PointOfSale");
  return PointOfSale;
}

// Small caches (POS config changes rarely; avoid a DB hit per turn).
const CACHE_TTL = 5 * 60 * 1000;
let _defaultCache = { at: 0, pos: null };
const _byIdCache = new Map(); // id -> { at, pos }

function isMlPos(pos) {
  return !pos || pos.kind === "mercadolibre" || /mercado\s*libre|mercadolibre/i.test(pos.name || "");
}

// The company's core store. Prefer the explicit isDefault flag; fall back to a
// Mercado Libre POS by name, then any active POS. null if none configured.
async function getDefaultPos() {
  if (Date.now() - _defaultCache.at < CACHE_TTL) return _defaultCache.pos;
  let pos = null;
  try {
    const M = posModel();
    pos =
      (await M.findOne({ isDefault: true, active: true }).lean()) ||
      (await M.findOne({ active: true, name: /mercado\s*libre|mercadolibre/i }).lean()) ||
      (await M.findOne({ active: true }).lean());
  } catch (err) {
    console.error("⚠️ [marketplace] getDefaultPos failed:", err.message);
  }
  _defaultCache = { at: Date.now(), pos };
  return pos;
}

async function getPosById(id) {
  if (!id) return null;
  const key = String(id);
  const c = _byIdCache.get(key);
  if (c && Date.now() - c.at < CACHE_TTL) return c.pos;
  let pos = null;
  try {
    pos = await posModel().findById(key).lean();
  } catch (err) {
    console.error("⚠️ [marketplace] getPosById failed:", err.message);
  }
  _byIdCache.set(key, { at: Date.now(), pos });
  return pos;
}

// Clears the caches (call after editing POS config so the engine picks it up).
function clearPosCache() {
  _defaultCache = { at: 0, pos: null };
  _byIdCache.clear();
}

// The onlineStoreLink that belongs to a given POS: prefer an explicit posId match,
// else match the link's `store` label to the POS name (case-insensitive), and for
// Mercado Libre also accept any mercadolibre URL. Returns { url, sku } or null.
function linkForPos(product, pos) {
  const links = product?.onlineStoreLinks || [];
  if (!links.length) return null;
  const posId = pos?._id ? String(pos._id) : null;
  const name = (pos?.name || "").trim().toLowerCase();

  let hit =
    (posId && links.find((l) => l?.posId && String(l.posId) === posId)) ||
    (name && links.find((l) => (l?.store || "").trim().toLowerCase() === name));
  if (!hit && isMlPos(pos)) {
    hit = links.find((l) => l?.url && /mercadolibre/i.test(l.url));
  }
  if (!hit) return null;
  return { url: hit.url || null, sku: hit.sku || null };
}

// ── Price adapters ──────────────────────────────────────────────────────────
// Common shape: { available, price, originalPrice, hasDiscount, discountPercent,
//                 currency, taxIncluded, source, fetchFailed }
// available:false → not quotable via this POS (sold out / no price / unreachable);
// callers must hand off, NEVER invent a price.

async function mlAdapter({ link, dbPrice }) {
  if (!link) return { available: false, source: "ml", fetchFailed: false };
  try {
    const r = await getMLPrice(link, dbPrice);
    if (r && r.source === "ml" && Number(r.price) > 0) {
      return {
        available: true,
        price: Number(r.price),
        originalPrice: r.originalPrice || null,
        hasDiscount: !!r.hasDiscount,
        discountPercent: r.discountPercent || 0,
        currency: "MXN",
        taxIncluded: true,
        source: "ml",
      };
    }
    return { available: false, source: "ml", fetchFailed: !!r?.fetchFailed };
  } catch (err) {
    return { available: false, source: "ml", fetchFailed: true, reason: err.message };
  }
}

async function httpApiAdapter(pos, { sku }) {
  const cfg = pos?.priceApi || {};
  if (!cfg.endpoint || !sku) {
    return { available: false, source: "http", fetchFailed: false, reason: "sin endpoint o SKU" };
  }
  try {
    const param = cfg.skuParam || "sku";
    const sep = cfg.endpoint.includes("?") ? "&" : "?";
    const url = `${cfg.endpoint}${sep}${encodeURIComponent(param)}=${encodeURIComponent(sku)}`;
    const res = await axios.get(url, {
      headers: cfg.authToken ? { Authorization: `Bearer ${cfg.authToken}` } : {},
      timeout: 2500,
    });
    const d = res.data || {};
    if (d.available === false) return { available: false, source: "http", fetchFailed: false };
    const price = Number(d.price);
    if (!Number.isFinite(price) || price <= 0) {
      return { available: false, source: "http", fetchFailed: false, reason: "sin precio" };
    }
    const list = Number(d.listPrice);
    const hasDiscount = Number.isFinite(list) && list > price;
    return {
      available: true,
      price,
      originalPrice: hasDiscount ? list : null,
      hasDiscount,
      discountPercent: hasDiscount ? Math.round((1 - price / list) * 100) : 0,
      currency: d.currency || "MXN",
      // NOTE: IVA handling pending the store's confirmation (¿precios con IVA?). We
      // trust the payload's taxIncluded, defaulting to the POS config (assume incl.).
      taxIncluded: d.taxIncluded != null ? !!d.taxIncluded : cfg.taxIncluded !== false,
      url: d.url || null,
      title: d.title || null,
      updatedAt: d.updatedAt || null,
      source: "http",
    };
  } catch (err) {
    const status = err.response?.status;
    // 404/410 = "no such SKU" (data issue). Anything else = store unreachable.
    const fetchFailed = !status || status >= 500 || status === 401 || status === 403 || status === 408;
    return { available: false, source: "http", fetchFailed, reason: err.message };
  }
}

// Resolve a live price for a product via a specific POS's adapter.
async function priceViaPos(pos, { link, dbPrice, sku } = {}) {
  if (!pos) return { available: false, source: null, fetchFailed: false };
  if (pos.kind === "http_price_api") return httpApiAdapter(pos, { sku });
  return mlAdapter({ link, dbPrice }); // default/mercadolibre
}

module.exports = {
  getDefaultPos,
  getPosById,
  clearPosCache,
  linkForPos,
  priceViaPos,
  isMlPos,
};
