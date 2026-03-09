/**
 * State management middleware: stateManager
 *
 * First middleware in the pipeline. Handles conversation state hygiene:
 *   1. Resets stale needs_human handoffs (12+ hours without activity)
 *   2. Clears stale previousSession data (48+ hours old)
 *   3. Blocks the pipeline when conversation is in needs_human state,
 *      sending a periodic reminder (max every 10 min) or staying silent
 *
 * ctx.convo is already provided by the pipeline runner.
 * If needs_human is active (after reset check), sets ctx.response and
 * does NOT call next(), stopping the chain.
 */

const { updateConversation } = require("../../conversationManager");

module.exports = async function stateManager(ctx, next) {
  const { psid, convo } = ctx;

  // ── Reset stale needs_human conversations (12h) ─────────────────────
  if (convo.state === "needs_human") {
    const lastMessageTime = convo.lastMessageAt
      ? new Date(convo.lastMessageAt)
      : null;
    const hoursSinceLastMessage = lastMessageTime
      ? (Date.now() - lastMessageTime.getTime()) / (1000 * 60 * 60)
      : 999;

    if (hoursSinceLastMessage >= 12) {
      console.log(
        `🔄 Resetting stale needs_human conversation (${hoursSinceLastMessage.toFixed(1)}h since last message)`
      );
      await updateConversation(psid, {
        state: "active",
        lastIntent: null,
        handoffRequested: false,
        handoffReason: null,
        lastBotResponse: null,
        lastNeedsHumanReminder: null,
        currentFlow: null,
        flowStep: null,
        flowData: {},
        silenceFollowUpSent: false,
        silenceFollowUpAt: null,
        isWholesaleInquiry: false,
        pendingHandoff: false,
        pendingHandoffInfo: null,
      });
      convo.state = "active";
      convo.lastIntent = null;
      convo.handoffRequested = false;
      convo.currentFlow = null;
      convo.isWholesaleInquiry = false;
    }
  }

  // ── Clear stale previous session (48h) ──────────────────────────────
  if (convo.previousSession?.savedAt) {
    const sessionAge =
      (Date.now() - new Date(convo.previousSession.savedAt).getTime()) /
      (1000 * 60 * 60);
    if (sessionAge > 48) {
      console.log(
        `🧹 Clearing stale previousSession (${sessionAge.toFixed(1)}h old)`
      );
      await updateConversation(psid, { previousSession: null });
      convo.previousSession = null;
    }
  }

  // ── Block pipeline when needs_human is active ───────────────────────
  // BUT allow the bot to answer simple product questions while the customer waits
  if (convo.state === "needs_human") {
    console.log("🚨 Conversation is waiting for human (needs_human state)");

    // Classify the message to see if it's a question the bot can answer
    const { classify: classifyMsg } = require("../classifier");
    const quickClassification = await classifyMsg(ctx.userMessage, null, null, null);
    const qi = quickClassification?.intent;

    const ANSWERABLE_INTENTS = new Set([
      "price_query", "product_inquiry", "availability_query", "catalog_request",
      "size_specification", "percentage_specification", "color_query",
      "shade_percentage_query", "shipping_query", "payment_query",
      "delivery_time_query", "shipping_included_query", "installation_query",
      "warranty_query", "durability_query", "custom_size_query",
      "product_comparison", "location_query", "largest_product", "smallest_product"
    ]);

    if (qi && ANSWERABLE_INTENTS.has(qi)) {
      console.log(`💬 needs_human but answerable intent "${qi}" — letting bot respond (state stays needs_human)`);
      // Fall through to next middleware — state stays needs_human so human still gets notified
      return await next();
    }

    const lastReminder = convo.lastNeedsHumanReminder
      ? new Date(convo.lastNeedsHumanReminder)
      : null;
    const minutesSinceReminder = lastReminder
      ? (Date.now() - lastReminder.getTime()) / (1000 * 60)
      : 999;

    if (minutesSinceReminder >= 10) {
      await updateConversation(psid, {
        lastNeedsHumanReminder: new Date(),
      });
      ctx.response = {
        type: "text",
        text: "Tu mensaje fue recibido. Un especialista te atenderá en breve. 🙏",
      };
    } else {
      // Already sent a recent reminder — stay completely silent
      console.log(
        `⏳ Already sent reminder ${minutesSinceReminder.toFixed(1)} min ago, staying silent`
      );
      ctx.response = null;
    }

    // Do NOT call next() — pipeline stops here
    return;
  }

  await next();
};
