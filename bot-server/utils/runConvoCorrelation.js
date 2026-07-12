// utils/runConvoCorrelation.js
//
// Convo↔sale correlation runner over OUR OWN data (ml_sales + conversations +
// clicks). Because the data lives in our DB, we don't re-correlate on every page
// load — the dashboard only triggers this when SystemState.lastCorrelationRun.at
// is >3h stale. This runner:
//   1. enriches NEW conversations (AI identity + basket) in the window,
//   2. runs the tiered matcher (utils/convoSaleMatcher) over that window,
//   3. upserts into convo_sale_matches with the linkAudit safety net,
//   4. stamps SystemState.lastCorrelationRun.
//
// full=true → the first-time backtrace from Dec 2025 (rebuilds everything).

const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const ZipCode = require("../models/ZipCode");
const ConvoSaleMatch = require("../models/ConvoSaleMatch");
const ClickLog = require("../models/ClickLog");
const SystemState = require("../models/SystemState");
const { extractConvoIdentity } = require("../ai/utils/convoIdentityExtractor");
const { buildContext, matchConversation } = require("./convoSaleMatcher");

const MLSale = require("../models/MLSale");

const FRESH_HOURS = 3;
const BACKTRACE_START = new Date("2025-12-01T00:00:00.000Z");
const SELLER_ID = "482595248";
const SYNC_BUFFER_DAYS = 2; // re-fetch the last 2 days of ML sales each run (late arrivals)
const MATCH_WINDOW_DAYS = 35; // re-match ~35 days of convos so NEW sales attach to older chats

const MATCH_FIELDS =
  "psid extractedName productSpecs city stateMx zipCode zipcode customOrderZipcode " +
  "humanSalesZipcode leadData crmName productInterest poiRootId poiRootName productFamilyId " +
  "aiIdentity adMainProductId itemsDiscussed createdAt lastMessageAt updatedAt";

function extractMeasures(text) {
  const t = String(text || "").toLowerCase().replace(/(\d),(\d)/g, "$1.$2");
  const out = [];
  const rx = /(\d{1,2}(?:\.\d)?)\s*(?:x|por|×|\*)\s*(\d{1,2}(?:\.\d)?)/g;
  let m;
  while ((m = rx.exec(t))) {
    const a = parseFloat(m[1]), b = parseFloat(m[2]);
    if (a >= 1 && a <= 16 && b >= 1 && b <= 16) out.push(`${Math.min(a, b)}x${Math.max(a, b)}`);
  }
  return out;
}
const parseSize = (t) => {
  const m = String(t || "").toLowerCase().replace(/(\d),(\d)/g, "$1.$2").match(/(\d{1,2}(?:\.\d)?)\s*m?\s*[x×]\s*(\d{1,2}(?:\.\d)?)/);
  if (!m) return null;
  const a = +m[1], b = +m[2];
  if (!(a >= 1 && a <= 16 && b >= 1 && b <= 16)) return null;
  return `${Math.min(a, b)}x${Math.max(a, b)}`;
};
async function pool(items, n, worker) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length || 1) }, async () => {
    while (i < items.length) { const idx = i++; await worker(items[idx], idx); }
  }));
}

// Enrich a batch: AI identity (only if missing) + basket (always refresh).
async function enrichBatch(convos) {
  await pool(convos, 6, async (c) => {
    try {
      const msgs = await Message.find({ psid: c.psid }).select("text senderType").lean();
      const sizes = new Set();
      const update = {};
      if (!c.itemsDiscussed) {
        const sizes = new Set();
        for (const m of msgs) for (const k of extractMeasures(m.text)) sizes.add(k);
        update.itemsDiscussed = [...sizes].map((k) => ({ askedAs: k }));
      }
      if (!c.aiIdentity) {
        const userMsgs = msgs.filter((m) => m.senderType === "user").map((m) => m.text);
        const id = await extractConvoIdentity(userMsgs);
        let zip = null;
        if (id.zip) { const z = await ZipCode.findOne({ code: id.zip }).select("code").lean().catch(() => null); if (z) zip = id.zip; }
        update.aiIdentity = { name: id.name, city: id.city, state: id.state, zip, extractedAt: new Date(), source: "ai" };
      }
      if (Object.keys(update).length) await Conversation.updateOne({ _id: c._id }, { $set: update });
    } catch (e) { /* skip this convo */ }
  });
}

