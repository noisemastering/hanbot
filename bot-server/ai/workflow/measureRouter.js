// ai/workflow/measureRouter.js
//
// Deterministic, catalog-driven flow routing by MEASURE.
//
// Rule ("no flow, no offer"): a measure is a candidate only if an ACTIVE
// SPECIALIST flow actually sells a product at that exact W×L. We find which
// specialist flows offer the measure, dedupe by the real product leaf, and:
//   - 1 distinct product  → switch to the specialist flow that owns it
//   - 2+ distinct products → CLARIFY (ask the client which), then switch
//   - 0 products          → "none" (caller falls back to the LLM scope classifier)
//
// A flow only "offers" products if it is a real specialist: NOT cold-start
// (triage routes out, never sells) and its realm maps to a SINGLE top-level
// product category. A broad catch-all whose realm spans many categories (e.g. a
// promo/dynamics flow) is NOT an offer — that's what keeps a measure resolving
// to its true specialist, and lets a newly-added specialist become an offer the
// moment its flow exists. (Assumption: specialist = single top category. Flag if
// a real selling flow ever legitimately spans >1 category.)
//
// Because this is a CATALOG FACT (which flow has a sellable leaf at the measure),
// it also subsumes the confeccionada-vs-rollo split: a 100 m measure only exists
// under the rollo flow's realm, a 3×3 only under confeccionada — no length
// heuristic needed.

const PF = require("../../models/ProductFamily");
const WorkflowModel = require("../../models/Workflow");
const { findProductInFamilies } = require("./tools");

// Specialist-flow set is stable across turns; cache briefly.
let _specCache = { at: 0, flows: null };
const _SPEC_TTL = 30000;

async function topAncestorId(familyId) {
  let cur = await PF.findById(familyId).select("_id parentId").lean().catch(() => null);
  for (let i = 0; i < 8 && cur && cur.parentId; i++) {
    const p = await PF.findById(cur.parentId).select("_id parentId").lean().catch(() => null);
    if (!p) break;
    cur = p;
  }
  return cur ? String(cur._id) : null;
}

// Active selling specialists: not cold-start, realm = exactly one top category.
async function getSpecialistFlows() {
  const now = Date.now();
  if (_specCache.flows && now - _specCache.at < _SPEC_TTL) return _specCache.flows;
  const all = await WorkflowModel.find({ active: true, isColdStart: { $ne: true } })
    .select("name family families")
    .lean();
  const out = [];
  for (const f of all) {
    const fams = WorkflowModel.familyListOf(f) || [];
    if (!fams.length) continue;
    const tops = new Set();
    for (const fam of fams) {
      if (!fam.id) continue;
      const t = await topAncestorId(fam.id);
      if (t) tops.add(t);
    }
    if (tops.size === 1) out.push({ id: String(f._id), name: f.name, fams });
  }
  _specCache = { at: now, flows: out };
  return out;
}

// All distinct products (by leaf) at this measure across specialist flows.
async function findMeasureOffers(message, dims) {
  if (!dims) return [];
  const flows = await getSpecialistFlows();
  const byLeaf = new Map(); // leafId -> { leaf, flows: [{id,name,fams}] }
  for (const f of flows) {
    let leaf = null;
    try {
      leaf = await findProductInFamilies(message, f.fams, dims);
    } catch {
      leaf = null;
    }
    if (!leaf || leaf.sellable === false) continue;
    const key = String(leaf._id);
    if (!byLeaf.has(key)) byLeaf.set(key, { leaf, flows: [] });
    byLeaf.get(key).flows.push(f);
  }
  return [...byLeaf.values()];
}

