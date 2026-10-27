// jobs/unansweredSweep.js
//
// THE SAFETY NET UNDER EVERY REPLY. A customer message that the bot owns but never
// answered is the one failure we cannot defend, and until now nothing looked for it.
//
// Reported 2026-10-26 by the asesora on psid 24149409157993042 ("no respondió lo que se
// preguntó"): Marbella wrote "Buenos días" at 10:36 and "Costo de La malla sombra" at
// 10:37 — five months after her last visit — and got nothing at all. Both messages are
// in our DB with real Messenger mids, so the webhook arrived and saved them; the reply
// was lost after that. The client's rule: "it looks like a tire kicker but we have to
// answer nevertheless."
//
// The hole is structural, not specific to her. Every inbound message is held in
// `messageDebouncer`'s in-memory queue for 10 seconds before the bot answers, so a
// restart, a deploy or a throw inside that window drops the turn with no retry anywhere:
// the message is already saved, and nothing re-reads it. Replaying her exact
// conversation today answers correctly, which is what a lost timer looks like.
//
// So this sweeper re-reads what the live path dropped. It is deliberately NOT a
// follow-up or a remarketing ping: it answers a question the customer actually asked and
// is still waiting on, through the same `generateReply` as the live path.
//
// Four rules keep it from talking over anyone:
//   1. `Message.answered` is the ledger — it already flips to true whenever a bot or a
//      human replies, so "unanswered" is read, never inferred.
//   2. A conversation a HUMAN owns is skipped. If an asesor took it over, the reply is
//      theirs to write, and a bot message landing mid-negotiation is worse than silence.
//   3. Nothing younger than MIN_AGE_MS, so the live path (10s debounce + the model) is
//      never raced.
//   4. Nothing older than MAX_AGE_MS — outside Meta's 24-hour window the message cannot
//      be delivered anyway, and answering a day-old "¿precio?" out of nowhere reads as
//      a blast, not an answer.

const Conversation = require("../models/Conversation");
const Message = require("../models/Message");

const MIN_AGE_MS = 4 * 60 * 1000;          // let the live path finish first
const MAX_AGE_MS = 23 * 60 * 60 * 1000;    // inside Meta's 24h messaging window
const RECLAIM_MS = 15 * 60 * 1000;         // don't re-sweep the same conversation
const MAX_PER_TICK = 10;                   // a trickle: this is a repair, not a campaign

// States where a person is handling the chat — the bot must stay quiet.
const HUMAN_STATES = new Set(["needs_human", "human_active", "human_takeover", "human_handling"]);

