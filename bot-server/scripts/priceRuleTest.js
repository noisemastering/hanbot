// scripts/priceRuleTest.js — the NO-LINK price rule, deterministically.
//   node scripts/priceRuleTest.js
//
// No DB, no LLM, no network: resolvePrice() only calls Mercado Libre when the product
// HAS an ML link, so every case below runs offline on plain objects.
//
// THE RULE (2026-10-23): with no ML link, the PRICE SHEET decides.
// `mlPrice` is a cache the nightly sync writes, and the sync finds products BY their
// link — so the moment a link is removed, `mlPrice` freezes forever and describes a
// listing we no longer send anyone to. It used to be preferred over the sheet anyway,
// which bought nothing (on all 15 unlinked products the two numbers were identical)
// and armed a tripwire: the "inventario below the last ML price" guard would fire the
// first time someone lowered the sheet price for a delisted item, and the bot would
// stop quoting a price at all. That guard protects a LIVE listing from being
// undersold. With no listing there is nothing to undersell.
//
// A no-link quote ALWAYS hands off too (quoteThenHandoff): the customer cannot
// self-serve without a link, so a human closes it. And with NO sheet price, the bot
// quotes NOTHING and hands off — the stale cache is not a fallback, because a number
// no human stands behind is worse than no number.

// priceResolver destructures getMLPrice at load time, so the stub must be in the
// module registry BEFORE it is required. "Reached ML, nothing to sell there" is
// exactly what a paused listing or an unwon catalogue returns — no network needed.
const _lookupPath = require.resolve("../ai/utils/mlPriceLookup");
require.cache[_lookupPath] = {
  id: _lookupPath,
  filename: _lookupPath,
  loaded: true,
  exports: { getMLPrice: async () => ({ price: null, source: null }) },
};

const { resolvePrice } = require("../ai/workflow/priceResolver");

const ML = (url = "https://articulo.mercadolibre.com.mx/MLM-1-x") => [{ url }];
const base = { name: "Rollo de prueba", active: true, sellable: true };

const CASES = [
  { why: "no link, sheet == stale cache → the sheet, quoted + handoff",
    p: { ...base, price: 400, mlPrice: 400 },
    expect: { amount: 400, source: "inventario", handoff: true, quoteThenHandoff: true } },

  { why: "no link, sheet BELOW the stale cache → still the sheet (this used to quote NOTHING)",
    p: { ...base, price: 350, mlPrice: 1200 },
    expect: { amount: 350, source: "inventario", handoff: true } },

  { why: "no link, sheet ABOVE the stale cache → the sheet",
    p: { ...base, price: 900, mlPrice: 500 },
    expect: { amount: 900, source: "inventario", handoff: true } },

  { why: "no link, no sheet price → HAND OFF, quote nothing (the stale cache is not a fallback)",
    p: { ...base, price: null, mlPrice: 400 },
    expect: { amount: null, source: null, handoff: true } },

  { why: "no link, no price anywhere → never invent one",
    p: { ...base, price: null, mlPrice: null },
    expect: { amount: null, handoff: true } },

  { why: "+ IVA rides the SHEET price only",
    p: { ...base, price: 400, mlPrice: 400, priceExcludesTax: true },
    expect: { amount: 400, source: "inventario", plusIva: true } },

  { why: "no link + no sheet price: the asesor is told the stale ML number is NOT quotable",
    p: { ...base, price: null, mlPrice: 400 },
    expect: { amount: null, handoff: true } },

  { why: "sold out wins over everything, with no price and no self-serve",
    p: { ...base, price: 400, mlPrice: 400, stock: 0 },
    expect: { amount: null, handoff: true, soldOut: true } },

  { why: "stock undefined is NOT sold out (manual field, must not false-flag)",
    p: { ...base, price: 400, mlPrice: 400 },
    expect: { amount: 400, soldOut: undefined } },

  { why: "not sellable → not quotable",
    p: { ...base, sellable: false, price: 400, mlPrice: null },
    expect: { amount: 400, source: "inventario" } },
];

// A LINK that ML cannot price (paused / 404 / catalogue with no winner). Same rule as
// no link at all: the PRICE SHEET decides, the dead link is withheld, and with no
// sheet price the bot quotes NOTHING. The cached `mlPrice` is the price OF that dead
// listing, so it is never the answer. These need a stubbed ML lookup, below.
const DEAD_LISTING_CASES = [
  { why: "dead listing, sheet $350 → quote the SHEET, withhold the link, hand off",
    p: { ...base, price: 350, mlPrice: 1200, onlineStoreLinks: ML() },
    expect: { amount: 350, source: "inventario", link: null, handoff: true, quoteThenHandoff: true } },

  { why: "dead listing, sheet ABOVE the cache → still the sheet",
    p: { ...base, price: 1500, mlPrice: 1200, onlineStoreLinks: ML() },
    expect: { amount: 1500, source: "inventario", link: null, handoff: true } },

  { why: "dead listing, NO sheet price → hand off, quote NOTHING",
    p: { ...base, price: null, mlPrice: 1200, onlineStoreLinks: ML() },
    expect: { amount: null, source: null, link: null, handoff: true } },

  { why: "dead listing + sheet price carrying tax → + IVA still rides the sheet",
    p: { ...base, price: 350, mlPrice: 1200, priceExcludesTax: true, onlineStoreLinks: ML() },
    expect: { amount: 350, source: "inventario", plusIva: true } },
];

