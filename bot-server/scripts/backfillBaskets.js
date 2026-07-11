// scripts/backfillBaskets.js — reconstruct each convo's basket (all products/sizes
// discussed) by scanning its messages. Writes to Conversation.itemsDiscussed (a
// stable field; workflowState.basket is reset by the live engine each turn).
require("dotenv").config();
const mongoose = require("mongoose");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const W = require("../models/Workflow");
const { findProductInFamilies } = require("../ai/workflow/tools");

const SINCE = process.argv[2] ? new Date(process.argv[2]) : new Date("2026-06-01");

function extractMeasures(text) {
  const t = String(text || "").toLowerCase().replace(/(\d),(\d)/g, "$1.$2");
  const out = [];
  const rx = /(\d{1,2}(?:\.\d)?)\s*(?:x|por|×|\*)\s*(\d{1,2}(?:\.\d)?)/g;
  let m;
  while ((m = rx.exec(t))) {
    const a = parseFloat(m[1]), b = parseFloat(m[2]);
    if (a >= 1 && a <= 16 && b >= 1 && b <= 16) out.push([Math.min(a, b), Math.max(a, b)]);
  }
  return out;
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const wfs = await W.find({ active: true }).lean();
  const famMap = new Map();
  for (const wf of wfs) for (const f of (W.familyListOf(wf) || [])) if (f && f.id) famMap.set(String(f.id), f);
  const familyList = [...famMap.values()];
  console.log("family roots:", familyList.length);

  const convos = await Conversation.find({ $or: [{ lastMessageAt: { $gte: SINCE } }, { createdAt: { $gte: SINCE } }] }).select("psid").lean();
  console.log("June convos:", convos.length);
  const cache = new Map();
  let done = 0, withItems = 0, multi = 0;
  for (const c of convos) {
    const msgs = (await Message.find({ psid: c.psid }).select("text").lean()).map((m) => m.text);
    const measures = new Set();
    for (const t of msgs) for (const [w, l] of extractMeasures(t)) measures.add(`${w}x${l}`);
    const basket = [], seen = new Set();
    for (const key of measures) {
      let leaf = cache.get(key);
      if (leaf === undefined) {
        const [w, l] = key.split("x").map(Number);
        leaf = await findProductInFamilies(`${w}x${l} m`, familyList, [w, l]).catch(() => null);
        cache.set(key, leaf || null);
      }
      if (leaf && !seen.has(String(leaf._id))) { seen.add(String(leaf._id)); basket.push({ productId: String(leaf._id), size: leaf.size || key, name: leaf.name, askedAs: key }); }
    }
    if (basket.length) {
      await Conversation.updateOne({ _id: c._id }, { $set: { itemsDiscussed: basket } });
      withItems++;
      if (basket.length >= 2) multi++;
    }
    if (++done % 300 === 0) console.log(`  [${done}/${convos.length}] withItems=${withItems} multi=${multi}`);
  }
  console.log(`\n✅ done. convos=${done} | withBasket=${withItems} | multi-item(2+)=${multi}`);
  const sample = await Conversation.findOne({ "itemsDiscussed.1": { $exists: true } }).select("itemsDiscussed").lean();
  if (sample) console.log("sample multi-item basket:", JSON.stringify(sample.itemsDiscussed.map(b => b.askedAs + "→" + (b.name || b.size))));
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => { console.error("❌", e); process.exit(1); });
