// services/pushNotifications.js
const webpush = require("web-push");
const PushSubscription = require("../models/PushSubscription");
const { buildClientBrief } = require("../utils/clientBrief");

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

    const brief = buildClientBrief(convo);
    const reasonText = reason || "Un cliente requiere asistencia humana";
    const payload = JSON.stringify({
      title: "Cliente necesita ayuda",
      body: brief ? `${reasonText}\n\n${brief}` : reasonText,
      icon: "/logo192.png",
      badge: "/logo192.png",
      data: {
        url: "/messages",
        psid: psid,
        brief
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

/**
 * Push to SUPER_ADMINS only. Subscriptions carry a userId, so "for my eyes only" is
 * enforceable: the low-credit alert must not land on an asesor's phone — it is a
 * billing matter, and the money is not theirs to act on.
 *
 * @param {string} title
 * @param {string} body
 * @param {string} url  where the dashboard should open on tap
 */
async function sendToSuperAdmins(title, body, url = "/") {
  try {
    const DashboardUser = require("../models/DashboardUser");
    const admins = await DashboardUser.find({ role: "super_admin", active: true }).select("_id").lean();
    if (!admins.length) return { sent: 0, reason: "no super_admin users" };

    const subs = await PushSubscription.find({ userId: { $in: admins.map((a) => a._id) } });
    if (!subs.length) {
      // Not an error: the dashboard banner still shows it. Worth saying out loud,
      // because a push nobody is subscribed to looks identical to one that worked.
      console.warn(`🔔 no push subscriptions for super_admin — "${title}" only shows in the dashboard`);
      return { sent: 0, reason: "no subscriptions" };
    }

    const payload = JSON.stringify({
      title, body, icon: "/logo192.png", badge: "/logo192.png", data: { url },
    });
    const results = await Promise.allSettled(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload);
          return true;
        } catch (error) {
          if (error.statusCode === 410 || error.statusCode === 404) {
            await PushSubscription.deleteOne({ endpoint: sub.endpoint });
          }
          throw error;
        }
      })
    );
    const sent = results.filter((r) => r.status === "fulfilled").length;
    console.log(`🔔 super_admin push "${title}": ${sent}/${subs.length}`);
    return { sent, total: subs.length };
  } catch (e) {
    console.error("Error sending super_admin push:", e.message);
    return { sent: 0, error: e.message };
  }
}

/**
 * Centralized handoff trigger: updates conversation state AND sends push notification.
 * Use this anywhere a bot needs to hand off to a human — guarantees notification fires.
 */
async function triggerHandoff(psid, reason, options = {}) {
  const Conversation = require("../models/Conversation");
  const { updateConversation } = require("../conversationManager");

  const updates = {
    handoffRequested: true,
    handoffReason: reason,
    handoffTimestamp: new Date(),
    state: options.state || "needs_human",
    ...(options.extraUpdates || {})
  };

  try {
    await updateConversation(psid, updates);
  } catch (err) {
    console.error("❌ Failed to update conversation for handoff:", err.message);
  }

  // Fire notification (don't block on failure)
  try {
    const convo = await Conversation.findOne({ psid });
    sendHandoffNotification(psid, convo, reason).catch(err => {
      console.error("❌ Failed to send handoff push notification:", err.message);
    });
  } catch (err) {
    console.error("❌ Failed to load convo for handoff notification:", err.message);
  }
}

module.exports = { sendHandoffNotification, triggerHandoff, sendToSuperAdmins };
