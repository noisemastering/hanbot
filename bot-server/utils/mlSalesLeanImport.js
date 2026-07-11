// utils/mlSalesLeanImport.js
//
// Builds our first-party LEAN sales record (models/MLSale): one doc per ML order
// in a date window, with the ship-to address merged in from /shipments/{id}.
// Fits the free-tier cluster (~0.8KB/doc). Idempotent (upsert by order id).
//
// Includes a STORAGE GUARD: before each window it checks cluster headroom and
// aborts cleanly if usage would approach the 512MB cap — so an import can never
// block writes cluster-wide again.

const axios = require("axios");
const mongoose = require("mongoose");
const { getValidAccessToken } = require("./mercadoLibreOAuth");

const ML_ORDERS_API = "https://api.mercadolibre.com/orders/search";
const ML_SHIP_API = "https://api.mercadolibre.com/shipments";
const PAGE_SIZE = 50;
const OFFSET_CAP = 10000;
const MAX_RETRIES = 4;
const DELAY_BETWEEN_PAGES = 200;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const toMLDate = (d) => d.toISOString().replace("Z", "-00:00");
const ymd = (d) => d.toISOString().slice(0, 10);

function weeklyWindows(startDate, endDate) {
  const windows = [];
  const end = endDate ? new Date(endDate) : new Date();
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  let cur = new Date(startDate);
  while (cur < end) {
    const from = new Date(cur);
    const to = new Date(cur.getTime() + WEEK - 1);
    windows.push({ from, to: to > end ? end : to });
    cur = new Date(cur.getTime() + WEEK);
  }
  return windows;
}

async function httpGet(url, token, retries = 0) {
  try {
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "User-Agent": "HanlobBot/1.0" },
      proxy: false,
      timeout: 30000,
      validateStatus: (s) => s < 600,
    });
    if (res.status === 429) {
      if (retries < MAX_RETRIES) {
        const wait = Math.min(60000, parseInt(res.headers["retry-after"] || "5", 10) * 1000);
        await sleep(wait);
        return httpGet(url, token, retries + 1);
      }
    }
    return { status: res.status, data: res.data };
  } catch (err) {
    if (retries < MAX_RETRIES) {
      await sleep(Math.min(30000, 1000 * 2 ** retries));
      return httpGet(url, token, retries + 1);
    }
    return { status: 0, data: null, error: err.message };
  }
}

/** All orders in a window (recent endpoint covers the full 12-month range). */
async function fetchAllOrdersInWindow(token, sellerId, w) {
  const base = (offset) =>
    `${ML_ORDERS_API}?seller=${sellerId}&sort=date_asc&limit=${PAGE_SIZE}&offset=${offset}` +
    `&order.date_created.from=${encodeURIComponent(toMLDate(w.from))}` +
    `&order.date_created.to=${encodeURIComponent(toMLDate(w.to))}`;

  const out = [];
  const first = await httpGet(base(0), token);
  if (first.status >= 400 || !first.data) return out;
  const total = (first.data.paging && first.data.paging.total) || 0;
  if (first.data.results) out.push(...first.data.results);
  const maxOffset = Math.min(total, OFFSET_CAP);
  for (let off = PAGE_SIZE; off < maxOffset; off += PAGE_SIZE) {
    await sleep(DELAY_BETWEEN_PAGES);
    const page = await httpGet(base(off), token);
    if (page.data && page.data.results) out.push(...page.data.results);
  }
  return out;
}

function leanOrder(o) {
  return {
    _id: String(o.id),
    sellerId: String((o.seller && o.seller.id) || ""),
    dateCreated: o.date_created ? new Date(o.date_created) : null,
    dateClosed: o.date_closed ? new Date(o.date_closed) : null,
    status: o.status || null,
    statusDetail: o.status_detail || null,
    tags: Array.isArray(o.tags) && o.tags.length ? o.tags : undefined,
    totalAmount: o.total_amount != null ? o.total_amount : null,
    paidAmount: o.paid_amount != null ? o.paid_amount : null,
    currencyId: o.currency_id || null,
    packId: o.pack_id != null ? String(o.pack_id) : null,
    buyer: {
      id: String((o.buyer && o.buyer.id) || ""),
      nickname: (o.buyer && o.buyer.nickname) || null,
      firstName: (o.buyer && o.buyer.first_name) || null,
      lastName: (o.buyer && o.buyer.last_name) || null,
    },
    items: (o.order_items || []).map((it) => ({
      itemId: (it.item && it.item.id) || null,
      title: (it.item && it.item.title) || null,
      categoryId: (it.item && it.item.category_id) || null,
      quantity: it.quantity || 0,
      unitPrice: it.unit_price || 0,
      sellerSku: (it.item && (it.item.seller_sku || it.item.seller_custom_field)) || null,
      variationId: it.item && it.item.variation_id != null ? String(it.item.variation_id) : null,
    })),
    shippingId: o.shipping && o.shipping.id != null ? String(o.shipping.id) : null,
  };
}

