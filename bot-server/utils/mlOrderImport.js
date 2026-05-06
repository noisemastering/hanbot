// utils/mlOrderImport.js
// Historical ML order import — fetches all orders via ML API,
// stores in MLOrder collection. Handles pagination, date windowing,
// rate limiting, and deduplication.

const axios = require("axios");
const { getValidAccessToken } = require("./mercadoLibreOAuth");
const MLOrder = require("../models/MLOrder");

const ML_ORDERS_API = "https://api.mercadolibre.com/orders/search";
const PAGE_SIZE = 50;
const DELAY_BETWEEN_PAGES = 250;    // ms
const DELAY_BETWEEN_WINDOWS = 500;  // ms
const MAX_RETRIES = 3;

// In-memory progress tracking (keyed by sellerId)
const progressMap = new Map();

function toMLDate(date) {
  return date.toISOString().replace('Z', '-00:00');
}

/**
 * Generate monthly date windows from startDate to now.
 */
function generateMonthlyWindows(startDate) {
  const windows = [];
  const now = new Date();
  let current = new Date(startDate);

  while (current < now) {
    const from = new Date(current);
    const to = new Date(current.getFullYear(), current.getMonth() + 1, 0, 23, 59, 59);
    windows.push({
      from: from > now ? now : from,
      to: to > now ? now : to
    });
    current = new Date(current.getFullYear(), current.getMonth() + 1, 1);
  }

  return windows;
}

/**
 * Fetch a single page of orders from ML API.
 */
async function fetchPage(sellerId, accessToken, params, retries = 0) {
  const queryParams = new URLSearchParams({
    seller: sellerId,
    sort: 'date_asc',
    limit: PAGE_SIZE.toString(),
    offset: params.offset.toString(),
    'order.date_created.from': params.dateFrom,
    'order.date_created.to': params.dateTo
  });

  const url = `${params.endpoint}?${queryParams.toString()}`;

  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'User-Agent': 'HanlobBot/1.0'
      },
      proxy: false,
      validateStatus: (status) => status < 500
    });

    if (response.status === 429) {
      const retryAfter = parseInt(response.headers['retry-after'] || '5') * 1000;
      console.log(`⏳ Rate limited, waiting ${retryAfter}ms`);
      await sleep(retryAfter);
      return fetchPage(sellerId, accessToken, params, retries);
    }

    if (response.status >= 400) {
      throw Object.assign(new Error(`ML API ${response.status}`), { response });
    }

    const contentType = response.headers['content-type'] || '';
    if (contentType.includes('text/html')) {
      throw new Error('ML returned HTML instead of JSON');
    }

    return response.data;
  } catch (err) {
    if (retries < MAX_RETRIES) {
      const backoff = Math.min(30000, 1000 * Math.pow(2, retries));
      console.log(`⚠️ Retry ${retries + 1}/${MAX_RETRIES} in ${backoff}ms: ${err.message}`);
      await sleep(backoff);
      return fetchPage(sellerId, accessToken, params, retries + 1);
    }
    throw err;
  }
}

/**
 * Save a batch of ML orders into the database.
 */
async function saveOrderBatch(orders, batchId, source) {
  let imported = 0;
  let skipped = 0;

  for (const order of orders) {
    const doc = {
      mlOrderId: String(order.id),
      sellerId: String(order.buyer?.id ? order.seller?.id || '' : ''),
      dateCreated: new Date(order.date_created),
      dateClosed: order.date_closed ? new Date(order.date_closed) : null,
      status: order.status,
      totalAmount: order.total_amount,
      paidAmount: order.paid_amount,
      currencyId: order.currency_id || 'MXN',
      buyer: {
        mlBuyerId: String(order.buyer?.id || ''),
        nickname: order.buyer?.nickname || '',
        firstName: order.buyer?.first_name || '',
        lastName: order.buyer?.last_name || ''
      },
      items: (order.order_items || []).map(item => ({
        mlItemId: item.item?.id || '',
        title: item.item?.title || '',
        categoryId: item.item?.category_id || '',
        quantity: item.quantity || 1,
        unitPrice: item.unit_price || 0
      })),
      importBatchId: batchId,
      source
    };

    try {
      const result = await MLOrder.findOneAndUpdate(
        { mlOrderId: doc.mlOrderId },
        { $set: doc },
        { upsert: true, new: true }
      );
      // If createdAt roughly equals updatedAt, it was a new insert
      const isNew = Math.abs(result.createdAt - result.updatedAt) < 1000;
      if (isNew) imported++;
      else skipped++;
    } catch (err) {
      if (err.code === 11000) skipped++; // Duplicate
      else console.error(`❌ Error saving order ${doc.mlOrderId}:`, err.message);
    }
  }

  return { imported, skipped };
}

