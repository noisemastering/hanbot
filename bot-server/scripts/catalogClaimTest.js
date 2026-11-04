// scripts/catalogClaimTest.js
//
// `node scripts/catalogClaimTest.js` — no DB, no LLM, no network.
//
// "Te comparto nuestro catálogo 📄" with nothing attached — reported twice now
// (psid 28769615639359953 on 2026-10-27, psid 28764912069844715 on 2026-11-04). The
// sentence is the model's prose; the attachment is a tool call. This predicate is what
// ties them together at the output chokepoint: a reply that claims the catalog either
// gets the file attached or loses the claim.
//
// The expensive direction is matching TOO MUCH: the reported reply also carried six real
// prices, and an offer the customer has yet to accept ("¿te comparto el catálogo?") is a
// real question, not a false promise.

const { claimsCatalog, stripCatalogClaim } = require("../utils/catalogClaim");

const CASES = [
  // ── a claim ───────────────────────────────────────────────────────────────
  ["Te comparto nuestro catálogo 📄", true, "the reported sentence, verbatim"],
  ["Te comparto nuestro catálogo con medidas y precios de mayoreo.", true, "the distributor variant"],
  ["Te envío el catálogo.", true, "envío"],
  ["te mando la lista de precios", true, "the price list is the same promise"],
  ["Aquí te va el catálogo", true, "aquí te va"],
  ["Aquí tienes nuestro catálogo actualizado", true, "aquí tienes"],
  ["Le comparto el catálogo con gusto", true, "usted form"],
  ["Adjunto el catálogo para que lo revises", true, "adjunto"],

  // ── NOT a claim ───────────────────────────────────────────────────────────
  ["¿Te comparto el catálogo?", false, "AN OFFER IS NOT A PROMISE — the customer has to say yes"],
  ["¿Quieres que te comparta el catálogo?", false, "same, asked another way"],
  ["Te comparto el precio de la 4x6 m: $649", false, "sharing a PRICE, not the catalogue"],
  ["Te paso el link de compra", false, "a link is sent in the text itself"],
  ["El catálogo no maneja color para este producto", false, "the word catálogo as a NOUN about our range"],
  ["Esa medida no está en nuestro catálogo estándar", false, "the standing 'not in the catalogue' answer"],
  ["", false, "empty"],
];

let pass = 0, fail = 0;
console.log(`\n════════ CATALOG CLAIM — ${CASES.length} cases ════════\n`);
for (const [msg, want, why] of CASES) {
  const got = claimsCatalog(msg);
  if (got === want) { pass++; console.log(`✅ ${want ? "claim " : "ok    "} ${JSON.stringify(msg).slice(0, 52)}`); }
  else { fail++; console.log(`❌ ${JSON.stringify(msg)}\n   claimsCatalog → ${got}, expected ${want}\n   why: ${why}`); }
}

// The strip has to keep everything the turn actually delivered.
const REPORTED =
  "Te comparto nuestro catálogo 📄\n\nY de esas medidas sí las manejamos en malla sombra " +
  "confeccionada al 90% de sombra. Si quieres, también te puedo ir pasando una por una con su precio y link para compra.";
const stripped = stripCatalogClaim(REPORTED);
const checks = [
  ["the claim is gone", !/comparto/i.test(stripped)],
  ["the answer survives", /sí las manejamos/i.test(stripped)],
  ["the offer survives", /una por una/i.test(stripped)],
  ["no dangling conjunction", !/^[YyEe]\s/.test(stripped)],
  ["starts with a capital", /^[A-ZÁÉÍÓÚÑ]/.test(stripped)],
  ["no leading blank lines", stripped === stripped.trim()],
];
for (const [label, ok] of checks) {
  if (ok) { pass++; console.log(`✅ strip: ${label}`); }
  else { fail++; console.log(`❌ strip: ${label}\n   got: ${JSON.stringify(stripped)}`); }
}

// A reply with prices and a claim keeps every number.
const WITH_PRICES = "Te comparto nuestro catálogo 📄\n\n3x5 m: $609\n4x6 m: $649\n\n¿Cuál te interesa?";
const sp = stripCatalogClaim(WITH_PRICES);
for (const n of ["609", "649"]) {
  if (sp.includes(n)) { pass++; console.log(`✅ strip keeps $${n}`); }
  else { fail++; console.log(`❌ strip lost $${n}: ${JSON.stringify(sp)}`); }
}
// And a text with no claim is returned untouched.
const UNTOUCHED = "El rollo de 54 m está en $1699. Aquí lo compras: https://x.mx/a";
if (stripCatalogClaim(UNTOUCHED) === UNTOUCHED) { pass++; console.log("✅ a reply with no claim is untouched"); }
else { fail++; console.log("❌ a reply with no claim was modified"); }

console.log(`\n${pass}/${pass + fail} pass${fail ? ` — ${fail} FAILED` : ""}\n`);
process.exit(fail ? 1 : 0);
