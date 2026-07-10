// Set active=true for EVERY confeccionada (reforzada + sin refuerzo) sellable
// product that HAS an ML link. User's rule. Backup-first (reversible).
require("dotenv").config();
const mongoose = require("mongoose");
const fs = require("fs");
const PF = require("../models/ProductFamily");
const WF = require("../models/Workflow");
const APPLY = process.argv.includes("--apply");
const hasMlLink = (d) => (d.onlineStoreLinks || []).some((l) => l?.url && /mercadolibre/i.test(l.url));
(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  // Confeccionada family roots = the family lists of the two confeccionada workflows.
  const wfs = await WF.find({ name: /Confeccionada.*(con Refuerzo|Sin Refuerzo)/i }).lean();
  const roots = new Set();
  for (const w of wfs) for (const f of (WF.familyListOf(w) || [])) if (f.id) roots.add(String(f.id));
  console.log("confeccionada family roots:", [...roots].length, [...roots]);
  // BFS descendants
  const seen = new Set(), queue = [...roots], leaves = [];
  while (queue.length) {
    const pid = queue.shift(); if (seen.has(pid)) continue; seen.add(pid);
    const kids = await PF.find({ parentId: pid }).select("name size sellable active onlineStoreLinks parentId").lean();
    for (const k of kids) { queue.push(String(k._id)); if (k.sellable) leaves.push(k); }
  }
  const toActivate = leaves.filter((l) => hasMlLink(l) && l.active !== true);
  console.log(`sellable confeccionada leaves: ${leaves.length} | with ML link & currently inactive: ${toActivate.length}`);
  console.log("sample:", toActivate.slice(0, 8).map((l) => `${l.name}/${l.size}`));
  if (!APPLY) { console.log("\n(dry run — pass --apply to activate)"); await mongoose.disconnect(); return; }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.writeFileSync(`/tmp/activate_backup_${stamp}.json`, JSON.stringify(toActivate.map((l) => ({ _id: l._id, name: l.name, size: l.size, active: l.active }))));
  const ids = toActivate.map((l) => l._id);
  const r = await PF.updateMany({ _id: { $in: ids } }, { $set: { active: true } });
  console.log(`ACTIVATED ${r.modifiedCount} products. Backup: /tmp/activate_backup_${stamp}.json`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