function leanShipping(shipId, ship, httpStatus) {
  if (!ship || httpStatus >= 400 || httpStatus === 0) {
    return { id: String(shipId), fetched: false, httpStatus: httpStatus || null };
  }
  const a = ship.receiver_address || {};
  return {
    id: String(shipId),
    status: ship.status || null,
    substatus: ship.substatus || null,
    logisticType: ship.logistic_type || (ship.logistic && ship.logistic.type) || null,
    zip: a.zip_code || null,
    city: (a.city && a.city.name) || null,
    state: (a.state && a.state.name) || null,
    municipality: (a.municipality && a.municipality.name) || null,
    neighborhood: (a.neighborhood && a.neighborhood.name) || null,
    streetName: a.street_name || null,
    streetNumber: a.street_number || null,
    addressLine: a.address_line || null,
    receiverName: a.receiver_name || null,
    receiverPhone: a.receiver_phone || null,
    country: (a.country && (a.country.id || a.country.name)) || null,
    lat: a.latitude != null ? a.latitude : null,
    lng: a.longitude != null ? a.longitude : null,
    fetched: true,
    httpStatus: httpStatus || 200,
  };
}

/** Concurrency pool. */
async function pool(items, concurrency, worker) {
  let i = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length || 1) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
}

async function usedMB() {
  const st = await mongoose.connection.db.stats();
  return (st.dataSize + st.indexSize) / 1048576;
}

/**
 * Backfill lean sales (orders + merged shipment address) from startDate to now.
 * @param {string} sellerId
 * @param {object} opts { startDate, concurrency, headroomAbortMB, onProgress }
 */
async function backfillLeanSales(sellerId, opts = {}) {
  const MLSale = require("../models/MLSale");
  const startDate = new Date(opts.startDate || "2025-12-01T00:00:00.000Z");
  const endDate = opts.endDate ? new Date(opts.endDate) : null;
  const concurrency = opts.concurrency || 6;
  const headroomAbortMB = opts.headroomAbortMB || 470; // hard stop well under the 512MB cap
  const windows = weeklyWindows(startDate, endDate);

  const stats = {
    sellerId: String(sellerId),
    startDate,
    orders: 0,
    shipmentsFetched: 0,
    shipmentsFailed: 0,
    withZip: 0,
    upserted: 0,
    windowsTotal: windows.length,
    windowsDone: 0,
    aborted: null,
    errors: [],
    startedAt: new Date(),
  };

  for (const w of windows) {
    // STORAGE GUARD — never fill the cluster again.
    const mb = await usedMB();
    if (mb > headroomAbortMB) {
      stats.aborted = `storage ${mb.toFixed(0)}MB exceeded guard ${headroomAbortMB}MB — stopped before ${ymd(w.from)}`;
      break;
    }

    let orders = [];
    try {
      const token = (await getValidAccessToken(sellerId)).trim();
      orders = await fetchAllOrdersInWindow(token, sellerId, w);
      stats.orders += orders.length;

      const leanDocs = [];
      const token2 = token;
      await pool(orders, concurrency, async (o) => {
        const lo = leanOrder(o);
        if (lo.shippingId) {
          const { status, data } = await httpGet(`${ML_SHIP_API}/${lo.shippingId}`, token2);
          lo.shipping = leanShipping(lo.shippingId, status < 400 ? data : null, status);
          if (status < 400 && data) stats.shipmentsFetched++;
          else stats.shipmentsFailed++;
          if (lo.shipping.zip) stats.withZip++;
        }
        lo.syncedAt = new Date();
        leanDocs.push(lo);
      });

      if (leanDocs.length) {
        const ops = leanDocs.map((d) => ({
          updateOne: { filter: { _id: d._id }, update: { $set: d }, upsert: true },
        }));
        const res = await MLSale.bulkWrite(ops, { ordered: false });
        stats.upserted += (res.upsertedCount || 0) + (res.modifiedCount || 0);
      }
    } catch (err) {
      stats.errors.push(`${ymd(w.from)}: ${err.message}`);
    }

    stats.windowsDone++;
    if (typeof opts.onProgress === "function") {
      opts.onProgress(stats, `${ymd(w.from)}→${ymd(w.to)} orders=${orders.length}`);
    }
    await sleep(150);
  }

  stats.completedAt = new Date();
  return stats;
}

module.exports = { backfillLeanSales, weeklyWindows, leanOrder, leanShipping };
