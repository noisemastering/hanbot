// jobs/utils/clickConversionStatus.js
//
// Tells the silence-follow-up job whether a customer:
//   - never clicked the link we sent  → state: 'no_click'
//   - clicked but didn't buy          → state: 'abandoned'
//   - clicked AND a purchase landed   → state: 'converted'
//
// Uses ClickLog as the source of truth (the correlation pipeline already
// populates `converted` whenever an ML order is matched to a click). Adds
// one optional belt-and-suspenders sweep: before the batch runs, pull
// orders ML created in the last MAX_RECENT_MINUTES and run the existing
// correlator over them, so a sale that landed minutes before the
// follow-up still influences the message we send.

const ClickLog = require("../../models/ClickLog");
const { getOrders } = require("../../utils/mercadoLibreOrders");
const { correlateOrders } = require("../../utils/conversionCorrelation");

const MAX_RECENT_MINUTES = 60; // window for the catch-up sweep
const SELLER_ID = process.env.ML_SELLER_ID || "482595248";

/**
 * Pull orders ML registered in the last N minutes and run them through the
 * correlator. ONE ML API call per follow-up batch — not per PSID.
 * Best effort: any failure is logged and ignored so the follow-up job still
 * proceeds with the data we already have.
 */
async function sweepRecentOrdersOnce({ minutes = MAX_RECENT_MINUTES, sellerId = SELLER_ID } = {}) {
  try {
    const since = new Date(Date.now() - minutes * 60 * 1000);
    const dateFrom = since.toISOString().replace("Z", "-00:00");
    const dateTo = new Date().toISOString().replace("Z", "-00:00");

    const result = await getOrders(sellerId, {
      limit: 50,
      sort: "date_desc",
      dateFrom,
      dateTo
    });

    if (!result?.success || !result.orders?.length) return { swept: 0, correlated: 0 };

    const paid = result.orders.filter(o => o.status === "paid");
    if (paid.length === 0) return { swept: 0, correlated: 0 };

    const summary = await correlateOrders(paid, sellerId);
    return {
      swept: paid.length,
      correlated: summary.correlated || 0,
      alreadyCorrelated: summary.alreadyCorrelated || 0
    };
  } catch (err) {
    console.warn(`⚠️ Recent ML sweep failed (continuing without it): ${err.message}`);
    return { swept: 0, correlated: 0, error: err.message };
  }
}

/**
 * Whether a `converted` ClickLog is trustworthy enough to TELL the customer they
 * bought ("¡Gracias por tu compra!"). This is INTENTIONALLY stricter than the
 * stored `correlationConfidence` used for sales reporting: that field rates an
 * ML-item-id match as 'high' (a real order, kept for reporting), but item-id
 * alone can credit the wrong clicker on a popular listing (Pita ← Leonardo's
 * order). Before asserting a purchase to a PERSON, require a corroborating
 * identity signal — buyer name/nickname matched, or an exact shipping zip.
 * (City/state alone is too coarse.) Missing matchDetails → not trustworthy.
 *
 * Gates the MESSAGE only; reporting/attribution is unchanged on purpose.
 */
function isConversionHighConfidence(click) {
  const md = click && click.matchDetails;
  if (!md || typeof md !== "object") return false;
  return !!(md.nameMatch || md.nicknameMatch || md.zipMatch);
}

/**
 * Resolve the click/conversion state for a single PSID by reading the latest
 * ClickLog row for them. No ML calls — pure DB lookup.
 *
 * @returns {Promise<{ state: 'no_click'|'abandoned'|'converted', click?: object, highConfidence?: boolean }>}
 */
async function getClickStatusForPsid(psid) {
  if (!psid) return { state: "no_click" };

  // Most recent click record for this PSID (any link)
  const latest = await ClickLog.findOne({ psid })
    .sort({ createdAt: -1 })
    .select("clicked clickedAt converted convertedAt conversionData productName matchDetails correlationMethod")
    .lean();

  if (!latest) return { state: "no_click" };

  if (latest.converted) {
    return { state: "converted", click: latest, highConfidence: isConversionHighConfidence(latest) };
  }
  if (latest.clicked) return { state: "abandoned", click: latest };
  return { state: "no_click", click: latest };
}

module.exports = {
  sweepRecentOrdersOnce,
  getClickStatusForPsid,
  isConversionHighConfidence
};
