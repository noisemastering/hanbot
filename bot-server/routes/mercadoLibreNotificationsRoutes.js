// routes/mercadoLibreNotificationsRoutes.js
const express = require("express");
const router = express.Router();
const axios = require("axios");
const MercadoLibreOrderEvent = require("../models/MercadoLibreOrderEvent");
const { getValidAccessToken } = require("../utils/mercadoLibreOAuth");

/**
 * Process ML notification asynchronously (don't block webhook response)
 */
async function processNotification(notificationData) {
  const { topic, resource, user_id, application_id, rawBody } = notificationData;

  try {
    console.log(`🔔 Processing ML notification async:`, {
      topic,
      resource,
      user_id,
      application_id
    });

    // Only process orders topic
    if (topic !== "orders") {
      console.log(`⚠️ Ignoring non-orders topic: ${topic}`);
      return;
    }

    // Extract order ID from resource (e.g., "/orders/2000010349951978")
    const orderIdMatch = resource.match(/\/orders\/(\d+)/);
    if (!orderIdMatch) {
      console.error(`❌ Could not parse order ID from resource: ${resource}`);
      return;
    }

    const orderId = orderIdMatch[1];
    const sellerId = user_id;

    console.log(`📦 Fetching order details for order ${orderId}, seller ${sellerId}`);

    // Get valid access token for this seller
    const accessToken = await getValidAccessToken(sellerId);

    // Fetch full order details from ML API
    const orderResponse = await axios.get(
      `https://api.mercadolibre.com/orders/${orderId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json"
        }
      }
    );

    const orderDetail = orderResponse.data;

    console.log(`✅ Order details fetched for ${orderId}:`, {
      status: orderDetail.status,
      buyer: orderDetail.buyer?.nickname,
      total: orderDetail.total_amount
    });

    // Save to database
    const event = await MercadoLibreOrderEvent.findOneAndUpdate(
      { sellerId, orderId },
      {
        sellerId,
        orderId,
        topic,
        resource,
        applicationId: application_id,
        rawNotificationBody: rawBody,
        orderDetail,
        processed: true,
        processedAt: new Date()
      },
      { upsert: true, new: true }
    );

    console.log(`✅ Order event saved to DB: ${event._id}`);

    // TODO: Correlate with ClickLog to attribute to PSID
    // This will be implemented in the correlation algorithm

  } catch (error) {
    console.error(`❌ Error processing notification:`, error.message);

    // Save error to database
    try {
      const orderId = resource.match(/\/orders\/(\d+)/)?.[1];
      if (orderId) {
        await MercadoLibreOrderEvent.findOneAndUpdate(
          { sellerId: user_id, orderId },
          {
            sellerId: user_id,
            orderId,
            topic,
            resource,
            applicationId: application_id,
            rawNotificationBody: rawBody,
            processed: false,
            error: {
              message: error.message,
              code: error.response?.data?.error || error.code,
              timestamp: new Date()
            }
          },
          { upsert: true, new: true }
        );
      }
    } catch (dbError) {
      console.error(`❌ Error saving error to DB:`, dbError.message);
    }
  }
}

/**
 * POST /ml/notifications - Mercado Libre webhook endpoint
 * Must respond 200 OK within ~1 second
 */
router.post("/notifications", async (req, res) => {
  try {
    const body = req.body;

    // Log the full notification for debugging
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🔔 ML Notification Received at ${new Date().toISOString()}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(JSON.stringify(body, null, 2));
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    // Extract key fields
    const { topic, resource, user_id, application_id } = body;

    // Respond 200 OK immediately (within ~1 second)
    res.status(200).json({ success: true, received: true });

    // Process notification asynchronously (don't block response)
    setImmediate(() => {
      processNotification({
        topic,
        resource,
        user_id,
        application_id,
        rawBody: body
      });
    });

  } catch (error) {
    console.error(`❌ Error handling ML notification:`, error);
    // Still respond 200 to avoid ML retrying
    res.status(200).json({ success: false, error: error.message });
  }
});

/**
 * GET /ml/notifications/ping - Health check
 */
router.get("/notifications/ping", (req, res) => {
  res.json({
    ok: true,
    message: "ML Notifications webhook is ready",
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /ml/notifications/events - Get recent notification events (for debugging)
 * Requires authentication
 */
router.get("/notifications/events", async (req, res) => {
  try {
    const { limit = 50, sellerId, processed } = req.query;

    const filter = {};
    if (sellerId) filter.sellerId = sellerId;
    if (processed !== undefined) filter.processed = processed === 'true';

    const events = await MercadoLibreOrderEvent.find(filter)
      .sort({ receivedAt: -1 })
      .limit(parseInt(limit));

    res.json({
      success: true,
      events,
      count: events.length
    });
  } catch (error) {
    console.error(`❌ Error fetching notification events:`, error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
