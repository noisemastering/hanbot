// utils/mlOrderRawImport.js
//
// Backfills our own first-party copy of ALL Mercado Libre sales data, stored
// verbatim (the exact schema ML delivers) into the ml_orders_raw collection.
//
// Strategy mirrors the proven mlOrderImport.js: weekly date windows (to stay
// under ML's 10,000-offset limit) swept across BOTH the recent and archived
// order endpoints, with retry/backoff + rate-limit handling. The difference:
// here we UPSERT the raw order object as-is instead of normalizing it.

const axios = require("axios");
const { getValidAccessToken } = require("./mercadoLibreOAuth");
const MLOrderRaw = require("../models/MLOrderRaw");

const ML_ORDERS_API = "https://api.mercadolibre.com/orders/search";
const ML_ORDERS_ARCHIVED = `${ML_ORDERS_API}/archived`;
const PAGE_SIZE = 50;
const DELAY_BETWEEN_PAGES = 250; // ms
const DELAY_BETWEEN_WINDOWS = 300; // ms
const MAX_RETRIES = 4;
const OFFSET_CAP = 10000; // ML hard limit on offset

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const toMLDate = (d) => d.toISOString().replace("Z", "-00:00");
const ymd = (d) => d.toISOString().slice(0, 10);

/** Weekly [from,to] windows from startDate to now (each < ML's 10K offset limit). */
function weeklyWindows(startDate) {
  const windows = [];
  const now = new Date();
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  let cur = new Date(startDate);
  while (cur < now) {
    const from = new Date(cur);
    const to = new Date(cur.getTime() + WEEK - 1);
    windows.push({ from, to: to > now ? now : to });
    cur = new Date(cur.getTime() + WEEK);
  }
  return windows;
}

/** Fetch one page of orders with retry/backoff + 429 handling. */
async function fetchPage(token, endpoint, params, retries = 0) {
  const { seller, offset, from, to, limit = PAGE_SIZE, sort = "date_asc" } = params;
  const qs = new URLSearchParams({
    seller: String(seller),
    sort,
    limit: String(limit),
    offset: String(offset),
  });
  if (from) qs.set("order.date_created.from", from);
  if (to) qs.set("order.date_created.to", to);
  const url = `${endpoint}?${qs.toString()}`;

  try {
    const res = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": "HanlobBot/1.0",
      },
      proxy: false,
      timeout: 30000,
      validateStatus: (s) => s < 500,
    });

    if (res.status === 429) {
      const wait = Math.min(60000, parseInt(res.headers["retry-after"] || "5", 10) * 1000);
      if (retries < MAX_RETRIES) {
        await sleep(wait);
        return fetchPage(token, endpoint, params, retries + 1);
      }
      throw new Error("rate limited too many times");
    }
    if (res.status >= 400) {
      throw new Error(`ML API ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}`);
    }
    const ct = res.headers["content-type"] || "";
    if (ct.includes("text/html")) throw new Error("ML returned HTML instead of JSON");
    return res.data;
  } catch (err) {
    if (retries < MAX_RETRIES) {
      await sleep(Math.min(30000, 1000 * 2 ** retries));
      return fetchPage(token, endpoint, params, retries + 1);
    }
    throw err;
  }
}

/** Upsert a batch of raw order objects verbatim. */
async function upsertRaw(orders, sellerId, source) {
  if (!orders || !orders.length) return { inserted: 0, modified: 0 };
  const ops = orders
    .filter((o) => o && o.id != null)
    .map((o) => ({
      updateOne: {
        filter: { _id: String(o.id) },
        update: {
          $set: {
            ...o, // the ENTIRE ML order object, as delivered
            _sellerId: String(sellerId),
            _source: source,
            _syncedAt: new Date(),
          },
        },
        upsert: true,
      },
    }));
  if (!ops.length) return { inserted: 0, modified: 0 };
  const res = await MLOrderRaw.bulkWrite(ops, { ordered: false });
  return { inserted: res.upsertedCount || 0, modified: res.modifiedCount || 0 };
}

