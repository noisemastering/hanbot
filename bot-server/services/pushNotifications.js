// services/pushNotifications.js
const webpush = require("web-push");
const PushSubscription = require("../models/PushSubscription");

// Configure web-push
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_EMAIL || "mailto:admin@hanlob.com",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// Send notification to all subscribed users
async function sendHandoffNotification(psid, convo, reason) {
  try {
    const subscriptions = await PushSubscription.find();

    if (subscriptions.length === 0) {
      console.log("No push subscriptions to notify");
      return;
    }

    const payload = JSON.stringify({
      title: "Cliente necesita ayuda",
      body: reason || "Un cliente requiere asistencia humana",
      icon: "/logo192.png",
      badge: "/logo192.png",
      data: {
        url: "/messages",
        psid: psid
      }
    });

    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: sub.keys
            },
            payload
          );
          return { success: true, endpoint: sub.endpoint };
        } catch (error) {
          // Remove invalid subscriptions
          if (error.statusCode === 410 || error.statusCode === 404) {
            await PushSubscription.deleteOne({ endpoint: sub.endpoint });
            console.log("Removed expired subscription:", sub.endpoint);
          }
          return { success: false, endpoint: sub.endpoint, error: error.message };
        }
      })
    );

    const successful = results.filter(r => r.value?.success).length;
    console.log(`Push notifications sent: ${successful}/${subscriptions.length}`);

    return results;
  } catch (error) {
    console.error("Error sending push notifications:", error);
    throw error;
  }
}

module.exports = { sendHandoffNotification };
