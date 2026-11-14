// node scripts/webhookSignatureTest.js — no DB/LLM/network (Mongo collection stubbed).
const crypto = require("crypto");
const mongoose = require("mongoose");
const docs = {};
let dbDown = false;
mongoose.connection.collection = () => ({
  async findOne(q) { if (dbDown) throw new Error("down"); return docs[q._id] || null; },
  async updateOne(q, u) {
    if (dbDown) throw new Error("down");
    const d = (docs[q._id] = docs[q._id] || { _id: q._id });
    for (const [k, v] of Object.entries(u.$set || {})) d[k] = v;
    for (const [k, v] of Object.entries(u.$inc || {})) d[k] = (d[k] || 0) + v;
  },
});
require.cache[require.resolve("../services/pushNotifications")] = { exports: { sendToSuperAdmins: async () => {} }, loaded: true, id: "stub" };
const { signatureVerdict, decide, acceptWebhook, _resetSecrets, VALID, INVALID, MISSING, NO_SECRET } = require("../utils/webhookSignature");

let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : (fail++, console.log("  ✗ " + n)); };
const SECRET = "test-app-secret", OTHER = "another-apps-secret";
const body = Buffer.from(JSON.stringify({ object: "page", entry: [{ messaging: [{ message: { text: "¿precio? ñ á 😀" } }] }] }));
const sign = (buf, secret) => "sha256=" + crypto.createHmac("sha256", secret).update(buf).digest("hex");

// ---- the pure verdict ----
ok("a correctly signed delivery is valid", signatureVerdict(body, sign(body, SECRET), [SECRET]) === VALID);
ok("uppercase hex is accepted", signatureVerdict(body, sign(body, SECRET).toUpperCase().replace("SHA256", "sha256"), [SECRET]) === VALID);
ok("any of several candidate secrets may match", signatureVerdict(body, sign(body, OTHER), [SECRET, undefined, OTHER]) === VALID);
ok("signed with a different secret is invalid", signatureVerdict(body, sign(body, "attacker-guess"), [SECRET]) === INVALID);
ok("one changed byte in the body is invalid", signatureVerdict(Buffer.from(body.toString().replace("precio", "precio!")), sign(body, SECRET), [SECRET]) === INVALID);
ok("a re-serialised body is invalid (raw bytes matter)", signatureVerdict(Buffer.from(JSON.stringify(JSON.parse(body), null, 1)), sign(body, SECRET), [SECRET]) === INVALID);
ok("no header is missing", signatureVerdict(body, undefined, [SECRET]) === MISSING);
ok("the old sha1 header format is not accepted", signatureVerdict(body, "sha1=" + "a".repeat(40), [SECRET]) === MISSING);
ok("a malformed header is missing", signatureVerdict(body, "sha256=xyz", [SECRET]) === MISSING);
ok("a short hex signature is missing", signatureVerdict(body, "sha256=" + "a".repeat(63), [SECRET]) === MISSING);
ok("no raw body is missing", signatureVerdict(undefined, sign(body, SECRET), [SECRET]) === MISSING);
ok("no secret configured is its own verdict", signatureVerdict(body, sign(body, SECRET), [undefined, "", "  "]) === NO_SECRET);
ok("signing with an empty secret never validates", signatureVerdict(body, sign(body, ""), [""]) === NO_SECRET);

// ---- the decision ----
ok("valid always passes", decide(VALID, true) && decide(VALID, false));
for (const v of [INVALID, MISSING, NO_SECRET]) {
  ok(`observe mode lets ${v} through`, decide(v, false) === true);
  ok(`armed refuses ${v}`, decide(v, true) === false);
}

// ---- the self-arming flow ----
const call = async (channel, headers, raw = body) => {
  const res = { code: null, sendStatus(c) { this.code = c; } };
  const accepted = await acceptWebhook(channel, { rawBody: raw, headers }, res);
  return { accepted, code: res.code };
};
(async () => {
  process.env.FB_APP_SECRET = SECRET; delete process.env.WHATSAPP_APP_SECRET; delete process.env.META_APP_SECRET;

  let r = await call("messenger", {});
  ok("before arming, an unsigned delivery is still processed", r.accepted && r.code === null);
  r = await call("messenger", { "x-hub-signature-256": sign(body, "attacker-guess") });
  ok("a forged signature cannot arm the channel", r.accepted && !docs.messenger.armedAt);

  r = await call("messenger", { "x-hub-signature-256": sign(body, SECRET) });
  ok("the first VALID delivery arms the channel", r.accepted && !!docs.messenger.armedAt);

  r = await call("messenger", {});
  ok("armed: unsigned is refused with 403", !r.accepted && r.code === 403);
  r = await call("messenger", { "x-hub-signature-256": sign(body, "attacker-guess") });
  ok("armed: forged is refused with 403", !r.accepted && r.code === 403);
  r = await call("messenger", { "x-hub-signature-256": sign(body, SECRET) });
  ok("armed: a real delivery still passes", r.accepted && r.code === null);

  r = await call("whatsapp", {});
  ok("arming is per channel: whatsapp is still observing", r.accepted);

  dbDown = true;
  r = await call("messenger", {});
  ok("armed + DB down: still refuses the forgery", !r.accepted && r.code === 403);
  r = await call("messenger", { "x-hub-signature-256": sign(body, SECRET) });
  ok("armed + DB down: a real delivery still passes", r.accepted);
  r = await call("instagram", {});
  ok("never-armed channel + DB down: fails OPEN (the bot must not go silent)", r.accepted);
  dbDown = false;

  ok("verdicts are counted", docs.messenger["count.valid"] >= 2 && docs.messenger["count.missing"] >= 2 && docs.messenger["count.invalid"] >= 2);

  delete process.env.FB_APP_SECRET;
  r = await call("telegram", { "x-hub-signature-256": sign(body, SECRET) });
  ok("no secret configured: observes, never arms, never refuses", r.accepted && !(docs.telegram || {}).armedAt && docs.telegram["count.no_secret"] === 1);

  // The production case: the ENV secret is the wrong one, the right one is in the database.
  process.env.FB_APP_SECRET = "stale-value-in-the-environment";
  r = await call("wa2", { "x-hub-signature-256": sign(body, SECRET) });
  ok("wrong env secret, nothing in the DB: real delivery reads as invalid but is not refused", r.accepted && !(docs.wa2 || {}).armedAt);
  docs.meta_app_secret = { _id: "meta_app_secret", value: SECRET };
  _resetSecrets();
  r = await call("wa2", { "x-hub-signature-256": sign(body, SECRET) });
  ok("the DB secret verifies the real delivery and arms the channel", r.accepted && !!docs.wa2.armedAt);
  r = await call("wa2", { "x-hub-signature-256": sign(body, "stale-value-in-the-environment") });
  ok("…and a delivery signed with the stale env value still passes (either secret)", r.accepted);
  r = await call("wa2", { "x-hub-signature-256": sign(body, "attacker-guess") });
  ok("…while a forgery is now refused", !r.accepted && r.code === 403);

  await new Promise((r) => setTimeout(r, 20));
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