/** Probe both endpoints for the seller's very first order date (date_asc, offset 0). */
async function earliestOrderDate(sellerId, token) {
  let earliest = null;
  const from = "2010-01-01T00:00:00.000-00:00";
  const to = toMLDate(new Date());
  for (const endpoint of [ML_ORDERS_API, ML_ORDERS_ARCHIVED]) {
    try {
      const data = await fetchPage(token, endpoint, {
        seller: sellerId,
        offset: 0,
        from,
        to,
        limit: 1,
        sort: "date_asc",
      });
      const d = data.results && data.results[0] && data.results[0].date_created;
      if (d) {
        const dt = new Date(d);
        if (!earliest || dt < earliest) earliest = dt;
      }
    } catch (e) {
      /* endpoint may be empty — ignore */
    }
  }
  return earliest;
}

/**
 * Backfill ALL orders (recent + archived) from the earliest available date into
 * ml_orders_raw. Idempotent: safe to re-run (upserts refresh existing orders).
 *
 * @param {string} sellerId
 * @param {object} opts
 * @param {Date|string} [opts.startDate] override auto-detected earliest date
 * @param {function} [opts.onProgress] (stats, label) => void
 * @returns {Promise<object>} stats
 */
async function backfillRawOrders(sellerId, opts = {}) {
  const token0 = (await getValidAccessToken(sellerId)).trim();

  const detected = opts.startDate ? new Date(opts.startDate) : await earliestOrderDate(sellerId, token0);
  const start = detected || new Date(Date.now() - 6 * 365 * 24 * 60 * 60 * 1000);
  const windows = weeklyWindows(start);

  const stats = {
    sellerId: String(sellerId),
    earliestDate: start,
    inserted: 0,
    modified: 0,
    ordersSeen: 0,
    windowsTotal: windows.length * 2,
    windowsDone: 0,
    overflowWindows: [],
    errors: [],
    startedAt: new Date(),
  };

  for (const [source, endpoint] of [
    ["recent", ML_ORDERS_API],
    ["archived", ML_ORDERS_ARCHIVED],
  ]) {
    for (const w of windows) {
      let total = 0;
      try {
        const token = (await getValidAccessToken(sellerId)).trim();
        const first = await fetchPage(token, endpoint, {
          seller: sellerId,
          offset: 0,
          from: toMLDate(w.from),
          to: toMLDate(w.to),
        });
        total = (first.paging && first.paging.total) || 0;

        if (total > 0) {
          stats.ordersSeen += total;
          const r0 = await upsertRaw(first.results, sellerId, source);
          stats.inserted += r0.inserted;
          stats.modified += r0.modified;

          const maxOffset = Math.min(total, OFFSET_CAP);
          for (let off = PAGE_SIZE; off < maxOffset; off += PAGE_SIZE) {
            await sleep(DELAY_BETWEEN_PAGES);
            try {
              const page = await fetchPage(token, endpoint, {
                seller: sellerId,
                offset: off,
                from: toMLDate(w.from),
                to: toMLDate(w.to),
              });
              const r = await upsertRaw(page.results, sellerId, source);
              stats.inserted += r.inserted;
              stats.modified += r.modified;
            } catch (pageErr) {
              stats.errors.push(`${source}:${ymd(w.from)}:offset${off}: ${pageErr.message}`);
            }
          }

          if (total > OFFSET_CAP) {
            // A single week exceeded ML's offset ceiling — flag it (needs finer windows).
            stats.overflowWindows.push(`${source} ${ymd(w.from)}→${ymd(w.to)}: ${total} orders`);
          }
        }
      } catch (windowErr) {
        stats.errors.push(`${source}:${ymd(w.from)}→${ymd(w.to)}: ${windowErr.message}`);
      }

      stats.windowsDone++;
      if (typeof opts.onProgress === "function") {
        opts.onProgress(stats, `${source} ${ymd(w.from)}→${ymd(w.to)} total=${total}`);
      }
      await sleep(DELAY_BETWEEN_WINDOWS);
    }
  }

  stats.completedAt = new Date();
  return stats;
}

module.exports = {
  backfillRawOrders,
  earliestOrderDate,
  weeklyWindows,
  ML_ORDERS_API,
  ML_ORDERS_ARCHIVED,
};
