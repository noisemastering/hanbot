// ONE owner for "how many times may someone guess?".
//
// /auth/login had no limit at all: with the API closed (middleware/auth.js) the login
// form is the front door, and a script could try passwords against it as fast as the
// server would answer. Same for /auth/forgot-password, which sends an e-mail per call.
//
// Failures are counted in Mongo (`auth_attempts`, TTL-expired), not in memory, so a
// deploy or a second instance does not hand the attacker a fresh allowance.
//
// Three counters per login, because each one alone has a hole:
//   pair  username+IP   5 / 15 min   the ordinary case: one person, one place
//   ip    IP            20 / 15 min  one place trying MANY usernames
//   user  username      25 / 60 min  MANY places trying one username (a per-IP limit
//                                    alone is beaten by rotating addresses)
// The `user` cap is deliberately loose: a tight one would let anyone lock a known
// account out by failing on purpose. At 25 guesses an hour no real password falls.
// A successful login clears the pair; a successful password reset clears the user.
const mongoose = require("mongoose");

const MIN = 60 * 1000;
const RULES = {
  pair: { max: 5, windowMs: 15 * MIN },
  ip: { max: 20, windowMs: 15 * MIN },
  user: { max: 25, windowMs: 60 * MIN },
  forgotIp: { max: 5, windowMs: 60 * MIN },
  forgotEmail: { max: 3, windowMs: 60 * MIN },
};

// The caller's address as OUR infrastructure saw it. Measured on production
// (2026-11-14): the request reaches the app as
//     X-Forwarded-For: <caller>, <Railway edge>
// — the platform appends its own edge address LAST, and discards whatever
// X-Forwarded-For the caller sent (a spoofed "9.9.9.9" never arrived). So the caller is
// the entry just before the last one. Reading the LAST entry, as the first version did,
// counted every user in the world as the same edge address: twenty wrong passwords by
// anyone would have locked the whole team out. Counting from the RIGHT also stays
// correct if a platform ever appends instead of replacing ("spoofed, caller, edge").
// With a single entry (or none: local development) there is no edge hop to skip.
function clientIp(req) {
  const xff = String((req.headers && req.headers["x-forwarded-for"]) || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (xff.length >= 2) return xff[xff.length - 2];
  if (xff.length === 1) return xff[0];
  return req.ip || (req.socket && req.socket.remoteAddress) || "unknown";
}

const norm = (s) => String(s || "").trim().toLowerCase().slice(0, 120);
function loginKeys(username, ip) {
  const u = norm(username);
  return [
    { rule: "pair", key: `pair:${u}|${ip}` },
    { rule: "ip", key: `ip:${ip}` },
    { rule: "user", key: `user:${u}` },
  ];
}

// ---- store (Mongo by default; injectable for the test) ---------------------------
let indexed = false;
const mongoStore = {
  col() {
    const c = mongoose.connection.collection("auth_attempts");
    if (!indexed) { indexed = true; c.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {}); }
    return c;
  },
  async get(key) { return this.col().findOne({ _id: key }); },
  async put(key, doc) { await this.col().replaceOne({ _id: key }, { _id: key, ...doc }, { upsert: true }); },
  async inc(key) { await this.col().updateOne({ _id: key }, { $inc: { count: 1 } }); },
  async del(key) { await this.col().deleteOne({ _id: key }); },
};
let store = mongoStore;
let now = () => Date.now();

// Is any of these keys over its limit? → { blocked, retryAfterSec }
async function check(keys) {
  let wait = 0;
  for (const { rule, key } of keys) {
    const d = await store.get(key);
    if (!d || d.expireAt.getTime() <= now()) continue;
    if (d.count >= RULES[rule].max) wait = Math.max(wait, d.expireAt.getTime() - now());
  }
  return { blocked: wait > 0, retryAfterSec: Math.ceil(wait / 1000) };
}

// Count one failure against each key. The window starts at the FIRST failure and does
// not slide, so a locked-out person is let back in on schedule, not pushed out forever.
async function fail(keys) {
  for (const { rule, key } of keys) {
    const d = await store.get(key);
    if (!d || d.expireAt.getTime() <= now()) await store.put(key, { count: 1, expireAt: new Date(now() + RULES[rule].windowMs) });
    else await store.inc(key);
  }
}

async function clear(keys) {
  for (const { key } of keys) await store.del(key);
}

// A throttle that cannot reach its store must not lock everybody out of the dashboard:
// these wrappers fail OPEN, and say so in the log.
const safe = (fn, fallback) => async (...a) => {
  try { return await fn(...a); } catch (e) { console.error("⚠️ login throttle unavailable:", e.message); return fallback; }
};

module.exports = {
  RULES, clientIp, loginKeys, norm,
  check: safe(check, { blocked: false, retryAfterSec: 0 }),
  fail: safe(fail, undefined),
  clear: safe(clear, undefined),
  _use: (s, clock) => { store = s || mongoStore; now = clock || (() => Date.now()); },
};
