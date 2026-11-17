#!/usr/bin/env node
// A LINK MUST BE ONE THE SYSTEM PRODUCED — 12 cases, no DB / no LLM / no network.
//   node scripts/linkGuardTest.js
const { stripUnknownLinks, linksIn } = require("../utils/linkGuard");

const REAL = "https://www.mercadolibre.com.mx/borde-separador-para-jardin-rollo-de-18m-grueso-negro/p/MLM56819676";
const FAKE = "https://hanlob.com.mx/collections/borde-separador/products/borde-separador-premium-54m";
const SRC = `[share_product_link] devolvió: Precio: $687. Link: ${REAL}\nTienda: https://www.mercadolibre.com.mx/tienda/distribuidora-hanlob`;

let pass = 0; const fails = [];
const t = (name, ok, got) => (ok ? pass++ : fails.push(`${name} → ${JSON.stringify(got)}`));

let r = stripUnknownLinks(`Perfecto, te comparto el link del de 54 m para que completes tu compra:\n${FAKE}`, SRC);
t("the reported reply: invented link removed", !r.text.includes("hanlob.com.mx/collections") && r.removed.length === 1, r);
t("…and the sentence announcing it goes too", !/te comparto el link/i.test(r.text), r.text);

r = stripUnknownLinks(`¡Perfecto! El rollo de 18 m está en $687. Aquí lo compras: ${REAL}`, SRC);
t("a link from a tool output is untouched", r.text.includes(REAL) && r.removed.length === 0, r);

r = stripUnknownLinks(`Aquí lo compras: ${REAL}.`, SRC);
t("trailing punctuation does not make a real link unknown", r.removed.length === 0 && r.text.includes(REAL), r);

r = stripUnknownLinks(`El rollo de 18 m está en $687. Cómpralo aquí: ${FAKE} ¿Cuántos necesitas? 😊`, SRC);
t("the rest of the reply survives", /\$687/.test(r.text) && /¿Cuántos necesitas\?/.test(r.text) && !r.text.includes(FAKE), r.text);

r = stripUnknownLinks(`Mira [la tienda](${FAKE}) y dime.`, SRC);
t("a markdown link is removed whole", !r.text.includes(FAKE) && !r.text.includes("]("), r.text);

r = stripUnknownLinks(`El de 18: ${REAL}\nEl de 54: ${FAKE}`, SRC);
t("one real, one invented: only the invented one goes", r.text.includes(REAL) && !r.text.includes(FAKE), r.text);

r = stripUnknownLinks("Sí, enviamos a domicilio a toda la República.", SRC);
t("a reply with no link is returned as is", r.text === "Sí, enviamos a domicilio a toda la República." && !r.removed.length, r);

r = stripUnknownLinks(`Nuestra tienda: https://www.mercadolibre.com.mx/tienda/distribuidora-hanlob`, SRC);
t("the store link in context is allowed", r.removed.length === 0, r);

r = stripUnknownLinks(`${FAKE}`, SRC);
t("a reply that was only an invented link comes back empty", r.text === "", r.text);

r = stripUnknownLinks(`Aquí está: ${REAL}`, "");
t("with no sources at all nothing is trusted", r.removed.length === 1, r);

t("linksIn finds both and trims punctuation", linksIn(`a ${REAL}, b ${FAKE}.`).length === 2 && !linksIn(`x ${FAKE}.`)[0].endsWith("."), linksIn(`x ${FAKE}.`));

console.log(`\nlinkGuard — ${pass}/${pass + fails.length} passed`);
for (const f of fails) console.log(`❌ ${f}`);
process.exit(fails.length ? 1 : 0);
