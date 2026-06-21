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

async function hasIdentity(click) {
  const cd = click.conversionData || {};
  const buyerFirst = norm(cd.buyerFirstName || (cd.receiverName || '').split(/\s+/)[0]);
  const shipCity = norm(cd.shippingCity);
  const shipState = norm(cd.shippingState);
  const shipZip = cd.shippingZipCode ? String(cd.shippingZipCode).trim() : '';

  const user = await User.findOne({
    $or: [{ psid: click.psid }, { unifiedId: click.psid }, { unifiedId: `fb:${click.psid}` }],
  }).lean();

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

  const converted = await ClickLog.find({ converted: true, correlatedOrderId: { $ne: null } }).lean();
  console.log(`Scanning ${converted.length} converted clicklogs…\n`);

  const toRelease = [];
  let kept = 0;
  for (const click of converted) {
    const id = await hasIdentity(click);
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
