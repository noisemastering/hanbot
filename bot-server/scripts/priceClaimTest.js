// node scripts/priceClaimTest.js — 25 cases over utils/priceClaim.js.
// No DB, no LLM, no network.
//
// A PROMISE OF A PRICE MUST CARRY THE PRICE (2026-11-09, wa:5218180999001).
// Both directions are load-bearing: the empty promise must be caught, and a reply that
// already states a price — or that promises a COTIZACIÓN rather than a number, or that
// merely ASKS whether to share one — must be left alone.

const { claimsPriceWithoutNumber, backPriceClaim, stripPriceClaim } = require("../utils/priceClaim");

const ROWS = ["• Rollo de 2 x 100 m: $2111.20 (IVA incluido)", "• Rollo de 4 x 100 m: $4222.40 (IVA incluido)"];

let pass = 0, fail = 0;
const t = (name, got, want) => {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`${ok ? "✅" : "❌"} ${name}${ok ? "" : `\n     got: ${JSON.stringify(got)}\n    want: ${JSON.stringify(want)}`}`);
};

// ---- FLAGGED: promised a price, gave none --------------------------------------
const REPORTED =
  "Claro, te comparto el precio de ambos rollos completos de ground cover: 2x100 m y 4x100 m. " +
  "Ambos están disponibles en negro y blanco al mismo precio. El envío va aparte por flete según tu código postal.";
t("the reported reply is flagged", claimsPriceWithoutNumber(REPORTED), true);
t("te paso los precios", claimsPriceWithoutNumber("Con gusto, te paso los precios de los rollos."), true);
t("te doy el precio", claimsPriceWithoutNumber("Te doy el precio del ground cover enseguida."), true);
t("te mando el costo", claimsPriceWithoutNumber("Te mando el costo de los dos rollos."), true);
t("aquí están los precios", claimsPriceWithoutNumber("Aquí están los precios de los rollos completos."), true);
t("le comparto el precio (usted)", claimsPriceWithoutNumber("Le comparto el precio del cover."), true);
t("estos son los precios", claimsPriceWithoutNumber("Estos son los precios de los rollos."), true);
t("te comparto el costo", claimsPriceWithoutNumber("Te comparto el costo de ambas medidas."), true);

// ---- NOT FLAGGED --------------------------------------------------------------
t("it actually stated the price", claimsPriceWithoutNumber("Te comparto el precio: Rollo de 2 x 100 m en $2111.20."), false);
t("price written in pesos", claimsPriceWithoutNumber("Te paso el precio: son 2111 pesos con IVA."), false);
t("an OFFER is a question", claimsPriceWithoutNumber("¿Te comparto el precio de los dos rollos?"), false);
t("cotización, not a number", claimsPriceWithoutNumber("¡Con gusto te preparamos tu cotización! ¿Me compartes tu teléfono?"), false);
t("te paso con un especialista", claimsPriceWithoutNumber("Te paso con un especialista para que te atienda."), false);
t("how pricing works", claimsPriceWithoutNumber("El precio depende de la medida que necesites."), false);
t("asks for the measure", claimsPriceWithoutNumber("¿Qué largo necesitas o qué área quieres cubrir?"), false);
t("empty reply", claimsPriceWithoutNumber(""), false);
t("catalog claim is not a price claim", claimsPriceWithoutNumber("Te comparto nuestro catálogo 📄"), false);

// ---- BACKED with the resolved rows -------------------------------------------
const backed = backPriceClaim(REPORTED, ROWS);
t("backed reply carries both numbers", /2111\.20/.test(backed) && /4222\.40/.test(backed), true);
t("backed reply keeps the colour fact", /negro y blanco/.test(backed), true);
t("backed reply keeps the freight line", /flete/.test(backed), true);
t("backed reply no longer reads as an empty promise", claimsPriceWithoutNumber(backed), false);

// ---- STRIPPED when the flow has no rows --------------------------------------
const stripped = stripPriceClaim(REPORTED);
t("stripped loses the promise", /te comparto el precio/i.test(stripped), false);
t("stripped keeps the rest", /negro y blanco/.test(stripped) && /flete/.test(stripped), true);
t("stripped is recapitalised", /^[A-ZÁÉÍÓÚÑ¿]/.test(stripped), true);
t("nothing to strip → unchanged", stripPriceClaim("¿Qué largo necesitas?"), "¿Qué largo necesitas?");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