async function computeLinkAudit(match) {
  const clicks = await ClickLog.find({ psid: match.psid, productName: { $ne: null } }).select("productName clicked").lean();
  const shared = [...new Set(clicks.map((c) => parseSize(c.productName)).filter(Boolean))];
  const clicked = [...new Set(clicks.filter((c) => c.clicked).map((c) => parseSize(c.productName)).filter(Boolean))];
  const bought = parseSize(match.sale && match.sale.itemTitle);
  match.linkAudit = {
    sharedProducts: shared.length ? shared : undefined,
    clickedProducts: clicked.length ? clicked : undefined,
    boughtProduct: bought || undefined,
    matchedShared: bought ? shared.includes(bought) : undefined,
    matchedClicked: bought ? clicked.includes(bought) : undefined,
    mismatch: bought && shared.length ? !shared.includes(bought) : undefined,
  };
}

/**
 * Run the correlation. `full` rebuilds from Dec 2025 (clears the collection);
 * otherwise it's incremental over conversations active since the last run.
 */
async function runConvoCorrelation({ full = false } = {}) {
  const state = await SystemState.getState();
  if (state.lastCorrelationRun && state.lastCorrelationRun.running) {
    return { skipped: true, reason: "already running" };
  }
  state.lastCorrelationRun = { ...(state.lastCorrelationRun || {}), running: true, startedAt: new Date() };
  await state.save();

  try {
    // 0. SYNC recent ml_sales from Mercado Libre so we match against CURRENT data.
    //    (Without this the correlation just re-matches a stale ml_sales.) Idempotent
    //    upsert of the last few days; the historical set is already imported.
    try {
      const { backfillLeanSales } = require("./mlSalesLeanImport");
      const latest = await MLSale.findOne({}).sort({ dateCreated: -1 }).select("dateCreated").lean();
      const syncFrom = latest ? new Date(new Date(latest.dateCreated).getTime() - SYNC_BUFFER_DAYS * 864e5) : BACKTRACE_START;
      const syncStats = await backfillLeanSales(SELLER_ID, { startDate: syncFrom, concurrency: 6 });
      console.log(`🔄 ml_sales synced from ${syncFrom.toISOString().slice(0, 10)}: +${syncStats.upserted || 0}`);
    } catch (e) {
      console.error("⚠️ ml_sales sync failed (continuing with existing data):", e.message);
    }

    // Match window: full → Dec 2025; incremental → last ~35 days (so a freshly-synced
    // sale still attaches to an older conversation within the time gate).
    const since = full ? BACKTRACE_START : new Date(Date.now() - MATCH_WINDOW_DAYS * 864e5);
    const dateClause = { $or: [{ lastMessageAt: { $gte: since } }, { createdAt: { $gte: since } }] };

    // 1. enrich ONLY convos in the window still missing identity/basket (bounded cost)
    const toEnrich = await Conversation.find({ $and: [dateClause, { $or: [{ aiIdentity: { $exists: false } }, { itemsDiscussed: { $exists: false } }] }] })
      .select("psid aiIdentity itemsDiscussed").lean();
    await enrichBatch(toEnrich);

    // 2. match the window — gather EVERY qualifying (convo, order) match (each convo
    //    now returns all its candidate matches across tiers, not just its best).
    const ctx = await buildContext();
    const convos = await Conversation.find(dateClause).select(MATCH_FIELDS).lean();
    const allScored = [];
    for (const c of convos) {
      if (!c.psid) continue;
      let arr;
      try { arr = await matchConversation(c, ctx); } catch (e) { continue; }
      for (const doc of arr || []) allScored.push(doc);
    }

    // Rule 7 (human-override lockout): a convo the human already ruled on, and any
    // order already tied to a human verdict, are INELIGIBLE for (re)correlation.
    const lockedPsids = new Set(
      (await Conversation.find({ "saleOverride.verdict": { $in: ["sale", "no_sale"] } }).select("psid").lean())
        .map((o) => String(o.psid))
    );
    const lockedOrders = new Set(
      (await ConvoSaleMatch.find({ humanVerdict: { $in: ["confirmed", "rejected"] } }).select("orderId").lean())
        .map((m) => String(m.orderId)).filter(Boolean)
    );

    // Rule 9 (HIERARCHICAL) + Rule 5 (one order → one click, no double-claim):
    // claim tier-by-tier, highest certainty first (gap breaks ties). Each order is
    // taken once; a convo whose top order is taken falls back to its next-best order.
    allScored.sort((a, b) => b.certainty - a.certainty ||
      (Math.abs(a.matchDetails.gapHoursToSale ?? 1e9) - Math.abs(b.matchDetails.gapHoursToSale ?? 1e9)));
    const claimedOrders = new Set();
    const claimedConvos = new Set(); // one order ↔ one conversation (bijection)
    const finalMatches = [];
    for (const doc of allScored) {
      const oid = String(doc.orderId), pid = String(doc.psid);
      if (lockedPsids.has(pid) || lockedOrders.has(oid)) continue; // human lockout
      if (claimedOrders.has(oid) || claimedConvos.has(pid)) continue; // already taken (either side)
      claimedOrders.add(oid);
      claimedConvos.add(pid);
      finalMatches.push(doc);
    }
    for (const m of finalMatches) await computeLinkAudit(m);

    // 3. persist. full → clean rebuild; incremental → upsert (+ drop stale rows for
    //    orders now claimed by a different convo in this batch).
    if (full) await ConvoSaleMatch.deleteMany({});
    if (finalMatches.length) {
      const ops = finalMatches.map((d) => [
        { deleteMany: { filter: { orderId: d.orderId, _id: { $ne: d._id } } } },
        { updateOne: { filter: { _id: d._id }, update: { $set: d }, upsert: true } },
      ]).flat();
      for (let i = 0; i < ops.length; i += 1000) await ConvoSaleMatch.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
    }

    // 4. re-apply human overrides on top of the freshly-built matches (a full run
    //    wiped them; the authoritative verdicts live on Conversation.saleOverride).
    await applySaleOverrides();

    const stats = { matched: finalMatches.length, scanned: convos.length, since, full: !!full };
    const fresh = await SystemState.getState();
    fresh.lastCorrelationRun = { at: new Date(), running: false, startedAt: null, stats };
    await fresh.save();
    return { ok: true, ...stats };
  } catch (err) {
    const fresh = await SystemState.getState();
    fresh.lastCorrelationRun = { ...(fresh.lastCorrelationRun || {}), running: false, startedAt: null };
    await fresh.save();
    throw err;
  }
}

