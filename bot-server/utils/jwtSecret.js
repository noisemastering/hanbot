// ONE owner for the secret that signs dashboard logins.
//
// A login token is trusted because of its signature, so whoever knows the signing
// secret can mint a token for any user, super_admin included. The secret used to be
// `process.env.JWT_SECRET || "<a string written in this repo>"`, pasted into 24 files:
// wherever the env var was missing, the server signed with a value anyone with the
// code could read. It came from the original auth scaffold (871ad21, 2025-11-17) —
// a tutorial-style placeholder that was never meant to survive.
//
// There is no fallback literal any more. The secret is, in order:
//   1. JWT_SECRET from the environment, unless it is one of the known PUBLIC
//      placeholders (which are refused — they are in the repo's history forever);
//   2. a random 384-bit secret generated ONCE and kept in the database, so the
//      deployment needs no configuration change to be safe and every instance
//      sharing the DB signs with the same value.
// If neither can be had (DB unreachable), this THROWS: no secret, no logins —
// never a guessable one.
const crypto = require("crypto");
const mongoose = require("mongoose");

const PUBLIC_PLACEHOLDERS = new Set([
  "your-super-secret-jwt-key-change-in-production",
  "your_jwt_secret_key",
]);

let cached = null;
let pending = null;

function fromEnv() {
  const v = (process.env.JWT_SECRET || "").trim();
  return v && !PUBLIC_PLACEHOLDERS.has(v) ? v : null;
}

async function fromDb() {
  // A raw collection on purpose: no model, no route, nothing that serialises it.
  const col = mongoose.connection.collection("server_secrets");
  const fresh = crypto.randomBytes(48).toString("hex");
  // $setOnInsert makes the first writer win; everyone else reads that value back.
  await col.updateOne(
    { _id: "jwt" },
    { $setOnInsert: { value: fresh, createdAt: new Date() } },
    { upsert: true }
  );
  const doc = await col.findOne({ _id: "jwt" });
  if (!doc || typeof doc.value !== "string" || doc.value.length < 32) {
    throw new Error("JWT secret unavailable");
  }
  return doc.value;
}

async function getJwtSecret() {
  if (cached) return cached;
  const env = fromEnv();
  if (env) return (cached = env);
  if (!pending) {
    pending = fromDb()
      .then((v) => (cached = v))
      .finally(() => { pending = null; });
  }
  return pending;
}

module.exports = { getJwtSecret, PUBLIC_PLACEHOLDERS, _reset: () => { cached = null; pending = null; } };