// When one product is reachable via several flows, the owner is the flow whose
// realm family is the NEAREST ancestor of the leaf (the most specific specialist).
async function pickOwnerFlow(leaf, flows) {
  if (flows.length === 1) return flows[0];
  const chain = [];
  let cur = leaf;
  for (let i = 0; i < 8 && cur; i++) {
    chain.push(String(cur._id));
    cur = cur.parentId ? await PF.findById(cur.parentId).select("_id parentId").lean().catch(() => null) : null;
  }
  let best = flows[0],
    bestIdx = Infinity;
  for (const f of flows) {
    const ids = new Set((f.fams || []).map((x) => String(x.id)));
    const idx = chain.findIndex((id) => ids.has(id));
    if (idx >= 0 && idx < bestIdx) {
      bestIdx = idx;
      best = f;
    }
  }
  return best;
}

// Friendly product-category label (top family ancestor name), for the clarify
// question. Light cleanup; refine when a 2nd specialist actually goes live.
async function categoryLabel(leaf) {
  let cur = leaf,
    top = leaf;
  for (let i = 0; i < 8 && cur; i++) {
    top = cur;
    cur = cur.parentId ? await PF.findById(cur.parentId).select("_id name parentId").lean().catch(() => null) : null;
  }
  const name = String(top?.name || leaf.name || "").trim();
  return name || String(leaf.name || "");
}

// Main entry. Returns one of:
//   { action: "none" }                                  no specialist offers it
//   { action: "stay" }                                  current flow owns it
//   { action: "switch", toWorkflowId, toName, product } single offer elsewhere
//   { action: "clarify", candidates: [{toWorkflowId,toName,product,label}] }
async function routeByMeasure(message, dims, currentWorkflowId) {
  const offers = await findMeasureOffers(message, dims);
  if (offers.length === 0) return { action: "none" };

  if (offers.length === 1) {
    const { leaf, flows } = offers[0];
    const owner = await pickOwnerFlow(leaf, flows);
    if (String(owner.id) === String(currentWorkflowId)) return { action: "stay" };
    return {
      action: "switch",
      toWorkflowId: owner.id,
      toName: owner.name,
      product: { id: String(leaf._id), name: leaf.name },
    };
  }

  // 2+ DISTINCT products share this measure → ask before switching.
  const candidates = [];
  for (const o of offers) {
    const owner = await pickOwnerFlow(o.leaf, o.flows);
    candidates.push({
      toWorkflowId: owner.id,
      toName: owner.name,
      product: { id: String(o.leaf._id), name: o.leaf.name },
      label: await categoryLabel(o.leaf),
    });
  }
  return { action: "clarify", candidates };
}

function buildClarifyQuestion(candidates, dims) {
  const labels = candidates.map((c) => c.label);
  const dimTxt = dims ? `${dims[0]}x${dims[1]} m` : "esa medida";
  const opts =
    labels.length <= 2
      ? labels.join(" o ")
      : labels.slice(0, -1).join(", ") + " o " + labels[labels.length - 1];
  return `¡Claro! La medida ${dimTxt} la manejamos en ${opts}. ¿Cuál te interesa? 😊`;
}

// Map the client's free-text answer to one of the clarify candidates (natural
// language — the bot must understand "la sin refuerzo", "ground cover", etc.).
async function matchClarifyReply(reply, candidates) {
  const { getClient } = require("./llmClient");
  try {
    const client = getClient();
    const list = candidates.map((c, i) => `${i}: ${c.label}`).join("\n");
    const res = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 10,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `El cliente está eligiendo entre estas opciones de producto (mismas medidas, distinta familia):\n${list}\n\nSegún su mensaje, ¿cuál eligió? Devuelve SOLO JSON {"i": <índice elegido, o -1 si no quedó claro>}.`,
        },
        { role: "user", content: String(reply) },
      ],
    });
    const i = JSON.parse(res.choices[0].message.content).i;
    return Number.isInteger(i) && i >= 0 && i < candidates.length ? i : -1;
  } catch {
    return -1;
  }
}

module.exports = { routeByMeasure, buildClarifyQuestion, matchClarifyReply, findMeasureOffers, getSpecialistFlows };
