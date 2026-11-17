#!/usr/bin/env node
// THE TURN READER'S VALIDATION LAYER — 25 cases, no DB / no LLM / no network.
//
// The model's JSON is never trusted as-is: shapeReading() keeps only the labels the
// engine defined, numbers that are numbers and a CP that is five digits, because an
// unknown label or a malformed fact must not be able to trigger — or block — a gate.
// The reading itself (does the model understand the message?) is examined by
// scripts/turnReaderEval.js, which needs the LLM.
//
//   node scripts/turnReaderTest.js

const { shapeReading, makeReading, readTurn, ASKS, SIGNALS } = require("../ai/workflow/turnReader");

let pass = 0;
const fails = [];
const t = (name, fn) => {
  try {
    const r = fn();
    if (r === true) pass++;
    else fails.push(`${name} → ${JSON.stringify(r)}`);
  } catch (e) {
    fails.push(`${name} → threw ${e.message}`);
  }
};

// ── labels ─────────────────────────────────────────────────────────────────────
t("keeps known asks", () => shapeReading({ asks: ["precio", "envio_costo"] }).asked("precio", "x") === true);
t("drops unknown asks", () => shapeReading({ asks: ["precio", "hackear", 7, null] }).asks.size === 1);
t("drops unknown signals", () => shapeReading({ signals: ["saludo", "lo_que_sea"] }).signals.size === 1);
t("asks is never undefined", () => shapeReading(null).asks.size === 0 && shapeReading("x").signals.size === 0);
t("asks given as a string is ignored, not iterated", () => shapeReading({ asks: "precio" }).asks.size === 0);
t("every label the prompt names is in the lists", () => ASKS.includes("envio_costo") && SIGNALS.includes("ya_lo_dije") && ASKS.includes("otro"));

// ── derived asks ───────────────────────────────────────────────────────────────
t("contra_entrega implies pago", () => shapeReading({ asks: ["contra_entrega"] }).asked("pago"));
t("a price complaint asks for something cheaper", () => shapeReading({ signals: ["queja_precio"] }).asked("mas_barato"));
t("a named colour is a colour request", () => shapeReading({ facts: { colores: ["verde"] } }).asked("colores"));
t("no colour, no colour ask", () => !shapeReading({ facts: { colores: [] } }).asked("colores"));

// ── facts ──────────────────────────────────────────────────────────────────────
t("cp must be exactly five digits", () => shapeReading({ facts: { cp: "9355" } }).facts.cp === null);
t("cp is cleaned of labels", () => shapeReading({ facts: { cp: "C.P. 93556" } }).facts.cp === "93556");
t("cp as a number is accepted", () => shapeReading({ facts: { cp: 64102 } }).facts.cp === "64102");
t("a 10-digit phone is not a cp", () => shapeReading({ facts: { cp: "4421234567" } }).facts.cp === null);
t("telefono must be ten digits", () => shapeReading({ facts: { telefono: "442 123 4567" } }).facts.telefono === "4421234567" && shapeReading({ facts: { telefono: "12345" } }).facts.telefono === null);
t("measures become numbers", () => { const f = shapeReading({ facts: { ancho: "2", largo: "100" } }).facts; return f.ancho === 2 && f.largo === 100; });
t("decimal comma is read", () => shapeReading({ facts: { ancho: "6,2" } }).facts.ancho === 6.2);
t("zero, negative and text measures are dropped", () => { const f = shapeReading({ facts: { ancho: 0, largo: -3, cantidad: "muchas" } }).facts; return f.ancho === null && f.largo === null && f.cantidad === null; });
t('the string "null" is not a value', () => shapeReading({ facts: { colonia: "null", ciudad: " " } }).facts.colonia === null && shapeReading({ facts: { ciudad: " " } }).facts.ciudad === null);

// ── the questions only a reading can answer ────────────────────────────────────
t("asksBeyond: another question rides along", () => makeReading({ asks: ["envio_costo", "precio"] }).asksBeyond("envio_costo") === true);
t("asksBeyond: nothing else asked", () => makeReading({ asks: ["envio_costo", "envio_modo"] }).asksBeyond("envio_costo", "envio_modo") === false);
t("asksNothing", () => makeReading({ asks: [] }).asksNothing() === true && makeReading({ asks: ["otro"] }).asksNothing() === false);
t("is(): any of the signals", () => makeReading({ signals: ["aplaza"] }).is("cortesia", "aplaza") === true);

// ── the fallback contract: no key ⇒ null ⇒ the engine uses its regex ──────────
(async () => {
  const key = process.env.AI_API_KEY;
  delete process.env.AI_API_KEY;
  const r = await readTurn("¿cuánto cuesta el envío?", { flowName: "x" });
  if (key) process.env.AI_API_KEY = key;
  if (r === null) pass++;
  else fails.push("readTurn without a key must return null");
  const empty = await readTurn("   ");
  if (empty === null) pass++;
  else fails.push("readTurn on an empty message must return null");

  console.log(`\nturnReader (validation) — ${pass}/${pass + fails.length} passed`);
  for (const f of fails) console.log(`❌ ${f}`);
  if (!fails.length) console.log("✅ only defined labels and well-formed facts ever reach a gate.\n");
  process.exit(fails.length ? 1 : 0);
})();