// Correlate a SINGLE conversation on demand — the dashboard's per-conversation
// "↻ Correlacionar" button. Same tiers/gates/decay as the batch, but scoped to one
// psid so it returns in seconds instead of scanning ~20k convos. It is CONSERVATIVE
// about the rest of the world: it never steals an order already attributed to a
// DIFFERENT conversation (the scheduled batch owns global re-balancing / bijection),
// and it does NOT touch SystemState.lastCorrelationRun (so it can't clash with a batch).
async function correlateOneConversation(psid) {
  if (!psid) return { ok: false, error: "psid requerido" };
  const convo = await Conversation.findOne({ psid }).select(MATCH_FIELDS + " saleOverride").lean();
  if (!convo) return { ok: false, error: "Conversación no encontrada", notFound: true };

  // Rule 7 (human-override lockout): a convo a person already ruled on is INELIGIBLE
  // for (re)correlation — just re-assert the human verdict and return.
  const ov = convo.saleOverride;
  if (ov && (ov.verdict === "sale" || ov.verdict === "no_sale")) {
    await reconcileOverride(psid, convo._id, ov);
    return { ok: true, psid, locked: true, verdict: ov.verdict, matched: ov.verdict === "sale" ? 1 : 0 };
  }

  // Sync ONLY the recent ML sales so a just-made purchase is visible (bounded, non-fatal).
  // This is the whole point of a manual re-correlate: "did this person just buy?"
  try {
    const { backfillLeanSales } = require("./mlSalesLeanImport");
    const latest = await MLSale.findOne({}).sort({ dateCreated: -1 }).select("dateCreated").lean();
    const syncFrom = latest ? new Date(new Date(latest.dateCreated).getTime() - SYNC_BUFFER_DAYS * 864e5) : BACKTRACE_START;
    await backfillLeanSales(SELLER_ID, { startDate: syncFrom, concurrency: 6 });
  } catch (e) { console.error("⚠️ single-convo ml sync failed (continuing):", e.message); }

  // Enrich this one convo if it's still missing identity/basket, then re-read it.
  let fresh = convo;
  if (!convo.aiIdentity || !convo.itemsDiscussed) {
    await enrichBatch([convo]);
    fresh = await Conversation.findOne({ psid }).select(MATCH_FIELDS).lean();
  }

  const ctx = await buildContext();
  let scored = [];
  try { scored = (await matchConversation(fresh, ctx)) || []; } catch (e) { scored = []; }

  // Orders locked by ANY human verdict are ineligible.
  const lockedOrders = new Set(
    (await ConvoSaleMatch.find({ humanVerdict: { $in: ["confirmed", "rejected"] } }).select("orderId").lean())
      .map((m) => String(m.orderId)).filter(Boolean)
  );
  // Orders currently attributed to a DIFFERENT conversation → orderId → that convo's
  // certainty. Mirrors the batch's global rule (highest certainty wins the order): this
  // convo may take an order only from a STRICTLY WEAKER holder; an equal/stronger holder
  // keeps it (the scheduled batch re-balances the loser on its next pass — self-healing).
  const candOrderIds = [...new Set(scored.map((d) => String(d.orderId)))];
  const heldByOther = new Map();
  if (candOrderIds.length) {
    const existing = await ConvoSaleMatch.find({ orderId: { $in: candOrderIds }, psid: { $ne: psid } })
      .select("orderId certainty").lean();
    for (const e of existing) {
      const oid = String(e.orderId), c = e.certainty ?? 0;
      if (!heldByOther.has(oid) || c > heldByOther.get(oid)) heldByOther.set(oid, c);
    }
  }

  // Claim this convo's single best available order (bijection: one convo ↔ one order).
  let claimed = null;
  for (const doc of scored) {
    const oid = String(doc.orderId);
    if (lockedOrders.has(oid)) continue;
    if (heldByOther.has(oid) && heldByOther.get(oid) >= (doc.certainty ?? 0)) continue; // stronger/equal holder keeps it
    claimed = doc;
    break;
  }

  if (claimed) {
    await computeLinkAudit(claimed);
    // Refresh: drop this convo's other (non-human) system matches AND any weaker holder
    // of the claimed order (bijection), then upsert the claim.
    await ConvoSaleMatch.deleteMany({ psid, _id: { $ne: claimed._id }, method: { $ne: "human" } });
    await ConvoSaleMatch.deleteMany({ orderId: claimed.orderId, _id: { $ne: claimed._id }, humanVerdict: null });
    await ConvoSaleMatch.updateOne({ _id: claimed._id }, { $set: claimed }, { upsert: true });
  } else {
    // No qualifying sale now — clear this convo's stale system matches (keep human).
    await ConvoSaleMatch.deleteMany({ psid, method: { $ne: "human" } });
  }
  return {
    ok: true, psid, single: true,
    matched: claimed ? 1 : 0,
    certainty: claimed ? claimed.certainty : null,
    orderId: claimed ? claimed.orderId : null,
    candidates: scored.length,
  };
}

