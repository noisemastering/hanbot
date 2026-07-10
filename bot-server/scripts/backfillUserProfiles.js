// scripts/backfillUserProfiles.js
//
// One-time backfill: for every Conversation that already holds identity we
// collected (zip / name / phone / city) but whose customer has no usable User
// profile, create/populate the profile via ensureUserProfile — keyed by the
// conversation's psid (the same psid the ClickLog uses). This is what makes the
// historical zips reachable by sales correlation (they were stranded on the
// conversation because no User was ever created — see ensureUserProfile).
//
//   node scripts/backfillUserProfiles.js            # dry: report how many would be created/updated
//   node scripts/backfillUserProfiles.js --apply     # write the profiles
require("dotenv").config();
const mongoose = require("mongoose");
const Conversation = require("../models/Conversation");
require("../models/User");
const { ensureUserProfile } = require("../ai/utils/locationStats");

const APPLY = process.argv.includes("--apply");

const pickZip = (c) => c.zipcode || c.zipCode || c.customOrderZipcode || c.humanSalesZipcode || (c.location && c.location.zipcode) || null;
const pickName = (c) => c.extractedName || (c.specs && c.specs.customerName) || null;

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);

  // Conversations carrying ANY identity signal worth persisting.
  const q = {
    psid: { $nin: [null, ""] },
    $or: [
      { zipcode: { $nin: [null, ""] } }, { zipCode: { $nin: [null, ""] } },
      { customOrderZipcode: { $nin: [null, ""] } }, { humanSalesZipcode: { $nin: [null, ""] } },
      { extractedName: { $nin: [null, ""] } }, { "specs.customerName": { $nin: [null, ""] } },
      { crmPhone: { $nin: [null, ""] } },
    ],
  };
  const convos = await Conversation.find(q)
    .select("psid zipcode zipCode customOrderZipcode humanSalesZipcode location city stateMx extractedName specs.customerName crmPhone")
    .lean();
  console.log(`Conversations with identity to backfill: ${convos.length}${APPLY ? "" : "  (dry run — pass --apply to write)"}`);

  let withZip = 0, withName = 0, withPhone = 0, written = 0, errors = 0;
  for (const c of convos) {
    const zip = pickZip(c);
    const name = pickName(c);
    const phone = c.crmPhone || null;
    if (zip) withZip++;
    if (name) withName++;
    if (phone) withPhone++;
    if (!APPLY) continue;
    const nm = String(name || "").trim().split(/\s+/).filter(Boolean);
    const res = await ensureUserProfile(c.psid, {
      first_name: nm[0] || undefined,
      last_name: nm.length > 1 ? nm.slice(1).join(" ") : undefined,
      phone: phone || undefined,
      zipcode: zip || undefined,
      city: c.city || undefined,
      state: c.stateMx || undefined,
    }, "conversation");
    if (res) written++; else errors++;
    if (written % 250 === 0 && written) process.stdout.write(`\r  written ${written}…`);
  }
  console.log(`\nsignals present — zip:${withZip}  name:${withName}  phone:${withPhone}`);
  if (APPLY) console.log(`profiles created/updated: ${written}  (errors ${errors})`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
