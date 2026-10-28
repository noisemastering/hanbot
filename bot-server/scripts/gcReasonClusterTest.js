#!/usr/bin/env node
// scripts/gcReasonClusterTest.js
//
// THE GROUNDING OF THE REASON CLUSTERS (2026-10-28, the client's question "why are
// customers not interested anymore").
//
// The clustering itself is a model call, so the thing that must not break is the
// VERIFICATION around it: a theme on the dashboard is a claim about real customers,
// and the client's own constraint is "sin asumir motivos que el cliente no haya
// expresado". These cases are every way a model answer can be wrong — a member that
// was never in the input, the same customer counted under two themes, a quote that
// nobody wrote, an empty theme, items the model forgot — and what the verifier does
// with each.
//
// Fast: no DB, no LLM, no network. Run: node scripts/gcReasonClusterTest.js

const { verifyClusters } = require("../jobs/gcReasonClusters");

let pass = 0;
const fails = [];
function ok(label, got, want) {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else fails.push(`${label}\n     want: ${JSON.stringify(want)}\n     got:  ${JSON.stringify(got)}`);
}

const items = [
  { id: "wa:1", name: "Ana", text: "está muy caro, lo encontré más barato en otro lado" },
  { id: "wa:2", name: "Beto", text: "yo quería 5 metros lineales nada más" },
  { id: "wa:3", name: "Caro", text: "ok gracias" },
  { id: "wa:4", name: "Dani", text: "nunca me contestaron, ya me urgía" },
  { id: "wa:5", name: "Eva", text: "el precio se me pasó del presupuesto" },
];

// ── A well-formed answer: two themes, one unmotivated, quotes that are really there.
{
  const v = verifyClusters(
    {
      clusters: [
        { label: "Precio arriba de lo esperado", category: "precio", members: [1, 5],
          quotes: [{ n: 1, quote: "está muy caro" }, { n: 5, quote: "se me pasó del presupuesto" }] },
        { label: "Quería metros lineales", category: "medidas", members: [2], quotes: [{ n: 2, quote: "5 metros lineales" }] },
        { label: "Nadie le contestó", category: "atencion", members: [4], quotes: [] },
      ],
      sin_motivo: [3],
    },
    items
  );
  ok("clean: themes are ordered by size", v.clusters.map((c) => [c.label, c.count]),
    [["Precio arriba de lo esperado", 2], ["Quería metros lineales", 1], ["Nadie le contestó", 1]]);
  ok("clean: every quote survived", v.clusters[0].quotes.length, 2);
  ok("clean: the unmotivated one is counted, not guessed", v.sinMotivo.map((s) => s.id), ["wa:3"]);
  ok("clean: nothing left over", v.unassigned, []);
  ok("clean: the counts add up to what was read",
    v.clusters.reduce((n, c) => n + c.count, 0) + v.sinMotivo.length + v.unassigned.length, items.length);
}

// ── A MEMBER THAT WAS NEVER IN THE INPUT. Item 9 does not exist; counting it would
//    inflate a theme with a customer who is not there.
{
  const v = verifyClusters({ clusters: [{ label: "Precio", category: "precio", members: [1, 9, 0, -2, "3"] }] }, items);
  ok("ghost members are dropped", v.clusters[0].members.map((m) => m.id), ["wa:1"]);
  ok("and they are reported", v.dropped.members, 4);
}

// ── THE SAME CUSTOMER UNDER TWO THEMES. One item, one theme: otherwise the
//    percentages add up past 100 and the same quote argues for two conclusions.
{
  const v = verifyClusters(
    {
      clusters: [
        { label: "Precio", category: "precio", members: [1] },
        { label: "Atención", category: "atencion", members: [1, 4] },
      ],
    },
    items
  );
  ok("a customer is counted once", [v.clusters[0].count, v.clusters[1].count].sort(), [1, 1]);
  ok("the duplicate is reported", v.dropped.duplicates, 1);
}

// ── A QUOTE NOBODY WROTE. The member stays — the model may have read them right — but
//    the invented words never reach the screen.
{
  const v = verifyClusters(
    { clusters: [{ label: "Precio", category: "precio", members: [1], quotes: [{ n: 1, quote: "me parece un robo" }] }] },
    items
  );
  ok("an invented quote is dropped", v.clusters[0].quotes, []);
  ok("but the member is kept", v.clusters[0].count, 1);
  ok("and the drop is reported", v.dropped.quotes, 1);
}

// ── Accents and punctuation must not fail a REAL quote: the model writes "lo encontre
//    mas barato", the customer wrote "lo encontré más barato".
{
  const v = verifyClusters(
    { clusters: [{ label: "Precio", category: "precio", members: [1], quotes: [{ n: 1, quote: "lo encontre mas barato" }] }] },
    items
  );
  ok("a real quote survives accents", v.clusters[0].quotes.length, 1);
}

// ── A quote attributed to someone outside the theme is not that theme's evidence.
{
  const v = verifyClusters(
    { clusters: [{ label: "Precio", category: "precio", members: [1], quotes: [{ n: 4, quote: "nunca me contestaron" }] }] },
    items
  );
  ok("a quote from a non-member is dropped", v.clusters[0].quotes, []);
}

// ── An EMPTY theme (every member bogus) is not a finding.
{
  const v = verifyClusters({ clusters: [{ label: "Vacío", members: [99] }, { label: "", members: [1] }] }, items);
  ok("an empty theme is dropped", v.clusters.length, 0);
  ok("a theme with no label is dropped", v.dropped.clusters, 2);
}

// ── ITEMS THE MODEL FORGOT are reported, never swallowed: the counts have to add up
//    to the number of texts that were read or the percentages mean nothing.
{
  const v = verifyClusters({ clusters: [{ label: "Precio", category: "precio", members: [1] }], sin_motivo: [3] }, items);
  ok("forgotten items are surfaced", v.unassigned.map((u) => u.id), ["wa:2", "wa:4", "wa:5"]);
}

// ── A category outside the document's five falls back to "otros" instead of inventing
//    a sixth bucket the §8 chart cannot show.
{
  const v = verifyClusters({ clusters: [{ label: "Algo", category: "envio", members: [1] }] }, items);
  ok("an unknown category becomes otros", v.clusters[0].category, "otros");
}

// ── Garbage in: no throw, no clusters. A model that answers nonsense must cost us a
//    blank section, never a wrong one.
{
  ok("null answer", verifyClusters({}, items).clusters, []);
  ok("clusters not an array", verifyClusters({ clusters: "nope" }, items).clusters, []);
  ok("everything unassigned when nothing is claimed", verifyClusters({}, items).unassigned.length, 5);
}

const total = pass + fails.length;
if (fails.length) {
  console.log(`\n❌ ${fails.length} FAILED:\n`);
  for (const f of fails) console.log(`  • ${f}\n`);
}
console.log(`${pass}/${total} pass`);
process.exit(fails.length ? 1 : 0);
