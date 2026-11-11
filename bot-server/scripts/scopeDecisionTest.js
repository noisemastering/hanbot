#!/usr/bin/env node
// WHAT A SCOPE VERDICT MEANS — 22 cases, no DB / no LLM / no network.
//
// The bug this exists for (2026-11-11, wa:5218441323155, "Nunca le dio el producto"):
// on the ANTIMALEZA campaign, "Ocupo la malla antimaleza" was answered "Lamento la
// confusión, pero no manejamos malla antimaleza". The classifier was right every time —
// it said the product belongs to the flow that sells Ground Cover, which IS the current
// flow — and the HANDLING turned that into a denial, because an `other_flow` verdict
// that resolved to no OTHER flow fell through every branch onto an unconditional
// "No vendemos X" return.
//
// So the two load-bearing properties here are:
//   1. the denial is reachable ONLY from a literal "not_sold" verdict, and
//   2. "other_flow" pointing at the CURRENT flow means the product is OURS.
//
//   node scripts/scopeDecisionTest.js

const { scopeDecision } = require("../ai/workflow/tools");

const HERE = "Ground Cover (Malla Antimaleza)";
const CATALOG = [
  { id: "1", name: "Coldstart", isColdStart: true },
  { id: "2", name: HERE, isColdStart: false },
  { id: "3", name: "Borde separador - Mayoreo y menudeo", isColdStart: false },
  { id: "4", name: "Malla Sombra — Rollo", isColdStart: false },
];

const DENIES = /no\s+vendemos|no\s+manejamos/i;
const MINE = /lo manejas t[úu] aqu[íi]/i;
const CONTINUE = /no nombra un producto distinto/i;
const SWITCH = /switch_flow/i;
const ASESOR = /request_handoff/i;

