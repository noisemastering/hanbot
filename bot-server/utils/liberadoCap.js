// utils/liberadoCap.js
//
// While Liberado is OFF (release gate), the bot serves at most DAILY_CAP distinct
// conversations per MEXICO-CITY day (new + returning). A conversation that gets
// served is stamped with that day (Conversation.liberadoServedDay), so it keeps
// being served all day and is counted once. A NOT-yet-served-today conversation
// arriving after the cap is full is DEFERRED (a brief message, no flow) — and is
// NOT stamped, so it never consumes a slot. When Liberado is ON there is no cap.
const { isLiberado } = require("./systemState");

const DAILY_CAP = 50;
const CST_OFFSET_MS = 6 * 60 * 60 * 1000; // Mexico City = UTC-6, no DST since 2022

const DEFERRAL_MESSAGE =
  "¡Gracias por escribirnos! 🙌 En este momento estamos atendiendo mucha demanda; en breve te contactamos para ayudarte. 🙏";

// "YYYY-MM-DD" for the current Mexico-City day.
function cstDateStr(now = new Date()) {
  return new Date(now.getTime() - CST_OFFSET_MS).toISOString().slice(0, 10);
}

// Decide whether to serve or defer this conversation under the cap.
//   { serve: true }                 → released, or already served today
//   { serve: true, markDay: "..." } → first time today; caller stamps servedDay
//   { defer: true }                 → cap full and not served today → deferral
async function liberadoCapDecision(convo) {
  try {
    if (await isLiberado()) return { serve: true }; // released → no cap
    const today = cstDateStr();
    if (convo && convo.liberadoServedDay === today) return { serve: true }; // already counted
    const Conversation = require("../models/Conversation");
    const served = await Conversation.countDocuments({ liberadoServedDay: today });
    if (served >= DAILY_CAP) return { defer: true };
    return { serve: true, markDay: today };
  } catch (e) {
    console.error("⚠️ liberadoCap decision failed:", e.message);
    return { serve: true }; // fail OPEN: never block a customer on an error
  }
}

module.exports = { liberadoCapDecision, DEFERRAL_MESSAGE, DAILY_CAP, cstDateStr };
