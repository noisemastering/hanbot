// scripts/cleanupUnverifiedConversions.js
//
// Retroactively applies the proprietary correlation gate to EXISTING converted
// ClickLogs: a sale is only legitimate when the buyer's identity (name / zip /
// city / state) corroborates the click's user. Item-id-alone matches are
// unverified and must be released (they were the false-positive class — a
// popular promo order pinned to whoever clicked the link).
//
// Identity is RECOMPUTED from data already stored on the clicklog
// (conversionData: buyer name + shipping city/state/zip) vs the click's User —
// no ML re-fetch needed. Reversible: every released record is backed up to a
// timestamped JSON first.
//
// Usage:
//   node scripts/cleanupUnverifiedConversions.js            # DRY RUN (no writes)
//   node scripts/cleanupUnverifiedConversions.js --apply    # release + backup
//   node scripts/cleanupUnverifiedConversions.js --restore <backupFile>  # undo
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config();
const ClickLog = require('../models/ClickLog');
const User = require('../models/User');

const norm = (s) =>
  (s == null ? '' : String(s)).toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function hasIdentity(click, user) {
  const cd = click.conversionData || {};
  const buyerFirst = norm(cd.buyerFirstName || (cd.receiverName || '').split(/\s+/)[0]);
  const shipCity = norm(cd.shippingCity);
  const shipState = norm(cd.shippingState);
  const shipZip = cd.shippingZipCode ? String(cd.shippingZipCode).trim() : '';

  // Click-level location is also a valid signal (stored on the clicklog itself).
  const uFirst = norm(user && (user.firstName || user.first_name));
  const uCity = norm((user && user.location && user.location.city) || click.city);
  const uState = norm((user && user.location && user.location.state) || click.stateMx);
  const uZip = (user && user.location && user.location.zipcode) || click.zipcode || '';

  const nameMatch = uFirst && buyerFirst && uFirst === buyerFirst;
  const cityMatch = uCity && shipCity && uCity === shipCity;
  const stateMatch = uState && shipState && uState === shipState;
  const zipMatch = uZip && shipZip && String(uZip).trim() === shipZip;

  return { ok: !!(nameMatch || cityMatch || stateMatch || zipMatch), nameMatch, cityMatch, stateMatch, zipMatch };
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const restoreIdx = args.indexOf('--restore');

  await mongoose.connect(process.env.MONGODB_URI);

  if (restoreIdx !== -1) {
    const file = args[restoreIdx + 1];
    const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
    let restored = 0;
    for (const r of backup) {
      await ClickLog.findByIdAndUpdate(r._id, { $set: r.prior });
      restored++;
    }
    console.log(`♻️  Restored ${restored} clicklogs from ${file}`);
    await mongoose.connection.close();
    return;
  }

  // --retier: don't delete anything. Recompute CONFIDENCE from stored matchDetails
  // (the proprietary telltales: name / zip / city / state / POI). Item-id alone →
  // LOW (no longer fake "high"); a single identity telltale → medium; strong
  // identity (zip, or name+location) → high. Reversible: backs up prior tiers.
  if (args.includes('--retier')) {
    const all = await ClickLog.find({ converted: true, correlatedOrderId: { $ne: null } })
      .select('correlationConfidence correlationMethod matchDetails').lean();
    const tierOf = (m = {}) => {
      const id = m.nameMatch || m.zipMatch || m.cityMatch || m.stateMatch || m.poiMatch;
      if (id && (m.zipMatch || (m.nameMatch && (m.cityMatch || m.stateMatch)))) return 'high';
      if (id) return 'medium';
      return 'low';
    };
    const changes = [];
    for (const c of all) {
      const want = tierOf(c.matchDetails || {});
      if (want !== c.correlationConfidence) changes.push({ _id: c._id, from: c.correlationConfidence, to: want });
    }
    const breakdown = changes.reduce((a, c) => ((a[`${c.from}→${c.to}`] = (a[`${c.from}→${c.to}`] || 0) + 1), a), {});
    console.log(`Re-tier: ${changes.length}/${all.length} would change. Breakdown:`, JSON.stringify(breakdown));
    if (!apply) {
      console.log('(DRY RUN — re-run with --retier --apply to write + back up.)');
      await mongoose.connection.close();
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(__dirname, `_retierBackup_${stamp}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(changes, null, 2));
    for (const c of changes) await ClickLog.findByIdAndUpdate(c._id, { $set: { correlationConfidence: c.to } });
    console.log(`💾 Backup: ${backupFile}\n✅ Re-tiered ${changes.length} clicklogs. (Undo: restore confidences from that file.)`);
    await mongoose.connection.close();
    return;
  }

  const converted = await ClickLog.find({ converted: true, correlatedOrderId: { $ne: null } }).lean();
  console.log(`Scanning ${converted.length} converted clicklogs…`);

  // Batch-load every relevant user ONCE (psid + fb:psid variants) into a map,
  // instead of one findOne per clicklog (4k+ Atlas round-trips → minutes).
  const psids = [...new Set(converted.map((c) => c.psid).filter(Boolean))];
  const variants = [...new Set(psids.flatMap((p) => [p, `fb:${p}`]))];
  const users = await User.find({ $or: [{ psid: { $in: psids } }, { unifiedId: { $in: variants } }] })
    .select('psid unifiedId firstName first_name location')
    .lean();
  const userByKey = new Map();
  for (const u of users) {
    if (u.psid) userByKey.set(String(u.psid), u);
    if (u.unifiedId) userByKey.set(String(u.unifiedId).replace(/^fb:/, ''), u);
  }
  const userFor = (click) => userByKey.get(String(click.psid)) || null;
  console.log(`Loaded ${users.length} matching users.\n`);

  const toRelease = [];
  let kept = 0;
  for (const click of converted) {
    const id = hasIdentity(click, userFor(click));
    if (id.ok) {
      kept++;
    } else {
      toRelease.push({ click, id });
    }
  }

  console.log(`✅ KEEP  (identity corroborated): ${kept}`);
  console.log(`🧹 RELEASE (no identity — unverified): ${toRelease.length}\n`);
  console.log('Sample of records to release:');
  for (const { click } of toRelease.slice(0, 8)) {
    const cd = click.conversionData || {};
    console.log(`  psid=${click.psid} method=${click.correlationMethod} conf=${click.correlationConfidence} ` +
      `order=${click.correlatedOrderId} buyer=${cd.buyerFirstName || cd.receiverName || '?'} ` +
      `ship=${cd.shippingCity || '?'}/${cd.shippingZipCode || '?'} $${cd.totalAmount || '?'}`);
  }

  if (!apply) {
    console.log(`\n(DRY RUN — no changes written. Re-run with --apply to release ${toRelease.length} and back up.)`);
    await mongoose.connection.close();
    return;
  }

  // Backup BEFORE writing so this is fully reversible.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(__dirname, `_releasedConversions_${stamp}.json`);
  const backup = toRelease.map(({ click }) => ({
    _id: click._id,
    prior: {
      converted: click.converted,
      convertedAt: click.convertedAt,
      correlatedOrderId: click.correlatedOrderId,
      correlationConfidence: click.correlationConfidence,
      correlationMethod: click.correlationMethod,
      matchDetails: click.matchDetails || null,
    },
  }));
  fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));
  console.log(`\n💾 Backup written: ${backupFile}`);

  const ids = toRelease.map(({ click }) => click._id);
  const res = await ClickLog.updateMany(
    { _id: { $in: ids } },
    { $set: { converted: false, convertedAt: null, correlatedOrderId: null, correlationConfidence: null, correlationMethod: null, matchDetails: null } }
  );
  console.log(`🧹 Released ${res.modifiedCount} unverified conversions. (Undo: --restore ${backupFile})`);
  await mongoose.connection.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