// ROLLO COMPLETO (decided 2026-10-23). A full roll is quoted from the PRICE
// SHEET with IVA folded in, never from Mercado Libre, never with a buy link,
// and always with a handoff — our ML listings for full rolls run well above our
// own direct price (GC 4x100 m: $5,314 on ML vs $4,222.40 direct), and a
// customer who saw both said so out loud. The live ML price wins everywhere
// else; this is the one exception.
const FULL_ROLL_CASES = [
  { why: "GC 4x100 m: sheet $3,640 + IVA → $4,222.40, no link, handoff (NOT the $5,314 ML price)",
    p: { ...base, productCode: "GC-ROL-NEG-04X100", price: 3640, priceExcludesTax: true, mlPrice: 5314, onlineStoreLinks: ML() },
    expect: { amount: 4222.4, source: "inventario", link: null, plusIva: false, ivaIncluded: true, fullRoll: true, handoff: true, quoteThenHandoff: true } },

  { why: "GC 2x100 m: sheet $1,820 + IVA → $2,111.20 (what the asesor quotes)",
    p: { ...base, productCode: "GC-ROL-BLA-02X100", price: 1820, priceExcludesTax: true, onlineStoreLinks: ML() },
    expect: { amount: 2111.2, link: null, ivaIncluded: true, fullRoll: true } },

  { why: "a 100 m roll of any width is a full roll (4.2x100 is coded 04X100)",
    p: { ...base, productCode: "MSR-ROL-70-BEI-04X100", price: 3340.8, priceExcludesTax: true, onlineStoreLinks: ML() },
    expect: { amount: 3875.33, fullRoll: true, link: null, handoff: true } },

  { why: "borde 54 m is a full roll; its sheet price carries no IVA, so no gross-up",
    p: { ...base, productCode: "CIN-BOR-GRU-54M", price: 1699, onlineStoreLinks: ML() },
    expect: { amount: 1699, link: null, plusIva: false, ivaIncluded: false, fullRoll: true, handoff: true } },

  { why: "a full roll with NO sheet price quotes NOTHING and hands off",
    p: { ...base, productCode: "GC-ROL-NEG-04X100", price: null, mlPrice: 5314, onlineStoreLinks: ML() },
    expect: { amount: null, source: null, link: null, fullRoll: true, handoff: true } },

  { why: "sold out still wins over the full-roll rule — and withholds the link",
    p: { ...base, productCode: "GC-ROL-NEG-04X100", price: 3640, priceExcludesTax: true, stock: 0, onlineStoreLinks: ML() },
    expect: { amount: null, handoff: true, soldOut: true, link: null } },

  // ── NOT full rolls: the rule must not swallow the cut pieces ───────────────
  { why: "GC 4x50 m is a cut piece, not a full roll → normal path",
    p: { ...base, productCode: "GC-ROL-NEG-04X50", price: 5100, priceExcludesTax: true },
    expect: { fullRoll: undefined } },

  { why: "borde 18 m is a cut piece, not a full roll",
    p: { ...base, productCode: "CIN-BOR-GRU-18M", price: 709 },
    expect: { fullRoll: undefined } },

  { why: "the 47 m UV cord roll is a $300 complement, deliberately NOT a full roll",
    p: { ...base, productCode: "COR-LAZ-47M", price: 300 },
    expect: { fullRoll: undefined } },

  { why: "no productCode → the NAME decides ('Rollo de 2x100 m')",
    p: { ...base, name: "Rollo de 2x100 m", price: 1820, priceExcludesTax: true, onlineStoreLinks: ML() },
    expect: { amount: 2111.2, fullRoll: true, link: null } },

  { why: "no productCode → 'Rollo de 18 m' is still not a full roll",
    p: { ...base, name: "Rollo de 18 m", price: 709 },
    expect: { fullRoll: undefined } },
];

(async () => {
  let pass = 0;
  const fails = [];
  for (const c of [...CASES, ...DEAD_LISTING_CASES, ...FULL_ROLL_CASES]) {
    const got = await resolvePrice(c.p, {}).catch((e) => ({ _err: e.message }));
    const bad = [];
    for (const [k, want] of Object.entries(c.expect)) {
      if (JSON.stringify(got[k]) !== JSON.stringify(want)) {
        bad.push(`${k}: got ${JSON.stringify(got[k])}, want ${JSON.stringify(want)}`);
      }
    }
    if (bad.length) fails.push({ ...c, bad });
    else pass++;
  }

  const total = CASES.length + DEAD_LISTING_CASES.length + FULL_ROLL_CASES.length;
  console.log(`\n════════ PRICE RULES: NO LIVE LISTING + ROLLO COMPLETO — ${total} cases ════════\n`);
  for (const f of fails) {
    console.log(`❌ ${f.why}`);
    console.log(`   product: ${JSON.stringify(f.p)}`);
    for (const b of f.bad) console.log(`   ${b}`);
    console.log("");
  }
  console.log(`${pass}/${total} pass${fails.length ? `, ${fails.length} FAIL` : ""}\n`);
  process.exit(fails.length ? 1 : 0);
})();