const cases = [
  // ── the reported bug, in both of the shapes the classifier produces ──────────
  {
    name: "other_flow → THIS flow (the reported bug): ours, never a denial",
    v: { verdict: "other_flow", targetFlow: HERE, productName: "malla antimaleza" },
    o: { query: "Ocupo la malla antimaleza", currentFlowName: HERE, flowCatalog: CATALOG },
    want: MINE, notWant: DENIES,
  },
  {
    name: "current on a normal flow: ours",
    v: { verdict: "current", targetFlow: null, productName: "malla antimaleza" },
    o: { query: "malla antimaleza", currentFlowName: HERE, flowCatalog: CATALOG },
    want: MINE, notWant: DENIES,
  },
  {
    name: "other_flow → a flow that no longer exists: continue, never deny",
    v: { verdict: "other_flow", targetFlow: "Flujo Que Ya No Existe", productName: "ground cover" },
    o: { query: "ground cover", currentFlowName: HERE, flowCatalog: CATALOG },
    want: CONTINUE, notWant: DENIES,
  },
  {
    name: "other_flow with a null targetFlow: continue, never deny",
    v: { verdict: "other_flow", targetFlow: null, productName: "ground cover" },
    o: { query: "ground cover", currentFlowName: HERE, flowCatalog: CATALOG },
    want: CONTINUE, notWant: DENIES,
  },

  // ── the switch must still work; this is the half a blunt fix would break ─────
  {
    name: "other_flow → a REAL other flow: switch instructions",
    v: { verdict: "other_flow", targetFlow: "Borde separador - Mayoreo y menudeo", productName: "borde separador" },
    o: { query: "quiero borde plastico", currentFlowName: HERE, flowCatalog: CATALOG },
    want: SWITCH, notWant: DENIES,
    check: (d) => d.scopeResult && d.scopeResult.toWorkflowId === "3" && d.scopeResult.toName === "Borde separador - Mayoreo y menudeo",
  },
  {
    name: "a real switch names the product in scopeResult",
    v: { verdict: "other_flow", targetFlow: "Malla Sombra — Rollo", productName: "rollo de malla sombra" },
    o: { query: "un rollo de malla sombra", currentFlowName: HERE, flowCatalog: CATALOG },
    want: SWITCH,
    check: (d) => d.scopeResult.product && d.scopeResult.product.name === "rollo de malla sombra",
  },
  {
    name: "other_flow with no productName still switches",
    v: { verdict: "other_flow", targetFlow: "Malla Sombra — Rollo", productName: null },
    o: { query: "eso otro", currentFlowName: HERE, flowCatalog: CATALOG },
    want: SWITCH,
    check: (d) => d.scopeResult.toWorkflowId === "4" && d.scopeResult.product === null,
  },

  // ── the TRIAGE flow must still route out and never dead-end ─────────────────
  {
    name: "current on the TRIAGE flow: offer a person, never a denial",
    v: { verdict: "current", targetFlow: null, productName: "malla antimaleza" },
    o: { query: "malla antimaleza", currentFlowName: "Coldstart", flowCatalog: CATALOG, isColdStart: true },
    want: ASESOR, notWant: DENIES,
    check: (d) => d.handoffRequested === true && /triage/i.test(d.handoffReason || ""),
  },
  {
    name: "other_flow → itself on the TRIAGE flow: a person, not a denial",
    v: { verdict: "other_flow", targetFlow: "Coldstart", productName: "malla antimaleza" },
    o: { query: "malla antimaleza", currentFlowName: "Coldstart", flowCatalog: CATALOG, isColdStart: true },
    want: ASESOR, notWant: DENIES,
    check: (d) => d.handoffRequested === true,
  },
  {
    name: "TRIAGE still switches to a real specialist",
    v: { verdict: "other_flow", targetFlow: HERE, productName: "malla antimaleza" },
    o: { query: "malla antimaleza", currentFlowName: "Coldstart", flowCatalog: CATALOG, isColdStart: true },
    want: SWITCH,
    check: (d) => d.scopeResult.toWorkflowId === "2" && d.handoffRequested === false,
  },

  // ── the denial itself: it must survive for what we genuinely do not sell ────
  {
    name: "not_sold: a toldo really is a denial",
    v: { verdict: "not_sold", targetFlow: null, productName: "toldo" },
    o: { query: "un toldo impermeable", currentFlowName: HERE, flowCatalog: CATALOG },
    want: DENIES,
    check: (d) => d.text.includes('"un toldo impermeable"'),
  },
  {
    name: "not_sold: wire mesh is a denial",
    v: { verdict: "not_sold", targetFlow: null, productName: "malla ciclónica" },
    o: { query: "malla ciclonica", currentFlowName: HERE, flowCatalog: CATALOG },
    want: DENIES,
  },
  {
    name: "a denial never requests a handoff or a switch",
    v: { verdict: "not_sold", targetFlow: null, productName: "geomembrana" },
    o: { query: "geomembrana", currentFlowName: HERE, flowCatalog: CATALOG },
    want: DENIES,
    check: (d) => d.handoffRequested === false && d.scopeResult === null,
  },

  // ── needs_human ────────────────────────────────────────────────────────────
  {
    name: "needs_human: sold, no flow → a person, and never 'no lo vendemos'",
    v: { verdict: "needs_human", targetFlow: null, productName: "monofilamento" },
    o: { query: "malla de monofilamento", currentFlowName: HERE, flowCatalog: CATALOG },
    want: ASESOR, notWant: DENIES,
    check: (d) => d.handoffRequested === true && /no hay flujo/i.test(d.handoffReason || ""),
  },

  // ── no_product and the fallbacks ───────────────────────────────────────────
  {
    name: "no_product: continue",
    v: { verdict: "no_product", targetFlow: null, productName: null },
    o: { query: "negro", currentFlowName: HERE, flowCatalog: CATALOG },
    want: CONTINUE, notWant: DENIES,
  },
  {
    name: "an UNKNOWN verdict falls back to continue, not to a denial",
    v: { verdict: "lo_que_sea", targetFlow: null, productName: null },
    o: { query: "malla antimaleza", currentFlowName: HERE, flowCatalog: CATALOG },
    want: CONTINUE, notWant: DENIES,
  },
  {
    name: "a NULL verdict falls back to continue",
    v: null,
    o: { query: "malla antimaleza", currentFlowName: HERE, flowCatalog: CATALOG },
    want: CONTINUE, notWant: DENIES,
  },
  {
    name: "no options at all still never denies",
    v: { verdict: "other_flow", targetFlow: HERE, productName: "x" },
    o: undefined,
    want: CONTINUE, notWant: DENIES,
  },
  {
    name: "an empty catalog never denies",
    v: { verdict: "other_flow", targetFlow: HERE, productName: "malla antimaleza" },
    o: { query: "malla antimaleza", currentFlowName: HERE, flowCatalog: [] },
    want: CONTINUE, notWant: DENIES,
  },
  {
    name: "a missing currentFlowName does not turn a real switch into a denial",
    v: { verdict: "other_flow", targetFlow: HERE, productName: "malla antimaleza" },
    o: { query: "malla antimaleza", currentFlowName: null, flowCatalog: CATALOG },
    want: SWITCH, notWant: DENIES,
  },
  {
    name: "every instruction stays INTERNAL (the customer must never read it)",
    v: { verdict: "other_flow", targetFlow: HERE, productName: "malla antimaleza" },
    o: { query: "malla antimaleza", currentFlowName: HERE, flowCatalog: CATALOG },
    want: /^\[INTERNO/,
  },
  {
    name: "no verdict ever tells the model to mention flows to the customer",
    v: { verdict: "other_flow", targetFlow: "Malla Sombra — Rollo", productName: "rollo" },
    o: { query: "rollo", currentFlowName: HERE, flowCatalog: CATALOG },
    want: /TRANSPARENTE para el cliente/,
  },
];

let pass = 0;
const fails = [];
for (const c of cases) {
  const d = scopeDecision(c.v, c.o);
  const t = String(d && d.text || "");
  const why = [];
  if (c.want && !c.want.test(t)) why.push(`expected ${c.want}`);
  if (c.notWant && c.notWant.test(t)) why.push(`must NOT match ${c.notWant}`);
  if (c.check) { try { if (!c.check(d)) why.push("check() failed"); } catch (e) { why.push("check() threw: " + e.message); } }
  if (why.length) fails.push({ name: c.name, why, text: t.slice(0, 150) });
  else pass++;
}

console.log(`\nscopeDecision — ${pass}/${cases.length} passed`);
for (const f of fails) console.log(`\n❌ ${f.name}\n   ${f.why.join("; ")}\n   got: ${f.text}`);
if (!fails.length) console.log("✅ no verdict but a literal not_sold can ever deny a product.\n");
process.exit(fails.length ? 1 : 0);
