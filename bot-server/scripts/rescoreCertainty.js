// scripts/rescoreCertainty.js
//
// Re-score existing converted ClickLogs under the new CERTAINTY MODEL using data
// already on record (our captured zip/name on the User + the order's shipping
// zip/receiver/nickname in conversionData + item match in matchDetails + click→
// order minutes). Tiers: 100 (zip+name+item; +nick=undisputed) · 90 (zip+item) ·
// 70 (zip+name, distinto producto) · 50 (zip, distinto producto) · 25 (item+≤5min,
// sin zip) · else NOT a sale (released). Reversible: backs up prior values.
//
//   node scripts/rescoreCertainty.js           # dry run (distribution only)
//   node scripts/rescoreCertainty.js --apply    # write + backup
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config();
const ClickLog = require('../models/ClickLog');
const User = require('../models/User');

const norm = (s) => (s == null ? '' : String(s)).toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const normZip = (z) => String(z || '').replace(/\D/g, '');
const nameInNickname = (first, nick) => first && nick && first.length >= 3 && norm(nick).includes(first);

function classify(m) {
  if (m.zipMatch && m.nameMatch && m.itemMatch)
    return { pct: 100, confidence: 'high', undisputed: !!m.nicknameMatch, ventaIndirecta: false,
             reason: m.nicknameMatch ? 'zip + nombre + item + usuario ML → indiscutible (100%)' : 'zip + nombre + item → trifecta (100%)' };
  if (m.zipMatch && m.itemMatch) return { pct: 90, confidence: 'high', undisputed: false, ventaIndirecta: false, reason: 'zip + item (90%)' };
  if (m.zipMatch && m.nameMatch) return { pct: 70, confidence: 'medium', undisputed: false, ventaIndirecta: true, reason: 'zip + nombre, distinto producto → venta indirecta (70%)' };
  if (m.zipMatch) return { pct: 50, confidence: 'medium', undisputed: false, ventaIndirecta: true, reason: 'zip, distinto producto → venta indirecta (50%)' };
  if (m.itemMatch && m.minutes != null && m.minutes >= 0 && m.minutes <= 5) return { pct: 25, confidence: 'low', undisputed: false, ventaIndirecta: false, reason: 'item + tiempo ≤5 min, sin zip (25%)' };
  return null;
}

async function main() {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI);

  const logs = await ClickLog.find({ converted: true, correlatedOrderId: { $ne: null } }).lean();
  console.log(`Re-scoring ${logs.length} converted clicklogs…`);

  // Batch-load users by psid.
  const psids = [...new Set(logs.map((l) => l.psid).filter(Boolean))];
  const users = await User.find({ $or: [{ psid: { $in: psids } }, { unifiedId: { $in: psids.flatMap((p) => [p, `fb:${p}`]) } }] })
    .select('psid unifiedId firstName first_name lastName last_name location').lean();
  const userBy = new Map();
  for (const u of users) { if (u.psid) userBy.set(String(u.psid), u); if (u.unifiedId) userBy.set(String(u.unifiedId).replace(/^fb:/, ''), u); }

  const dist = { 100: 0, 90: 0, 70: 0, 50: 0, 25: 0, released: 0, unchanged: 0 };
  const changes = [];

  for (const l of logs) {
    const cd = l.conversionData || {};
    const u = userBy.get(String(l.psid));
    const uFirst = norm(u && (u.firstName || u.first_name));
    const uLast = norm(u && (u.lastName || u.last_name));
    const uZip = normZip((u && u.location && u.location.zipcode) || l.zipcode);

    // Parse receiver name → first/last
    let bFirst = '', bLast = '';
    if (cd.receiverName) { const p = String(cd.receiverName).trim().split(/\s+/); bFirst = norm(p[0]); bLast = norm(p.slice(1).join(' ')); }
    else { bFirst = norm(cd.buyerFirstName); bLast = norm(cd.buyerLastName); }

    const zipMatch = !!(uZip && normZip(cd.shippingZipCode) && uZip === normZip(cd.shippingZipCode));
    const nameMatch = !!(uFirst && uLast && bFirst && bLast && uFirst === bFirst && uLast === bLast);
    const itemMatch = !!(l.matchDetails && l.matchDetails.mlItemMatch);
    const nicknameMatch = nameInNickname(uFirst, cd.buyerNickname);
    let minutes = null;
    if (l.clickedAt && cd.orderDate) minutes = (new Date(cd.orderDate).getTime() - new Date(l.clickedAt).getTime()) / 60000;

    const c = classify({ zipMatch, nameMatch, itemMatch, nicknameMatch, minutes });
    if (!c) { dist.released++; changes.push({ _id: l._id, action: 'release', prior: snapshot(l) }); continue; }
    dist[c.pct]++;
    if (l.correlationCertainty === c.pct && l.correlationConfidence === c.confidence) { dist.unchanged++; continue; }
    changes.push({ _id: l._id, action: 'update', to: c, prior: snapshot(l) });
  }

  console.log('\nNew distribution:', JSON.stringify(dist, null, 2));
  console.log(`Changes to write: ${changes.length}`);

  if (!apply) { console.log('\n(DRY RUN — re-run with --apply to write + back up.)'); await mongoose.connection.close(); return; }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(__dirname, `_rescoreBackup_${stamp}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(changes.map((c) => ({ _id: c._id, prior: c.prior })), null, 2));

  let released = 0, updated = 0;
  for (const c of changes) {
    if (c.action === 'release') {
      await ClickLog.findByIdAndUpdate(c._id, { $set: { converted: false, convertedAt: null, correlatedOrderId: null, correlationConfidence: null, correlationMethod: null, correlationCertainty: null, correlationUndisputed: false, ventaIndirecta: false, attributionReason: null } });
      released++;
    } else {
      await ClickLog.findByIdAndUpdate(c._id, { $set: { correlationCertainty: c.to.pct, correlationConfidence: c.to.confidence, correlationUndisputed: c.to.undisputed, ventaIndirecta: c.to.ventaIndirecta, attributionReason: c.to.reason } });
      updated++;
    }
  }
  console.log(`\n💾 Backup: ${backupFile}\n✅ Updated ${updated}, released ${released}.`);
  await mongoose.connection.close();
}

function snapshot(l) {
  return { converted: l.converted, correlatedOrderId: l.correlatedOrderId, convertedAt: l.convertedAt,
    correlationConfidence: l.correlationConfidence, correlationMethod: l.correlationMethod,
    correlationCertainty: l.correlationCertainty, correlationUndisputed: l.correlationUndisputed,
    ventaIndirecta: l.ventaIndirecta, attributionReason: l.attributionReason };
}

main().catch((e) => { console.error(e); process.exit(1); });
