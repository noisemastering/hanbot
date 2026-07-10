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
    // Sin-refuerzo is NEVER a switch TARGET — reforzada (con refuerzo) is the
    // default confeccionada flow. You only ever DRIVE in sin-refuerzo by starting
    // there (its own ad); from anywhere else a confeccionada measure routes to
    // reforzada. So exclude sin-refuerzo from the offer set.
    if (/sin\s*refuerzo/i.test(f.name || "")) continue;
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
  // A genuine W×L (2-D) measure: both dimensions present.
  const is2D = dims.length >= 2 && dims[0] > 0 && dims[1] > 0;
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
    // A 2-D measure can NEVER be a LENGTH-ONLY product (borde separador, sold by a
    // single linear length). Exclude length-only leaves so "6x4" doesn't surface
    // borde as a candidate (which produced a bogus "reforzada o borde" clarify).
    if (is2D) {
      const full = await PF.findById(leaf._id).select("enabledDimensions").lean().catch(() => null);
      const ed = full?.enabledDimensions;
      if (Array.isArray(ed) && ed.length > 0 && !ed.includes("width")) continue;
    }
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

// DISTINGUISHING product-category label for the clarify question. The TOP ancestor
// is too coarse (con-refuerzo AND sin-refuerzo both sit under "Malla Sombra
// Raschel" → "Raschel o Raschel"). Scan the whole ancestry for the keyword that
// actually tells the products apart.
async function categoryLabel(leaf) {
  const names = [];
  let cur = leaf;
  for (let i = 0; i < 8 && cur; i++) {
    names.push(String(cur.name || ""));
    cur = cur.parentId ? await PF.findById(cur.parentId).select("_id name parentId").lean().catch(() => null) : null;
  }
  const j = names.join(" ").toLowerCase();
  if (/sin\s*refuerzo/.test(j)) return "sin refuerzo (con argollas)";
  if (/con\s*refuerzo|reforzad/.test(j)) return "reforzada (con refuerzo)";
  if (/ground\s*cover/.test(j)) return "ground cover";
  if (/borde/.test(j)) return "borde separador";
  if (/rollo/.test(j)) return "rollo";
  return names[names.length - 1] || String(leaf.name || "");
}

// Does the message EXPLICITLY name the product category of this leaf? (so we can
// switch realms only on an explicit mention, e.g. "rollo de 2x10" while in the
// reforzada flow). Keyword-per-category, matched against the customer's words.
async function messageNamesOffer(msgLow, leaf) {
  const names = [];
  let cur = leaf;
  for (let i = 0; i < 8 && cur; i++) {
    names.push(String(cur.name || ""));
    cur = cur.parentId ? await PF.findById(cur.parentId).select("name parentId").lean().catch(() => null) : null;
  }
  const j = names.join(" ").toLowerCase();
  if (/sin\s*refuerzo/.test(j)) return /sin\s*refuerzo|argolla/.test(msgLow);
  if (/con\s*refuerzo|reforzad/.test(j)) return /reforzad|con\s*refuerzo/.test(msgLow);
  if (/ground\s*cover/.test(j)) return /ground\s*cover|groundcover|antimaleza/.test(msgLow);
  if (/borde/.test(j)) return /borde|separador/.test(msgLow);
  if (/rollo/.test(j)) return /\brollos?\b/.test(msgLow);
  if (/confeccionada/.test(j)) return /confeccionad/.test(msgLow);
  return false;
}

// Main entry. Returns one of:
//   { action: "none" }                                  no specialist offers it
//   { action: "stay" }                                  current realm owns it (precedence)
//   { action: "switch", toWorkflowId, toName, product } go to another realm
//   { action: "clarify", candidates: [...] }            COLD-START only
//
// REALM PRECEDENCE (user rule): if the CURRENT realm sells the measure, we STAY
// and offer ours — even when another realm also sells it — UNLESS the customer
// explicitly names the other product. The ONLY flow that asks the customer to
// choose between realms is cold-start (it has no realm of its own / it triages).
async function routeByMeasure(message, dims, currentWorkflowId, opts = {}) {
  const offers = await findMeasureOffers(message, dims);
  if (offers.length === 0) return { action: "none" };

  const withOwner = [];
  for (const o of offers) withOwner.push({ leaf: o.leaf, owner: await pickOwnerFlow(o.leaf, o.flows) });
  const msgLow = String(message || "").toLowerCase();
  const mk = (x) => ({ action: "switch", toWorkflowId: x.owner.id, toName: x.owner.name, product: { id: String(x.leaf._id), name: x.leaf.name } });

  // COLD-START: triage — it has no realm, so it's the only flow that asks the
  // customer to choose. Dedupe by distinguishing label; 1 distinct → switch,
  // 2+ → clarify.
  if (opts.isColdStart) {
    const candidates = [];
    for (const x of withOwner) candidates.push({ ...mk(x), label: await categoryLabel(x.leaf), _leaf: x.leaf });
    const byLabel = new Map();
    for (const c of candidates) if (!byLabel.has(c.label)) byLabel.set(c.label, c);
    const distinct = [...byLabel.values()];
    if (distinct.length === 1) {
      const c = distinct[0];
      return { action: "switch", toWorkflowId: c.toWorkflowId, toName: c.toName, product: c.product };
    }
    // An EXPLICIT product mention disambiguates without asking — e.g. "un ROLLO de
    // 2x100" when that measure also exists as ground cover → go straight to rollo.
    const named = [];
    for (const c of distinct) if (await messageNamesOffer(msgLow, c._leaf)) named.push(c);
    if (named.length === 1) {
      const c = named[0];
      return { action: "switch", toWorkflowId: c.toWorkflowId, toName: c.toName, product: c.product };
    }
    return { action: "clarify", candidates: distinct.map(({ _leaf, ...c }) => c) };
  }

  // SPECIALIST flow:
  // (a) the customer EXPLICITLY named another realm's product → switch to it.
  const namedOther = [];
  for (const x of withOwner) {
    if (String(x.owner.id) === String(currentWorkflowId)) continue;
    if (await messageNamesOffer(msgLow, x.leaf)) namedOther.push(x);
  }
  if (namedOther.length) return mk(namedOther[0]);
  // (b) the current realm sells this measure → STAY (precedence).
  if (withOwner.some((x) => String(x.owner.id) === String(currentWorkflowId))) return { action: "stay" };
  // (c) current realm doesn't sell it → go to the (single) other realm, or, if
  // several, the preferred default (reforzada) — never clarify outside cold-start.
  if (withOwner.length === 1) return mk(withOwner[0]);
  const pick = withOwner.find((x) => /con\s*refuerzo|reforzad/i.test(x.owner.name || "")) || withOwner[0];
  return mk(pick);
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
