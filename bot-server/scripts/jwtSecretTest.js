// node scripts/jwtSecretTest.js — no DB/LLM/network (the collection is stubbed).
// The signing secret must never be a value that can be read in the repo.
const mongoose = require("mongoose");
const store = {};
let dbDown = false, writes = 0;
mongoose.connection.collection = () => ({
  async updateOne(q, u) { if (dbDown) throw new Error("down"); if (!store[q._id]) { store[q._id] = { _id: q._id, ...u.$setOnInsert }; writes++; } },
  async findOne(q) { if (dbDown) throw new Error("down"); return store[q._id] || null; },
});
const { getJwtSecret, PUBLIC_PLACEHOLDERS, _reset } = require("../utils/jwtSecret");

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : (fail++, console.log("  ✗ " + name)); };
const fresh = (env) => { _reset(); if (env === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = env; };

(async () => {
  fresh("a-real-deployment-secret");
  ok("a real env secret is used as-is", (await getJwtSecret()) === "a-real-deployment-secret");
  ok("…and the DB is not touched", writes === 0);

  fresh(undefined);
  const a = await getJwtSecret();
  ok("no env ⇒ a generated secret", typeof a === "string" && a.length >= 64);
  ok("generated secret is not a known placeholder", !PUBLIC_PLACEHOLDERS.has(a));
  ok("it was written once", writes === 1);

  fresh(undefined);
  ok("a second process reads the SAME secret back", (await getJwtSecret()) === a && writes === 1);

  for (const p of PUBLIC_PLACEHOLDERS) {
    fresh(p);
    ok(`public placeholder in env is refused: ${p.slice(0, 12)}…`, (await getJwtSecret()) === a);
  }
  fresh("   ");
  ok("blank env is treated as missing", (await getJwtSecret()) === a);

  fresh(undefined);
  const [x, y, z] = await Promise.all([getJwtSecret(), getJwtSecret(), getJwtSecret()]);
  ok("concurrent callers agree", x === a && y === a && z === a);

  fresh(undefined); dbDown = true;
  let threw = false; try { await getJwtSecret(); } catch { threw = true; }
  ok("DB unreachable ⇒ throws, never a guessable secret", threw);
  dbDown = false;
  ok("…and recovers once the DB is back", (await getJwtSecret()) === a);

  // No file may carry a literal fallback again.
  const fs = require("fs"), path = require("path");
  const offenders = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    if (e.name === "node_modules" || e.name === "legacy-backup" || e.name === "scripts") return;
    const p = path.join(d, e.name);
    if (e.isDirectory()) return walk(p);
    if (!e.name.endsWith(".js") || p.endsWith(path.join("utils", "jwtSecret.js"))) return;
    if (/process\.env\.JWT_SECRET\s*\|\|/.test(fs.readFileSync(p, "utf8"))) offenders.push(p);
  });
  walk(path.join(__dirname, ".."));
  ok("no file falls back to a literal secret: " + offenders.join(", "), offenders.length === 0);

  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