// Apply ONE conversation's human verdict onto the match collection. Called both
// immediately when a human clicks the button AND after every correlation run.
//   no_sale → flag every match for the psid as "rejected" (kept for audit, uncounted)
//   sale    → affirm an existing match, or synthesize one if the system found none
//   null    → clear the flag and drop any synthetic human-only match
async function reconcileOverride(psid, conversationId, ov) {
  const ConvoSaleMatch = require("../models/ConvoSaleMatch");
  const humanId = `${psid}::human`;
  const verdict = ov && ov.verdict;
  const stamp = { humanBy: (ov && ov.by) || null, humanAt: (ov && ov.at) || new Date(), humanNote: (ov && ov.note) || null };

  if (verdict === "no_sale") {
    await ConvoSaleMatch.updateMany({ psid }, { $set: { humanVerdict: "rejected", ...stamp } });
    await ConvoSaleMatch.deleteOne({ _id: humanId }); // a rejected convo has no human-affirmed sale
    return;
  }
  if (verdict === "sale") {
    const matches = await ConvoSaleMatch.find({ psid }).select("_id").lean();
    const hasReal = matches.some((m) => m._id !== humanId);
    if (hasReal) {
      await ConvoSaleMatch.updateMany({ psid, _id: { $ne: humanId } }, { $set: { humanVerdict: "confirmed", ...stamp } });
      await ConvoSaleMatch.deleteOne({ _id: humanId });
    } else {
      await ConvoSaleMatch.updateOne({ _id: humanId }, { $set: {
        _id: humanId, psid, conversationId: conversationId || null, orderId: null,
        certainty: null, confidence: "human", undisputed: true, ventaIndirecta: false,
        reason: "Venta confirmada por un humano (sin orden ligada)",
        signals: { zip: false, city: false, name: false, nickname: false, item: false },
        sale: { orderId: null, dateCreated: stamp.humanAt, status: "human", totalAmount: 0, itemTitle: "Venta confirmada por asesor" },
        method: "human", human: true, humanVerdict: "confirmed", ...stamp, matchedAt: new Date(),
      } }, { upsert: true });
    }
    return;
  }
  // cleared → un-flag system matches, remove any synthetic human match
  await ConvoSaleMatch.updateMany({ psid }, { $set: { humanVerdict: null, humanBy: null, humanAt: null, humanNote: null } });
  await ConvoSaleMatch.deleteOne({ _id: humanId });
}

