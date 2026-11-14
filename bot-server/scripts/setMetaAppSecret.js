// node scripts/setMetaAppSecret.js [--write]     (dry run by default)
//
// Stores the Meta app secret in the database for utils/webhookSignature.js to read.
// The value comes from THIS machine's FB_APP_SECRET and is CHECKED AGAINST META first:
// an app access token built from it must be able to inspect the page token. A secret
// Meta does not accept is never written. The value itself is never printed — only the
// same short fingerprint the server records.
require("dotenv").config({ quiet: true });
const axios = require("axios");
const mongoose = require("mongoose");
const { fingerprint } = require("../utils/webhookSignature");

(async () => {
  const write = process.argv.includes("--write");
  const secret = (process.env.FB_APP_SECRET || "").trim();
  if (!secret) { console.log("✗ FB_APP_SECRET is not set on this machine."); process.exit(1); }

  // Which app does the page token belong to? Ask Meta, using the candidate secret.
  const appId = process.env.FB_APP_ID || "1555790368916637";
  let app;
  try {
    const r = await axios.get("https://graph.facebook.com/v19.0/debug_token", {
      params: { input_token: process.env.FB_PAGE_TOKEN, access_token: `${appId}|${secret}` },
    });
    app = r.data.data;
  } catch (e) {
    console.log("✗ Meta rejected this app secret:", e.response ? e.response.data.error.message : e.message);
    process.exit(1);
  }
  if (!app.is_valid || String(app.app_id) !== String(appId)) { console.log("✗ Unexpected answer from Meta; not writing."); process.exit(1); }
  console.log(`✓ Meta accepts this secret for app "${app.application}" (${app.app_id}). Fingerprint: ${fingerprint(secret)}`);

  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const col = mongoose.connection.collection("server_secrets");
  const cur = await col.findOne({ _id: "meta_app_secret" });
  console.log("  currently stored:", cur ? `fingerprint ${fingerprint(cur.value)} (set ${cur.updatedAt.toISOString()})` : "nothing");
  if (!write) { console.log("  dry run — pass --write to store it."); process.exit(0); }
  await col.updateOne({ _id: "meta_app_secret" }, { $set: { value: secret, appId: String(app.app_id), updatedAt: new Date() } }, { upsert: true });
  console.log("✓ stored. Running servers pick it up within 5 minutes; a channel arms on its first verified delivery.");
  process.exit(0);
})().catch((e) => { console.log("err", e.message); process.exit(1); });
