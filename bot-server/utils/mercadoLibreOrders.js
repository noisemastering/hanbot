// utils/mercadoLibreOrders.js
const axios = require("axios");
const { getValidAccessToken } = require("./mercadoLibreOAuth");

const ML_ORDERS_API = "https://api.mercadolibre.com/orders/search";

/**
 * Get start of current month in ISO format for ML API
 * ML expects format: "2024-01-01T00:00:00.000-00:00" (with offset, not Z)
 * @returns {string} ISO date string with offset format
 */
function getStartOfMonth() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  // ML API expects offset format (-00:00) not Z
  return start.toISOString().replace('Z', '-00:00');
}

/**
 * Get current date/time in ISO format for ML API
 * @returns {string} ISO date string with offset format
 */
function getNowISO() {
  return new Date().toISOString().replace('Z', '-00:00');
}

/**
 * Fetch orders for a specific seller from Mercado Libre
 * By default fetches current month orders (not all-time)
 *
 * @param {string} sellerId - Seller ID (e.g., "482595248")
 * @param {object} options - Query options
 * @param {string} options.sort - Sort order (default: "date_desc")
 * @param {number} options.limit - Max results (default: 50)
 * @param {number} options.offset - Pagination offset (default: 0)
 * @param {string} options.dateFrom - Start date filter (ISO format, default: start of current month)
 * @param {string} options.dateTo - End date filter (ISO format, default: now)
 * @returns {Promise<object>} Orders response from ML API
 */
async function getOrders(sellerId, options = {}) {
  let fullUrl = ""; // Declare outside try block for error logging

  try {
    // Validate seller_id
    if (!sellerId) {
      throw new Error("seller_id is required");
    }

    console.log(`📦 Fetching orders for seller: ${sellerId}`);

    // Get valid access token for this seller (auto-refreshes if needed)
    // IMPORTANT: trim to remove any whitespace/newlines that can break auth
    const accessTokenRaw = await getValidAccessToken(sellerId);
    const accessToken = (accessTokenRaw || "").trim();

    if (!accessToken) {
      throw new Error("Empty access token after trim()");
    }

    // Build query parameters
    const sort = options.sort || "date_desc";
    const limit = options.limit || 50;
    const offset = options.offset || 0;

    // Date filtering - default to current month
    // ML API expects offset format (-00:00) not Z
    const dateFrom = options.dateFrom || getStartOfMonth();
    const dateTo = options.dateTo || getNowISO();

    // Construct query string with date range filter
    const queryParams = new URLSearchParams({
      seller: sellerId,
      sort: sort,
      limit: limit.toString(),
      offset: offset.toString(),
      "order.date_created.from": dateFrom,
      "order.date_created.to": dateTo
    });
    fullUrl = `${ML_ORDERS_API}?${queryParams.toString()}`;

    console.log(`📅 Date range: ${dateFrom} to ${dateTo}`);

    // Check for proxy configuration
    if (process.env.HTTP_PROXY || process.env.HTTPS_PROXY) {
      console.log(`⚠️ PROXY DETECTED:`);
      console.log(`   HTTP_PROXY: ${process.env.HTTP_PROXY ? "SET" : "not set"}`);
      console.log(`   HTTPS_PROXY: ${process.env.HTTPS_PROXY ? "SET" : "not set"}`);
      console.log(`   NO_PROXY: ${process.env.NO_PROXY || "not set"}`);
    }

    console.log(`🔍 ML ORDERS REQUEST URL: ${fullUrl}`);
    console.log(`   Requested host: api.mercadolibre.com`);
    console.log(`   seller: ${sellerId}`);
    // Don't leak tokens in logs
    console.log(`   Access token length: ${accessToken.length}`);

    // Make request to ML Orders API with explicit config
    const response = await axios.get(fullUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "User-Agent": "HanlobBot/1.0",
      },
      maxRedirects: 0, // Disable redirects to detect them
      validateStatus: (status) => status < 500, // Don't throw on 4xx or 3xx
      proxy: false, // Bypass any proxy
    });

    // Log final URL as seen by axios (helps detect rewrites/redirects)
    const finalUrl = response.request?.res?.responseUrl;
    console.log(`   Final URL (axios): ${finalUrl || "unknown"}`);

    // Log response details
    console.log(`📥 ML Response:`);
    console.log(`   Status: ${response.status}`);
    console.log(`   Content-Type: ${response.headers["content-type"] || "not set"}`);
    if (response.headers["location"]) {
      console.log(`   ⚠️ REDIRECT to: ${response.headers["location"]}`);
    }

    // Check for redirects (3xx)
    if (response.status >= 300 && response.status < 400) {
      console.error(`❌ REDIRECT DETECTED (${response.status})`);
      console.error(`   Location: ${response.headers["location"]}`);
      throw new Error(
        `ML API redirect detected: ${response.status} -> ${response.headers["location"]}`
      );
    }

    // Check if we got HTML instead of JSON
    const contentType = response.headers["content-type"] || "";
    if (contentType.includes("text/html")) {
      const htmlSnippet =
        typeof response.data === "string"
          ? response.data.substring(0, 200)
          : JSON.stringify(response.data).substring(0, 200);

      console.error(
        `❌ ML returned HTML instead of JSON (possible WAF/redirect/proxy/token issue)`
      );
      console.error(`   Status: ${response.status}`);
      console.error(`   Content-Type: ${contentType}`);
      console.error(`   Final URL (axios): ${finalUrl || "unknown"}`);
      console.error(`   HTML snippet: ${htmlSnippet}...`);

      throw new Error(
        `ML returned HTML instead of JSON. Status=${response.status} FinalURL=${
          finalUrl || "unknown"
        }`
      );
    }

    // Check for ML API errors (JSON)
    if (response.status >= 400) {
      console.error(`❌ ML API Error ${response.status}:`, response.data);
      throw Object.assign(new Error(`ML API returned ${response.status}`), {
        response,
      });
    }

    const orders = response.data;

    console.log(`✅ Orders fetched successfully:`);
    console.log(`   Total: ${orders.paging?.total || 0}`);
    console.log(`   Returned: ${orders.results?.length || 0}`);

    // Format orders with all required fields
    const formattedOrders = (orders.results || []).map(order => ({
      // Basic order info
      id: order.id,
      status: order.status,
      date_created: order.date_created,
      date_closed: order.date_closed,

      // Amounts
      total_amount: order.total_amount,
      paid_amount: order.paid_amount,
      currency_id: order.currency_id,

      // Buyer info
      buyer: {
        id: order.buyer?.id,
        nickname: order.buyer?.nickname,
        email: order.buyer?.email,
        first_name: order.buyer?.first_name,
        last_name: order.buyer?.last_name
      },

      // Order items
      order_items: (order.order_items || []).map(item => ({
        item: {
          id: item.item?.id,
          title: item.item?.title,
          category_id: item.item?.category_id
        },
        quantity: item.quantity,
        unit_price: item.unit_price,
        full_unit_price: item.full_unit_price
      })),

      // Payments
      payments: (order.payments || []).map(payment => ({
        id: payment.id,
        status: payment.status,
        status_detail: payment.status_detail,
        transaction_amount: payment.transaction_amount,
        date_approved: payment.date_approved,
        date_created: payment.date_created
      })),

      // Shipping (if available)
      shipping: order.shipping ? {
        id: order.shipping.id,
        status: order.shipping.status
      } : null
    }));

    return {
      success: true,
      orders: formattedOrders,
      paging: orders.paging || {},
      sort: orders.sort || {},
      available_sorts: orders.available_sorts || [],
    };
  } catch (error) {
    console.error(`❌ Error fetching orders for seller ${sellerId}:`);
    console.error(`   Request URL: ${fullUrl}`);
    console.error(`   Status: ${error.response?.status}`);
    console.error(`   Error code: ${error.response?.data?.error}`);
    console.error(`   Error message: ${error.response?.data?.message}`);
    console.error(`   Cause: ${error.response?.data?.cause}`);
    console.error(
      `   Full ML response body:`,
      JSON.stringify(error.response?.data, null, 2)
    );

    // Re-throw with original error details intact
    throw error;
  }
}