// Things that are not a question. A reaction ("[Reacción enviada]") is the common one:
// 3 of the 4 bot-owned silences in the last 30 days were reactions, and answering a
// thumbs-up with a sales pitch is noise.
const NOT_A_MESSAGE = /^\s*\[(reacci[oó]n|reaction|sticker|me gusta|like)/i;

/** The text the bot would have seen, in the order it arrived — what the debouncer joins. */
function combine(msgs) {
  return msgs.map((m) => (m.text || "").trim()).filter(Boolean).join("\n");
}

async function sendOn(channel, psid, text) {
  if (channel === "whatsapp") {
    const { sendTextMessage } = require("../channels/whatsapp/api");
    await sendTextMessage(psid.replace(/^wa:/, ""), text);
    return;
  }
  const axios = require("axios");
  await axios.post(
    "https://graph.facebook.com/v18.0/me/messages",
    { recipient: { id: psid.replace(/^fb:/, "") }, message: { text } },
    { headers: { Authorization: `Bearer ${process.env.FB_PAGE_TOKEN}`, "Content-Type": "application/json" } }
  );
}

/**
 * One pass. Safe to run often: every decision is derived from the transcript, so there
 * is no scheduled state to go stale, and a conversation answered by the live path two
 * seconds ago simply isn't a candidate any more.
 *
 * @param {{dryRun?: boolean, send?: Function}} opts dryRun reports what it WOULD answer
 *        and sends nothing; send replaces the outbound call (used by the verification
 *        script, so a test can exercise the bookkeeping without touching Meta's API).
 */
async function runUnansweredSweepJob(opts = {}) {
  const dryRun = !!opts.dryRun;
  const deliver = typeof opts.send === "function" ? opts.send : sendOn;
  const out = { considered: 0, answered: 0, skipped: [], errors: 0 };
  try {
    // The bot being deliberately off is not a bug to repair.
    const { isBotHalted } = require("../utils/systemState");
    if (await isBotHalted()) return out;

    const now = Date.now();
    const candidates = await Message.find({
      senderType: "user",
      answered: { $ne: true },
      timestamp: { $gte: new Date(now - MAX_AGE_MS), $lte: new Date(now - MIN_AGE_MS) },
    })
      .sort({ timestamp: 1 })
      .select("psid text timestamp")
      .limit(300)
      .lean();

    // Group per conversation: the bot owes ONE answer to everything it missed, which is
    // exactly what the debouncer would have handed the model as a single combined turn.
    const byPsid = new Map();
    for (const m of candidates) {
      if (!byPsid.has(m.psid)) byPsid.set(m.psid, []);
      byPsid.get(m.psid).push(m);
    }

    for (const [psid, msgs] of byPsid) {
      if (out.answered >= MAX_PER_TICK) break;
      out.considered++;
      const last = msgs[msgs.length - 1];
      const skip = (reason) => out.skipped.push({ psid, reason });

      const convo = await Conversation.findOne({ psid })
        .select("state channel unansweredSweep lastMessageAt")
        .lean();
      if (!convo) { skip("sin conversación"); continue; }
      if (HUMAN_STATES.has(convo.state)) { skip(`la atiende una persona (${convo.state})`); continue; }
      if (convo.unansweredSweep?.at && now - new Date(convo.unansweredSweep.at).getTime() < RECLAIM_MS) {
        skip("barrida hace poco"); continue;
      }

      // Anything sent after their last message means they were answered — by the live
      // path a moment ago, by a human in the inbox, or by another job. The `answered`
      // flag can lag (it is set on the newest unanswered message only), so this is the
      // authoritative check and it is made per conversation, right before sending.
      const replied = await Message.exists({
        psid, senderType: { $in: ["bot", "human"] }, timestamp: { $gt: last.timestamp },
      });
      if (replied) { skip("ya hubo respuesta después"); continue; }

      const text = combine(msgs);
      if (!text || NOT_A_MESSAGE.test(text)) { skip("no es una pregunta (reacción/adjunto)"); continue; }

      const waitedMin = Math.round((now - new Date(last.timestamp).getTime()) / 60000);
      if (dryRun) {
        out.answered++;
        out.skipped.push({ psid, reason: `SE RESPONDERÍA (esperando ${waitedMin} min): ${text.slice(0, 80)}` });
        continue;
      }

      // Claim the conversation BEFORE generating: a slow model turn must not let the
      // next tick answer the same message twice.
      await Conversation.updateOne({ psid }, {
        $set: { "unansweredSweep.at": new Date(), "unansweredSweep.msg": text.slice(0, 200) },
        $inc: { "unansweredSweep.times": 1 },
      }).catch(() => {});

      try {
        const { generateReply } = require("../ai/index");
        const reply = await generateReply(text, psid);
        const replyText = typeof reply === "string" ? reply : reply?.text || "";
        if (!replyText.trim()) { skip("el motor no produjo texto"); continue; }

        await deliver(convo.channel === "whatsapp" ? "whatsapp" : "facebook", psid, replyText);
        await Message.create({ psid, text: replyText, senderType: "bot" });
        await Message.updateMany(
          { _id: { $in: msgs.map((m) => m._id) } },
          { $set: { answered: true } }
        );
        await Conversation.updateOne({ psid }, {
          $set: { "unansweredSweep.sentAt": new Date(), "unansweredSweep.waitedMinutes": waitedMin },
        }).catch(() => {});
        out.answered++;
        console.log(`🛟 [unanswered-sweep] answered ${psid} after ${waitedMin} min of silence: "${text.slice(0, 60)}"`);
      } catch (e) {
        out.errors++;
        console.error(`❌ [unanswered-sweep] could not answer ${psid}:`, e.message);
      }
    }
  } catch (err) {
    console.error("❌ runUnansweredSweepJob failed:", err.message);
  }
  return out;
}

module.exports = { runUnansweredSweepJob, MIN_AGE_MS, MAX_AGE_MS, NOT_A_MESSAGE, HUMAN_STATES, combine };
