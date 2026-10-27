// utils/adOrigin.js
//
// "Which ad did this conversation come from?" — in a form a human can read.
//
// The data was always captured on both channels (Messenger stores referral.ad_id,
// WhatsApp CTWA stores referral.source_id plus the ad's own headline/body), but the
// dashboard only ever had the raw numeric id, which tells an asesor nothing. On
// WhatsApp that was the whole story: a number appears, and nobody knows which campaign
// it answered. Reported 2026-10-27.
//
// resolveByAdId (campaignResolver) walks Ad → AdSet → Campaign one id at a time, which
// is right for a single conversation and wrong for a list of thirty. This batches the
// three collections into three queries total and caches briefly, because an ad's NAME
// changes far less often than the conversation list is refreshed.

const CACHE_TTL_MS = 5 * 60 * 1000;
let _cache = { at: 0, byAdId: new Map() };

/**
 * Resolve many Facebook ad ids to their human-readable names in three queries.
 *
 * @param {string[]} adIds
 * @returns {Promise<Map<string, {adName: string|null, adSetName: string|null, campaignName: string|null, adStatus: string|null}>>}
 */
async function resolveAdNames(adIds) {
  const wanted = [...new Set((adIds || []).filter(Boolean).map(String))];
  if (!wanted.length) return new Map();

  const fresh = Date.now() - _cache.at < CACHE_TTL_MS;
  const missing = fresh ? wanted.filter((id) => !_cache.byAdId.has(id)) : wanted;
  if (!fresh) _cache = { at: Date.now(), byAdId: new Map() };
  if (!missing.length) return _cache.byAdId;

  try {
    const Ad = require("../models/Ad");
    const AdSet = require("../models/AdSet");
    const Campaign = require("../models/Campaign");

    const ads = await Ad.find({ fbAdId: { $in: missing } })
      .select("fbAdId name status adSetId")
      .lean();
    const adSets = await AdSet.find({ _id: { $in: ads.map((a) => a.adSetId).filter(Boolean) } })
      .select("name campaignId")
      .lean();
    const setById = new Map(adSets.map((s) => [String(s._id), s]));
    const campaigns = await Campaign.find({ _id: { $in: adSets.map((s) => s.campaignId).filter(Boolean) } })
      .select("name")
      .lean();
    const campById = new Map(campaigns.map((c) => [String(c._id), c]));

    for (const a of ads) {
      const set = a.adSetId ? setById.get(String(a.adSetId)) : null;
      const camp = set && set.campaignId ? campById.get(String(set.campaignId)) : null;
      _cache.byAdId.set(String(a.fbAdId), {
        adName: a.name || null,
        adSetName: set ? set.name || null : null,
        campaignName: camp ? camp.name || null : null,
        adStatus: a.status || null,
      });
    }
    // Remember the misses too, so an ad we don't have a doc for (a brand-new ad, or one
    // created outside the dashboard) doesn't re-query on every refresh.
    for (const id of missing) if (!_cache.byAdId.has(id)) _cache.byAdId.set(id, null);
  } catch (e) {
    console.error("⚠️ resolveAdNames failed:", e.message);
  }
  return _cache.byAdId;
}

/**
 * The display label for one conversation's origin. Falls back down the chain, because
 * each step can be missing for a real reason:
 *   Ad name          — the dashboard knows this ad
 *   Campaign name    — the Ad doc is missing but the chain isn't
 *   WhatsApp headline— CTWA gives us the ad's own headline even with no Ad doc at all,
 *                      which is the common case for a brand-new ad
 *   "Anuncio <id>"   — we at least know it came from an ad
 *   null             — organic: no ad, and saying "unknown ad" would be a lie
 */
function originLabel(convo, names) {
  if (!convo) return null;
  const id = convo.adId ? String(convo.adId) : null;
  const n = id && names ? names.get(id) : null;
  const headline = convo.adHeadline ? String(convo.adHeadline).trim() : null;
  if (n && n.adName) return n.adName;
  if (n && n.campaignName) return n.campaignName;
  if (headline) return headline;
  if (id) return `Anuncio ${id.slice(-6)}`;
  return null;
}

/** Everything the dashboard needs to show where a conversation came from. */
function originOf(convo, names) {
  if (!convo) return null;
  const id = convo.adId ? String(convo.adId) : null;
  const n = id && names ? names.get(id) : null;
  if (!id && !convo.adHeadline) {
    // No ad at all. Organic traffic is a real, meaningful answer — not a gap.
    return { organic: true, label: null, adId: null };
  }
  return {
    organic: false,
    label: originLabel(convo, names),
    adId: id,
    adName: n ? n.adName : null,
    adSetName: n ? n.adSetName : null,
    campaignName: n ? n.campaignName : null,
    adStatus: n ? n.adStatus : null,
    // WhatsApp CTWA carries the ad's own copy, which is often the only human-readable
    // thing we have for an ad that was never imported into the dashboard.
    headline: convo.adHeadline || null,
    sourceUrl: convo.adSourceUrl || null,
    ctwa: !!convo.ctwaClid,
  };
}

module.exports = { resolveAdNames, originLabel, originOf };