/**
 * Get a specific order by ID
 * @param {string} sellerId - Seller ID
 * @param {string} orderId - Order ID
 * @returns {Promise<object>} Order details
 */
async function getOrderById(sellerId, orderId) {
  try {
    if (!sellerId || !orderId) {
      throw new Error("seller_id and order_id are required");
    }

    console.log(`📦 Fetching order ${orderId} for seller ${sellerId}`);

    const accessToken = (await getValidAccessToken(sellerId)).trim();
    if (!accessToken) throw new Error("Empty access token after trim()");

    const response = await axios.get(`https://api.mercadolibre.com/orders/${orderId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "User-Agent": "HanlobBot/1.0",
      },
      maxRedirects: 0,
      validateStatus: (status) => status < 500,
      proxy: false,
    });

    const contentType = response.headers["content-type"] || "";
    if (contentType.includes("text/html")) {
      const finalUrl = response.request?.res?.responseUrl;
      const htmlSnippet =
        typeof response.data === "string"
          ? response.data.substring(0, 200)
          : JSON.stringify(response.data).substring(0, 200);
      throw new Error(
        `ML returned HTML instead of JSON. Status=${response.status} FinalURL=${
          finalUrl || "unknown"
        } Snippet=${htmlSnippet}`
      );
    }

    if (response.status >= 400) {
      throw Object.assign(new Error(`ML API returned ${response.status}`), { response });
    }

    console.log(`✅ Order ${orderId} fetched successfully`);

    return {
      success: true,
      order: response.data,
    };
  } catch (error) {
    console.error(`❌ Error fetching order ${orderId}:`, error.response?.data || error.message);
    throw error;
  }
}

/**
 * Get shipment details including receiver address
 * @param {string} sellerId - Seller ID
 * @param {string} shipmentId - Shipment ID
 * @returns {Promise<object>} Shipment details with receiver address
 */
async function getShipmentById(sellerId, shipmentId) {
  try {
    if (!sellerId || !shipmentId) {
      throw new Error("seller_id and shipment_id are required");
    }

    console.log(`📦 Fetching shipment ${shipmentId} for seller ${sellerId}`);

    const accessToken = (await getValidAccessToken(sellerId)).trim();
    if (!accessToken) throw new Error("Empty access token after trim()");

    const response = await axios.get(`https://api.mercadolibre.com/shipments/${shipmentId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "User-Agent": "HanlobBot/1.0",
      },
      maxRedirects: 0,
      validateStatus: (status) => status < 500,
      proxy: false,
    });

    const contentType = response.headers["content-type"] || "";
    if (contentType.includes("text/html")) {
      throw new Error(`ML returned HTML instead of JSON for shipment ${shipmentId}`);
    }

    if (response.status >= 400) {
      throw Object.assign(new Error(`ML API returned ${response.status}`), { response });
    }

    const shipment = response.data;
    console.log(`✅ Shipment ${shipmentId} fetched successfully`);

    // Extract receiver address
    const receiverAddress = shipment.receiver_address || {};

    return {
      success: true,
      shipment: {
        id: shipment.id,
        status: shipment.status,
        substatus: shipment.substatus,
        receiverAddress: {
          city: receiverAddress.city?.name || null,
          state: receiverAddress.state?.name || null,
          zipCode: receiverAddress.zip_code || null,
          streetName: receiverAddress.street_name || null,
          streetNumber: receiverAddress.street_number || null,
          country: receiverAddress.country?.name || null
        },
        receiverName: shipment.receiver_name || null
      }
    };
  } catch (error) {
    console.error(`❌ Error fetching shipment ${shipmentId}:`, error.response?.data || error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get summary stats by fetching ALL orders in a date range
 * WARNING: This can be slow for large date ranges (many API calls)
 *
 * @param {string} sellerId - Seller ID
 * @param {object} options - Query options
 * @param {string} options.dateFrom - Start date filter (ISO format)
 * @param {string} options.dateTo - End date filter (ISO format)
 * @returns {Promise<object>} Summary with totalOrders, totalRevenue
 */
async function getOrdersSummary(sellerId, options = {}) {
  try {
    const dateFrom = options.dateFrom || getStartOfMonth();
    const dateTo = options.dateTo || getNowISO();

    console.log(`📊 Calculating orders summary for seller ${sellerId}`);
    console.log(`📅 Date range: ${dateFrom} to ${dateTo}`);

    // First call to get total count
    const firstPage = await getOrders(sellerId, {
      dateFrom,
      dateTo,
      limit: 50,
      offset: 0
    });

    const totalOrders = firstPage.paging?.total || 0;

    if (totalOrders === 0) {
      return {
        success: true,
        totalOrders: 0,
        totalRevenue: 0,
        avgOrderValue: 0,
        paidOrders: 0,
        paidRevenue: 0,
        dateRange: { from: dateFrom, to: dateTo }
      };
    }

    // Accumulate from first page
    let totalRevenue = 0;
    let paidOrders = 0;
    let paidRevenue = 0;

    const processOrders = (orders) => {
      for (const order of orders) {
        const amount = order.total_amount || order.paid_amount || 0;
        totalRevenue += amount;
        if (order.status === 'paid') {
          paidOrders++;
          paidRevenue += order.paid_amount || amount;
        }
      }
    };

    processOrders(firstPage.orders);

    // Fetch remaining pages if needed
    const ML_MAX_OFFSET = 10000;
    const BATCH_SIZE = 50;
    let offset = BATCH_SIZE;
    let fetchedCount = firstPage.orders.length;

    while (offset < totalOrders && offset < ML_MAX_OFFSET) {
      console.log(`   Fetching page at offset ${offset}/${Math.min(totalOrders, ML_MAX_OFFSET)}...`);

      const page = await getOrders(sellerId, {
        dateFrom,
        dateTo,
        limit: BATCH_SIZE,
        offset
      });

      processOrders(page.orders);
      fetchedCount += page.orders.length;
      offset += BATCH_SIZE;

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    console.log(`✅ Summary calculated: ${totalOrders} orders, $${totalRevenue.toFixed(2)} revenue`);

    return {
      success: true,
      totalOrders,
      totalRevenue,
      avgOrderValue,
      paidOrders,
      paidRevenue,
      fetchedCount,
      truncated: totalOrders > ML_MAX_OFFSET,
      dateRange: { from: dateFrom, to: dateTo }
    };
  } catch (error) {
    console.error(`❌ Error calculating orders summary:`, error.message);
    throw error;
  }
}

module.exports = {
  getOrders,
  getOrderById,
  getShipmentById,
  getOrdersSummary,
};
