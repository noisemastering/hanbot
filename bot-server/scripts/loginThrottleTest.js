// node scripts/loginThrottleTest.js — no DB/LLM/network (in-memory store, fake clock).
const t = require("../utils/loginThrottle");
let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : (fail++, console.log("  ✗ " + n)); };

let clock = 1_000_000_000_000;
const mem = new Map();
let down = false;
const store = {
  async get(k) { if (down) throw new Error("down"); return mem.get(k) || null; },
  async put(k, d) { if (down) throw new Error("down"); mem.set(k, { ...d }); },
  async inc(k) { if (down) throw new Error("down"); mem.get(k).count++; },
  async del(k) { if (down) throw new Error("down"); mem.delete(k); },
};
t._use(store, () => clock);
const MIN = 60000;
const attempt = async (user, ip, good = false) => {
  const keys = t.loginKeys(user, ip);
  const g = await t.check(keys);
  if (g.blocked) return { blocked: true, wait: g.retryAfterSec };
  if (good) { await t.clear(keys.filter((k) => k.rule === "pair")); return { ok: true }; }
  await t.fail(keys);
  return { failed: true };
};

(async () => {
  // ---- one person, one place: 5 tries, then wait ----
  for (let i = 1; i <= 5; i++) ok(`try ${i} is answered`, (await attempt("ana", "1.1.1.1")).failed);
  let r = await attempt("ana", "1.1.1.1");
  ok("6th try is blocked", r.blocked);
  ok("…with a wait of at most 15 min", r.wait > 0 && r.wait <= 15 * 60);
  ok("the RIGHT password does not get through a block either", (await attempt("ana", "1.1.1.1", true)).blocked);
  ok("username case and spaces do not dodge it", (await attempt("  ANA ", "1.1.1.1")).blocked);
  ok("someone else at the same address is not blocked", (await attempt("beto", "1.1.1.1")).failed);
  ok("the same account from another address still works", (await attempt("ana", "2.2.2.2", true)).ok);

  clock += 15 * MIN + 1000;
  ok("after the window the account opens again", (await attempt("ana", "1.1.1.1")).failed);
  // the window does not slide: failures while blocked do not extend it
  mem.clear(); clock += 1;
  for (let i = 0; i < 5; i++) await attempt("cara", "3.3.3.3");
  const until = mem.get("pair:cara|3.3.3.3").expireAt.getTime();
  for (let i = 0; i < 10; i++) { clock += MIN; await attempt("cara", "3.3.3.3"); }
  ok("hammering a locked account does not extend the lock", mem.get("pair:cara|3.3.3.3").expireAt.getTime() === until);

  // ---- a good login wipes the slate for that person ----
  mem.clear();
  for (let i = 0; i < 4; i++) await attempt("dora", "4.4.4.4");
  await attempt("dora", "4.4.4.4", true);
  for (let i = 0; i < 4; i++) await attempt("dora", "4.4.4.4");
  ok("4 misses, a success, 4 more misses: still not blocked", (await attempt("dora", "4.4.4.4")).failed);

  // ---- one place, many usernames ----
  mem.clear();
  for (let i = 0; i < 20; i++) await attempt("user" + i, "5.5.5.5");
  ok("20 failures from one address block that address for ANY username", (await attempt("fresh-name", "5.5.5.5")).blocked);
  ok("…but not other addresses", (await attempt("fresh-name", "6.6.6.6")).failed);

  // ---- many places, one username ----
  mem.clear();
  for (let i = 0; i < 25; i++) await attempt("admin", "9.9.9." + i);
  r = await attempt("admin", "8.8.8.8");
  ok("25 failures across addresses block the account everywhere", r.blocked && r.wait <= 60 * 60);
  ok("…and a different account is unaffected", (await attempt("eva", "8.8.8.8")).failed);
  await t.clear([{ key: "user:" + t.norm("admin") }]);
  ok("a password reset (clear user) lifts it", !(await attempt("admin", "7.7.7.7")).blocked);

  // ---- the address we count is the CALLER's, as our own edge reported it ----
  ok("caller is the entry before the edge's own", t.clientIp({ headers: { "x-forwarded-for": "189.0.0.7, 84.17.44.226" } }) === "189.0.0.7");
  ok("two callers behind the same edge are told apart", t.clientIp({ headers: { "x-forwarded-for": "189.0.0.7, 84.17.44.226" } }) !== t.clientIp({ headers: { "x-forwarded-for": "201.0.0.9, 84.17.44.226" } }));
  ok("a platform that APPENDS cannot be fooled by a spoofed first entry", t.clientIp({ headers: { "x-forwarded-for": "9.9.9.9, 189.0.0.7, 84.17.44.226" } }) === "189.0.0.7");
  ok("a single entry is used as-is", t.clientIp({ headers: { "x-forwarded-for": "189.0.0.7" } }) === "189.0.0.7");
  ok("no header falls back to the socket", t.clientIp({ headers: {}, socket: { remoteAddress: "::1" } }) === "::1");

  // ---- the store being down must not lock the whole team out ----
  mem.clear(); down = true;
  ok("store down: check fails OPEN", (await t.check(t.loginKeys("ana", "1.1.1.1"))).blocked === false);
  let threw = false; try { await t.fail(t.loginKeys("ana", "1.1.1.1")); await t.clear([{ key: "x" }]); } catch { threw = true; }
  ok("store down: counting does not throw", !threw);
  down = false;

  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
