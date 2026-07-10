// scripts/mapMlItems.js
//
// Populate ProductFamily.mlItemIds — the ML SELLER-ITEM id(s) (MLM…) each product's
// listing resolves to — so sales attribution can map an ORDER's item id back to OUR
// product and match a click on the PRODUCT (durable) instead of a rotating ML id.
//
// Resolution: catalog links (/up/MLMU… , /p/…) → GET /products/{id}/items → our
// seller's item_id(s); direct item links (MLM…) → used as-is if the item is ours.
// Re-runnable; refresh after relisting products.  Usage: node scripts/mapMlItems.js
require("dotenv").config();
const mongoose = require("mongoose");
const axios = require("axios");
require("../models/ProductFamily");
const { getValidAccessToken } = require("../utils/mercadoLibreOAuth");
const { extractMLItemId } = require("../ai/utils/mlPriceLookup");

const SELLER = "482595248";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const PF = mongoose.model("ProductFamily");
  const token = await getValidAccessToken(SELLER);
  const H = { headers: { Authorization: `Bearer ${token}` }, timeout: 6000 };

  const resolveItemIds = async (id) => {
    // catalog → our seller items
    if (/^MLMU/i.test(id)) {
      try {
        const r = await axios.get(`https://api.mercadolibre.com/products/${id}/items`, H);
        return (r.data?.results || []).filter((x) => String(x.seller_id) === SELLER).map((x) => x.item_id);
      } catch { return []; }
    }
    // direct item id: keep it if it's a live listing of ours
    try {
      const r = await axios.get(`https://api.mercadolibre.com/items/${id}`, H);
      if (String(r.data?.seller_id) === SELLER && r.data?.status !== "closed") return [r.data.id];
    } catch {}
    // fall back to catalog attempt (some /up/MLM… or /p/… are catalog)
    try {
      const r = await axios.get(`https://api.mercadolibre.com/products/${id}/items`, H);
      return (r.data?.results || []).filter((x) => String(x.seller_id) === SELLER).map((x) => x.item_id);
    } catch { return []; }
  };

  const fams = await PF.find({ "onlineStoreLinks.0": { $exists: true } }).select("name onlineStoreLinks mlItemIds").lean();
  console.log(`families with links: ${fams.length}`);
  let mapped = 0, empty = 0, n = 0;
  for (const f of fams) {
    n++;
    const ids = new Set();
    for (const l of f.onlineStoreLinks || []) {
      if (!l.url || !/mercadolibre/i.test(l.url)) continue;
      const id = extractMLItemId(l.url);
      if (!id) continue;
      for (const it of await resolveItemIds(id)) ids.add(it);
      await sleep(120);
    }
    const arr = [...ids];
    await PF.updateOne({ _id: f._id }, { $set: { mlItemIds: arr } });
    if (arr.length) mapped++; else empty++;
    if (n % 25 === 0) console.log(`  …${n}/${fams.length} (${mapped} mapped, ${empty} empty)`);
  }
  console.log(`\n✅ done: ${mapped} families now carry ML item ids, ${empty} resolved to none (dead/foreign listings).`);
  await mongoose.connection.close();
})().catch((e) => { console.error(e.response?.status || e.message); process.exit(1); });
