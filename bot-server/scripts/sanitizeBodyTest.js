// node scripts/sanitizeBodyTest.js — no DB/LLM/network.
const { scrub, sanitizeBody } = require("../middleware/sanitizeBody");
const { escapeRegex } = require("../utils/escapeRegex");
let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : (fail++, console.log("  ✗ " + n)); };
const clean = (b) => { const copy = JSON.parse(JSON.stringify(b)); const n = scrub(copy); return { out: copy, n }; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- operators are removed wherever they sit ----
ok("operator in place of a string", same(clean({ username: { $ne: null }, password: "x" }).out, { username: {}, password: "x" }));
ok("…and a filter built from it matches nothing by equality", same(clean({ psid: { $gt: "" } }).out.psid, {}));
ok("top-level operator", same(clean({ $where: "sleep(5000)", a: 1 }).out, { a: 1 }));
ok("nested deep", same(clean({ a: { b: { c: { $regex: ".*" }, d: 2 } } }).out, { a: { b: { c: {}, d: 2 } } }));
ok("inside arrays", same(clean({ ids: [{ $ne: 1 }, "ok", [{ $in: [1] }]] }).out, { ids: [{}, "ok", [{}]] }));
ok("update operators too", same(clean({ $set: { role: "super_admin" }, name: "x" }).out, { name: "x" }));
ok("counts what it removed", clean({ a: { $ne: 1, $gt: 0 }, $or: [] }).n === 3);
ok("__proto__ key is dropped", (() => { const b = JSON.parse('{"__proto__":{"polluted":true},"a":1}'); scrub(b); return !Object.prototype.hasOwnProperty.call(b, "__proto__") && ({}).polluted === undefined; })());

// ---- ordinary data is untouched, including the awkward-looking kind ----
const legit = [
  { username: "ana", password: "p@$$w0rd" },
  { text: "cuesta $1,699 + IVA", note: "$ne is just text here" },
  { price: 1699, tags: ["a", "b"], nested: { ok: true, n: null }, list: [] },
  { name: "Rollo de 54 m", size: "13x54m", "key.with.dot": 1, "a$b": 2, "": 3 },
  { object: "page", entry: [{ id: "1", messaging: [{ sender: { id: "2" }, message: { mid: "m_1", text: "¿precio?" } }] }] },
];
for (const b of legit) { const r = clean(b); ok("untouched: " + JSON.stringify(b).slice(0, 48), r.n === 0 && same(r.out, b)); }
ok("a `$` inside a VALUE is data", clean({ msg: "$where" }).out.msg === "$where");
ok("only a LEADING `$` in a KEY is an operator", clean({ "a$b": 1, "USD$": 2 }).n === 0);

// ---- shapes that are not objects ----
for (const v of [undefined, null, "", "text", 0, 42, true]) ok(`non-object body ${JSON.stringify(v)} is left alone`, scrub(v) === 0);
ok("a pathologically deep body does not blow the stack", (() => { let o = {}; const root = o; for (let i = 0; i < 5000; i++) { o.a = {}; o = o.a; } try { scrub(root); return true; } catch { return false; } })());

// ---- the middleware always continues ----
let nexted = 0; const req = { method: "POST", path: "/auth/login", body: { username: { $ne: null } } };
const warn = console.warn; console.warn = () => {}; sanitizeBody(req, {}, () => nexted++); console.warn = warn;
ok("middleware scrubs and calls next", nexted === 1 && same(req.body, { username: {} }));
sanitizeBody({ method: "GET", path: "/x" }, {}, () => nexted++);
ok("no body: still calls next", nexted === 2);

// ---- search text is text ----
const rx = (s) => new RegExp(escapeRegex(s), "i");
ok("a parenthesis no longer throws", (() => { try { rx("malla (90%"); return true; } catch { return false; } })());
ok("it matches itself literally", rx("malla (90%)").test("Malla (90%) beige"));
ok(".* means dot-star, not everything", !rx(".*").test("cualquier cosa") && rx(".*").test("a.*b"));
ok("a catastrophic pattern is inert", (() => { const t = Date.now(); rx("(a+)+$").test("a".repeat(40) + "!"); return Date.now() - t < 200; })());
ok("non-strings are coerced, never thrown on", escapeRegex(null) === "" && escapeRegex(["a", "b"]) === "a,b" && escapeRegex(12) === "12");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
