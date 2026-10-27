#!/usr/bin/env node
// scripts/gcFollowUpTest.js
//
// Fast, deterministic tests for the Ground Cover 24h follow-up (client spec
// 2026-10-27). No DB, no LLM, no network — it exercises the parts that decide whether a
// real customer gets an unsolicited message, which is exactly the code that must not be
// trusted to a prompt or to a judge.
//
// Run before touching jobs/gcFollowUp.js:  node scripts/gcFollowUpTest.js

const {
  inSendWindow,
  nextWindowOpenAt,
  hardExclusion,
  isGroundCoverConvo,
  FOLLOW_UP_TEXT,
  WAIT_MS,
} = require("../jobs/gcFollowUp");

let pass = 0;
const fails = [];
function ok(label, got, want) {
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (same) pass++;
  else fails.push(`${label}\n     want: ${JSON.stringify(want)}\n     got:  ${JSON.stringify(got)}`);
}

// ── §3.2 THE SEND WINDOW — 7:00 to 20:00 México (centro) = UTC-6, no DST since 2022.
// These are the boundaries a customer would feel: a message at 06:59 or 20:00 local is
// the campaign misbehaving.
[
  ["07:00 MX — opens", "2026-10-27T13:00:00Z", true],
  ["06:59 MX — too early", "2026-10-27T12:59:00Z", false],
  ["19:59 MX — last minute", "2026-10-28T01:59:00Z", true],
  ["20:00 MX — closed", "2026-10-28T02:00:00Z", false],
  ["12:00 MX — midday", "2026-10-27T18:00:00Z", true],
  ["00:00 MX — midnight", "2026-10-27T06:00:00Z", false],
  ["03:00 MX — small hours", "2026-10-27T09:00:00Z", false],
].forEach(([label, iso, want]) => ok(`window: ${label}`, inSendWindow(new Date(iso)), want));

// §3.2 "…deberá programarse para las 7:00 a.m. del siguiente día permitido."
ok(
  "window: 20:30 MX → next day 07:00 MX",
  nextWindowOpenAt(new Date("2026-10-28T02:30:00Z")).toISOString(),
  "2026-10-28T13:00:00.000Z"
);
ok(
  "window: 05:00 MX → same day 07:00 MX",
  nextWindowOpenAt(new Date("2026-10-27T11:00:00Z")).toISOString(),
  "2026-10-27T13:00:00.000Z"
);

// ── §4 THE HARD EXCLUSIONS. Every one of these is a customer we must NOT message.
// The accented cases are load-bearing: `\b` after "compré" / "conseguí" cannot match,
// which silently disabled the "already bought" exclusion the first time around.
[
  ["fue un error, me equivoqué de chat", "accidente"],
  ["perdón, por error le escribí", "accidente"],
  ["sin querer le marqué", "accidente"],
  ["no me vuelvan a contactar por favor", "no_contactar"],
  ["ya no me escriban", "no_contactar"],
  ["denme de baja", "no_contactar"],
  ["déjenme en paz", "no_contactar"],
  ["son unos rateros, es una estafa", "hostil"],
  ["no sean pendejos", "hostil"],
  ["ya la compré gracias", "ya_compro"],
  ["ya compré", "ya_compro"],
  ["ya pagué por mercado libre", "ya_compro"],
  ["ya hice el pedido", "ya_compro"],
  ["ya quedó el pedido", "ya_compro"],
  ["luego les aviso cuando lo decida", "cliente_retoma"],
  ["yo les busco más adelante", "cliente_retoma"],
  ["yo te contacto", "cliente_retoma"],
  ["ya no me interesa, gracias", "no_interesado"],
  ["no me interesa", "no_interesado"],
  ["ya lo conseguí en otro lado", "no_interesado"],
  // Trips `ya_compro` first (the list is ordered, first match wins). Both labels are
  // true of this customer and both exclude them; the key only decides which bucket the
  // dashboard counts it in.
  ["ya compré en otra tienda", "ya_compro"],
].forEach(([txt, want]) => {
  const got = hardExclusion([txt]);
  ok(`exclude: ${JSON.stringify(txt)}`, got && got.key, want);
});

// ── §4's other half: a PENDING conversation must survive the exclusions. "La falta de
// respuesta por sí sola no significa necesariamente una falta de interés" — so a price
// objection, a deferral, or a plain question are all still followable.
[
  "¿cuál es el precio del rollo de 2x100?",
  "déjame consultarlo con mi esposo",
  "está muy caro",
  "no gracias", // a reply to ONE offer, not a verdict — left to the AI gate
  "necesito 5 metros nada más",
  "lo voy a pensar",
  "no tienen en 4 metros?",
  "¿hacen envíos a Mérida?",
  "me interesa pero ahorita no tengo el dinero",
  "¿cómo puedo hacer mi pedido?",
  "mi código postal es 76000",
  "no me alcanza por ahora",
].forEach((txt) => {
  const got = hardExclusion([txt]);
  ok(`keep: ${JSON.stringify(txt)}`, got && got.key, null);
});

// An exclusion anywhere in the transcript counts, not just in the last message.
ok(
  "exclude: scans the whole transcript",
  (hardExclusion(["¿cuánto cuesta?", "ya la compré gracias", "👍"]) || {}).key,
  "ya_compro"
);

// ── WHOSE CONVERSATION IS THIS? The active flow is authoritative; a stale
// productInterest from an earlier visit must not drag a borde customer into this
// campaign (psid 39693838233563590 did exactly that in the first dry run).
[
  ["engine GC flow", { currentFlow: "workflow:Ground Cover (Malla Antimaleza)" }, true],
  ["legacy GC convo flow", { currentFlow: "convo:convo_groundcoverWholesale" }, true],
  ["ad-entry interest, no flow", { productInterest: "ground_cover" }, true],
  ["ad-entry interest, flow is 'default'", { currentFlow: "default", productInterest: "groundcover" }, true],
  ["poi only", { poiRootName: "Malla Antimaleza" }, true],
  ["coldstart", { currentFlow: "workflow:Coldstart" }, false],
  ["confeccionada", { currentFlow: "workflow:Malla Sombra Confeccionada con Refuerzo" }, false],
  [
    "BORDE flow with a stale GC interest",
    { currentFlow: "workflow:Borde separador - Mayoreo y menudeo", productInterest: "ground_cover" },
    false,
  ],
  ["nothing at all", {}, false],
].forEach(([label, convo, want]) => ok(`flow: ${label}`, isGroundCoverConvo(convo), want));

// ── §2 / §3.1 — the message and the wait, as written.
ok("spec: wait is 24h", WAIT_MS, 24 * 60 * 60 * 1000);
ok("spec: message names the product", /Ground Cover/.test(FOLLOW_UP_TEXT), true);
ok("spec: message offers other measures", /otra medida/.test(FOLLOW_UP_TEXT), true);
ok("spec: message carries no price or link", /\$|https?:\/\//.test(FOLLOW_UP_TEXT), false);

const total = pass + fails.length;
if (fails.length) {
  console.log(`\n❌ ${fails.length} FAILED:\n`);
  for (const f of fails) console.log(`  • ${f}\n`);
}
console.log(`${pass}/${total} pass`);
process.exit(fails.length ? 1 : 0);