// Re-apply every stored human verdict (used after a full/incremental rebuild).
async function applySaleOverrides() {
  const Conversation = require("../models/Conversation");
  const overrides = await Conversation.find({ "saleOverride.verdict": { $in: ["sale", "no_sale"] } })
    .select("psid _id saleOverride").lean().catch(() => []);
  for (const o of overrides) {
    try { await reconcileOverride(o.psid, o._id, o.saleOverride); } catch (e) { /* keep going */ }
  }
  return overrides.length;
}

// Freshness helper for the route/gate.
async function correlationStatus() {
  const state = await SystemState.getState();
  const lc = state.lastCorrelationRun || {};
  const at = lc.at ? new Date(lc.at) : null;
  const ageHours = at ? (Date.now() - at.getTime()) / 3600e3 : Infinity;
  return {
    lastRun: at,
    ageHours: at ? Math.round(ageHours * 10) / 10 : null,
    stale: ageHours > FRESH_HOURS,
    running: !!lc.running,
    stats: lc.stats || null,
    freshHours: FRESH_HOURS,
    // when the next scheduled (30-min) correlation is due → dashboard countdown
    nextAt: state.correlationNextAt || null,
  };
}

module.exports = { runConvoCorrelation, correlateOneConversation, correlationStatus, reconcileOverride, applySaleOverrides, FRESH_HOURS };