/**
 * Import all historical orders for a seller.
 * Runs as a background task — call getProgress() to check status.
 */
async function importAllOrders(sellerId, options = {}) {
  const startDate = options.startDate || new Date(Date.now() - 5 * 365 * 24 * 60 * 60 * 1000); // 5 years ago
  const batchId = `import_${Date.now()}`;

  // Prevent concurrent imports
  const existing = progressMap.get(sellerId);
  if (existing?.status === 'running') {
    return { error: 'Import already running', batchId: existing.batchId };
  }

  const progress = {
    status: 'running',
    batchId,
    startedAt: new Date(),
    phase: 'recent',
    totalEstimate: 0,
    imported: 0,
    skipped: 0,
    errors: [],
    currentWindow: '',
    windowsTotal: 0,
    windowsDone: 0
  };
  progressMap.set(sellerId, progress);

  // Run in background
  (async () => {
    try {
      const windows = generateMonthlyWindows(startDate);
      progress.windowsTotal = windows.length * 2; // recent + archived

      // Phase 1: Recent orders
      progress.phase = 'recent';
      await processWindows(sellerId, windows, ML_ORDERS_API, batchId, 'recent', progress);

      // Phase 2: Archived orders
      progress.phase = 'archived';
      await processWindows(sellerId, windows, `${ML_ORDERS_API}/archived`, batchId, 'archived', progress);

      progress.status = 'completed';
      progress.completedAt = new Date();
      console.log(`✅ Import complete for seller ${sellerId}: ${progress.imported} imported, ${progress.skipped} skipped`);
    } catch (err) {
      progress.status = 'error';
      progress.error = err.message;
      console.error(`❌ Import failed for seller ${sellerId}:`, err.message);
    }
  })();

  return { batchId, status: 'started' };
}

/**
 * Process all date windows against a specific endpoint.
 */
async function processWindows(sellerId, windows, endpoint, batchId, source, progress) {
  for (const window of windows) {
    progress.currentWindow = `${window.from.toISOString().split('T')[0]} → ${window.to.toISOString().split('T')[0]}`;

    if (progress.status !== 'running') break; // Stop if cancelled

    try {
      const accessToken = (await getValidAccessToken(sellerId)).trim();

      // First page — get total count
      const firstPage = await fetchPage(sellerId, accessToken, {
        endpoint,
        offset: 0,
        dateFrom: toMLDate(window.from),
        dateTo: toMLDate(window.to)
      });

      const total = firstPage.paging?.total || 0;
      if (total === 0) {
        progress.windowsDone++;
        await sleep(DELAY_BETWEEN_WINDOWS);
        continue;
      }

      progress.totalEstimate += total;

      // Save first page
      if (firstPage.results?.length > 0) {
        const result = await saveOrderBatch(firstPage.results, batchId, source);
        progress.imported += result.imported;
        progress.skipped += result.skipped;
      }

      // Paginate remaining
      const maxOffset = Math.min(total, 10000);
      for (let offset = PAGE_SIZE; offset < maxOffset; offset += PAGE_SIZE) {
        if (progress.status !== 'running') break;

        await sleep(DELAY_BETWEEN_PAGES);
        try {
          const page = await fetchPage(sellerId, accessToken, {
            endpoint,
            offset,
            dateFrom: toMLDate(window.from),
            dateTo: toMLDate(window.to)
          });

          if (page.results?.length > 0) {
            const result = await saveOrderBatch(page.results, batchId, source);
            progress.imported += result.imported;
            progress.skipped += result.skipped;
          }
        } catch (pageErr) {
          progress.errors.push(`${source}:${window.from.toISOString().split('T')[0]}:offset${offset}: ${pageErr.message}`);
        }
      }

      // If total > 10000, use weekly sub-windows
      if (total > 9000) {
        console.log(`⚠️ Window ${progress.currentWindow} has ${total} orders — would need sub-windowing (TODO)`);
      }

    } catch (windowErr) {
      progress.errors.push(`${source}:${progress.currentWindow}: ${windowErr.message}`);
    }

    progress.windowsDone++;
    await sleep(DELAY_BETWEEN_WINDOWS);
  }
}

function getProgress(sellerId) {
  return progressMap.get(sellerId) || null;
}

function stopImport(sellerId) {
  const progress = progressMap.get(sellerId);
  if (progress?.status === 'running') {
    progress.status = 'cancelled';
    return true;
  }
  return false;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  importAllOrders,
  getProgress,
  stopImport
};
