// scripts/fixBorde54Link.js — replace the borde grueso 54 m's DEAD Mercado Libre link.
//
//   node scripts/fixBorde54Link.js            (dry run, default)
//   node scripts/fixBorde54Link.js --write
//
// Found 2026-11-04 while tracing wa:5215561713855 ("debió de mandarle el link, solo es
// 1 borde de 54"). The catalogue's listing for CIN-BOR-GRU-54M, MLMU901854642, returns
// 404 — the product was RELISTED on Mercado Libre and the catalogue was never updated.
// The live listing is MLMU3547188914, at $1,699, and it is the one the asesora sent the
// customer by hand from her own copy.
//
// Why this matters beyond one link: with the borde now out of the ROLLO COMPLETO rule
// (the user's call, same day — "all borde products must be offered the link unless
// their wholesale threshold is reached"), the 54 m is supposed to go out WITH its link
// and its live price. A dead link produces the opposite: resolvePrice falls to the
// no-live-listing rule, quotes the stale sheet price ($1,599) and hands off, which is
// the behaviour the report was about. Live ML is the source of truth for the price, so
// the sheet price is NOT edited here — fixing the link is what makes the live number
// reachable.

require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");

const WRITE = process.argv.includes("--write");
const CODE = "CIN-BOR-GRU-54M";
const DEAD = "MLMU901854642";
const LIVE_URL = "https://www.mercadolibre.com.mx/borde-plastico-jardin-rollo-de-54-metros-grueso/up/MLMU3547188914";

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const PF = require("./../models/ProductFamily");
  const { getMLPrice } = require("./../ai/utils/mlPriceLookup");

  const leaf = await PF.findOne({ productCode: CODE, sellable: true }).lean();
  if (!leaf) throw new Error(`no sellable leaf with productCode ${CODE}`);

  const links = leaf.onlineStoreLinks || [];
  const idx = links.findIndex((l) => l && typeof l.url === "string" && l.url.includes(DEAD));
  console.log(`\n${CODE} — ${leaf.name} (${leaf.size})`);
  console.log(`  sheet price: $${leaf.price}   cached mlPrice: $${leaf.mlPrice}`);
  console.log(`  links: ${links.length}`);
  links.forEach((l, i) => console.log(`    [${i}] ${i === idx ? "DEAD → " : "       "}${l.url}`));

  // Never swap in a link we have not just checked ourselves.
  const live = await getMLPrice(LIVE_URL);
  console.log(`\n  replacement ${LIVE_URL.split("/").pop()} → ${JSON.stringify(live)}`);
  if (!live || !Number.isFinite(live.price) || live.price <= 0) {
    throw new Error("the replacement listing did not price — aborting, nothing written");
  }
  if (idx < 0) {
    console.log("\n  nothing to do: the dead link is not on this product any more.");
    await mongoose.disconnect();
    return;
  }

  const next = links.map((l, i) => (i === idx ? { ...l, url: LIVE_URL } : l));
  console.log(`\n  ${WRITE ? "WRITING" : "DRY RUN — would write"}:`);
  console.log(`    onlineStoreLinks[${idx}].url = ${LIVE_URL}`);
  console.log(`    (price stays $${leaf.price}; the LIVE $${live.price} is what the bot will quote)`);

  if (WRITE) {
    await PF.updateOne({ _id: leaf._id }, { $set: { onlineStoreLinks: next } });
    const after = await PF.findById(leaf._id).select("onlineStoreLinks").lean();
    console.log("\n  after:", JSON.stringify((after.onlineStoreLinks || []).map((l) => l.url), null, 1));
  }
  await mongoose.disconnect();
})().catch((e) => { console.error("❌", e.message); process.exit(1); });
