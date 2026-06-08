// One-off repair: restore the DB price on the 38 Rectangular leaves that the
// re-parent reset to $450. Uses the WORKING OAuth token path (getMLPrice via
// mercadoLibreOAuth) — the syncMLPrices utility uses a different, currently-
// expired token manager (mlTokenManager → invalid_grant).
//
// We store the REGULAR/list price in ProductFamily.price (not the promo): when
// the item is on sale, getMLPrice returns price=promo + originalPrice=regular,
// so we take originalPrice; otherwise price. mlPrice mirrors it. (Customer
// quotes always use the LIVE promo price at runtime, so this field is the
// list/fallback value only.)
require("dotenv").config();
const mongoose = require("mongoose");
const PF = require("../models/ProductFamily");
const { getMLPrice } = require("../ai/utils/mlPriceLookup");

const RECTANGULAR_ID = "6942d85ba539ce7f9f28429b";

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const kids = await PF.find({ parentId: RECTANGULAR_ID }).lean();
  let fixed = 0, noLink = 0, failed = [];

  for (const k of kids) {
    const link = (k.onlineStoreLinks || []).find((l) => l?.url && /mercadolibre/i.test(l.url))?.url;
    if (!link) { noLink++; continue; }
    try {
      const r = await getMLPrice(link, k.price);
      if (!r || r.source !== "ml") { failed.push(`${k.size} (no ml price)`); continue; }
      // Regular/list price: originalPrice when discounted, else the price.
      const regular = r.hasDiscount && r.originalPrice ? Math.round(r.originalPrice) : Math.round(r.price);
      if (!regular || regular <= 0) { failed.push(`${k.size} (bad price)`); continue; }
      await PF.updateOne({ _id: k._id }, { $set: { price: regular, mlPrice: regular } });
      console.log(`  ✔ ${k.size} → $${regular}${r.hasDiscount ? ` (promo activo $${Math.round(r.price)})` : ""}`);
      fixed++;
    } catch (e) {
      failed.push(`${k.size} (${e.message})`);
    }
  }

  console.log(`\nDone. fixed=${fixed} noLink=${noLink} failed=${failed.length}`);
  if (failed.length) console.log("Failed:\n  " + failed.join("\n  "));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
