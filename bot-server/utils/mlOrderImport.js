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
 * Returns { imported, skipped }
 */
async function saveOrderBatch(orders, batchId, source) {
  let imported = 0;
  let skipped = 0;

  for (const order of orders) {
    const doc = {
      mlOrderId: String(order.id),
      sellerId: String(order.seller?.id || ''),
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
      const exists = await MLOrder.exists({ mlOrderId: doc.mlOrderId });
      if (exists) {
        skipped++;
        continue;
      }
      await MLOrder.create(doc);
      imported++;
    } catch (err) {
      if (err.code === 11000) skipped++;
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
  // Prevent concurrent imports
  const existing = progressMap.get(sellerId);
  if (existing?.status === 'running') {
    return { error: 'Import already running', batchId: existing.batchId };
  }

  // Smart start date: resume from last imported order, or go back 5 years
  let startDate = options.startDate;
  if (!startDate) {
    const latest = await MLOrder.findOne({ sellerId }).sort({ dateCreated: -1 }).select('dateCreated').lean();
    if (latest?.dateCreated) {
      // Start from 1 day before the last imported order (overlap to catch stragglers)
      startDate = new Date(latest.dateCreated.getTime() - 24 * 60 * 60 * 1000);
      console.log(`📅 Resuming import from ${startDate.toISOString().split('T')[0]} (last order: ${latest.dateCreated.toISOString().split('T')[0]})`);
    } else {
      startDate = new Date(Date.now() - 5 * 365 * 24 * 60 * 60 * 1000); // 5 years ago
      console.log(`📅 Fresh import starting from ${startDate.toISOString().split('T')[0]}`);
    }
  }

  const batchId = `import_${Date.now()}`;
  const windows = generateMonthlyWindows(startDate);
  const totalPages = windows.length * 2; // rough estimate, 2 phases

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
    windowsTotal: windows.length * 2,
    windowsDone: 0,
    pagesProcessed: 0,
    pagesTotal: 0
  };
  progressMap.set(sellerId, progress);

  // Run in background
  (async () => {
    try {
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

    if (progress.status !== 'running') break;

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

      const windowPages = Math.ceil(total / PAGE_SIZE);
      progress.pagesTotal += windowPages;
      progress.totalEstimate += total;

      // Save first page
      let windowAllExisting = true;
      if (firstPage.results?.length > 0) {
        const result = await saveOrderBatch(firstPage.results, batchId, source);
        progress.imported += result.imported;
        progress.skipped += result.skipped;
        progress.pagesProcessed++;
        if (result.imported > 0) windowAllExisting = false;
      }

      // Smart skip: if first page is 100% existing and this is a re-import,
      // check one more page. If also all existing, skip the rest of this window.
      if (windowAllExisting && total > PAGE_SIZE * 2) {
        await sleep(DELAY_BETWEEN_PAGES);
        const checkPage = await fetchPage(sellerId, accessToken, {
          endpoint,
          offset: PAGE_SIZE,
          dateFrom: toMLDate(window.from),
          dateTo: toMLDate(window.to)
        });
        if (checkPage.results?.length > 0) {
          const checkResult = await saveOrderBatch(checkPage.results, batchId, source);
          progress.imported += checkResult.imported;
          progress.skipped += checkResult.skipped;
          progress.pagesProcessed++;
          if (checkResult.imported === 0) {
            // Both pages all existing — skip rest of this window
            console.log(`⏭️  Skipping ${total - PAGE_SIZE * 2} existing orders in ${progress.currentWindow}`);
            progress.skipped += total - PAGE_SIZE * 2;
            progress.pagesProcessed += windowPages - 2;
            progress.windowsDone++;
            await sleep(DELAY_BETWEEN_WINDOWS);
            continue;
          }
        }
      }

      // Paginate remaining
      const startOffset = windowAllExisting ? PAGE_SIZE * 2 : PAGE_SIZE; // skip pages we already checked
      const maxOffset = Math.min(total, 10000);
      for (let offset = startOffset; offset < maxOffset; offset += PAGE_SIZE) {
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
          progress.pagesProcessed++;
        } catch (pageErr) {
          progress.errors.push(`${source}:${window.from.toISOString().split('T')[0]}:offset${offset}: ${pageErr.message}`);
          progress.pagesProcessed++;
        }
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
