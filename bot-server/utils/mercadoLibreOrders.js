// utils/mercadoLibreOrders.js
const axios = require("axios");
const { getValidAccessToken } = require("./mercadoLibreOAuth");

const ML_ORDERS_API = "https://api.mercadolibre.com/orders/search";

/**
 * Fetch orders for a specific seller from Mercado Libre
 * CRITICAL: Must include caller.id parameter (same as seller_id)
 *
 * @param {string} sellerId - Seller ID (e.g., "482595248")
 * @param {object} options - Query options
 * @param {string} options.sort - Sort order (default: "date_desc")
 * @param {number} options.limit - Max results (default: 50)
 * @param {number} options.offset - Pagination offset (default: 0)
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

    // Build query string (caller.id removed - was causing WAF blocking)
    const sort = options.sort || "date_desc";
    const limit = options.limit || 50;
    const offset = options.offset || 0;

    // Construct query string WITHOUT caller.id
    const queryString = `seller=${sellerId}&sort=${encodeURIComponent(
      sort
    )}&limit=${limit}&offset=${offset}`;
    fullUrl = `${ML_ORDERS_API}?${queryString}`;

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

module.exports = {
  getOrders,
  getOrderById,
};
