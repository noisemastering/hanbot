#!/usr/bin/env node
// scripts/unansweredSweepTest.js
//
// Checks jobs/unansweredSweep.js — the repair pass that answers a customer message the
// live path dropped (the silence reported on psid 24149409157993042, 2026-10-26).
//
// NOTHING IS SENT. The job's outbound call is replaced with a local collector via
// opts.send, so this exercises the decision logic and the bookkeeping without touching
// Meta's API. It seeds throwaway conversations under the "test:sweep-*" prefix and
// deletes them at the end.
//
// Run: node scripts/unansweredSweepTest.js

require("dotenv").config();
const mongoose = require("mongoose");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const { runUnansweredSweepJob, NOT_A_MESSAGE, combine } = require("../jobs/unansweredSweep");

const PREFIX = "test:sweep-";
let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log(`✅ ${label}`); }
  else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

const minsAgo = (n) => new Date(Date.now() - n * 60 * 1000);

async function seed(suffix, { state = "active", msgs = [], botAfter = null, sweptAt = null }) {
  const psid = PREFIX + suffix;
  await Conversation.deleteOne({ psid });
  await Message.deleteMany({ psid });
  await Conversation.create({
    psid, channel: "whatsapp", state, greeted: true, lastMessageAt: minsAgo(10),
    ...(sweptAt ? { unansweredSweep: { at: sweptAt, times: 1 } } : {}),
  });
  for (const m of msgs) {
    await Message.create({ psid, text: m.text, senderType: "user", answered: false, timestamp: m.at });
  }
  if (botAfter) await Message.create({ psid, text: "ya te contesté", senderType: "bot", timestamp: botAfter });
  return psid;
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);

  // Pure helpers first — no DB needed for these.
  ok("a reaction is not a question", NOT_A_MESSAGE.test("[Reacción enviada]"));
  ok("a like is not a question", NOT_A_MESSAGE.test("[Me gusta]"));
  ok("a real question is not filtered", !NOT_A_MESSAGE.test("Costo de La malla sombra"));
  ok("the missed messages are joined in order",
    combine([{ text: "Buenos días" }, { text: "Costo de La malla sombra" }]) === "Buenos días\nCosto de La malla sombra");

  // Marbella's exact shape: two messages, 10 minutes of silence, bot-owned conversation.
  const marbella = await seed("marbella", {
    msgs: [{ text: "Buenos días", at: minsAgo(11) }, { text: "Costo de La malla sombra", at: minsAgo(10) }],
  });
  // Human-held: the asesor owes the reply, the bot must not talk over them.
  const human = await seed("human", { state: "human_active", msgs: [{ text: "¿me confirmas el precio?", at: minsAgo(10) }] });
  // Already answered after their message.
  const answered = await seed("answered", { msgs: [{ text: "¿precio?", at: minsAgo(10) }], botAfter: minsAgo(9) });
  // Too fresh — the live path is still working on it.
  const fresh = await seed("fresh", { msgs: [{ text: "¿precio?", at: minsAgo(1) }] });
  // Older than Meta's window: undeliverable, and answering now reads as a blast.
  const stale = await seed("stale", { msgs: [{ text: "¿precio?", at: minsAgo(60 * 30) }] });
  // A reaction, not a question.
  const reaction = await seed("reaction", { msgs: [{ text: "[Reacción enviada]", at: minsAgo(10) }] });
  // Swept two minutes ago: the claim must hold so no message is answered twice.
  const claimed = await seed("claimed", { msgs: [{ text: "¿precio?", at: minsAgo(10) }], sweptAt: minsAgo(2) });

  const mine = (r, psid) => r.skipped.find((s) => s.psid === psid);

  const dry = await runUnansweredSweepJob({ dryRun: true });
  ok("dry run picks Marbella's conversation", /SE RESPONDERÍA/.test(mine(dry, marbella)?.reason || ""), mine(dry, marbella)?.reason);
  ok("dry run skips the human-held chat", /persona/.test(mine(dry, human)?.reason || ""));
  ok("dry run skips one already answered", /ya hubo respuesta/.test(mine(dry, answered)?.reason || ""));
  ok("dry run ignores a message one minute old", !mine(dry, fresh));
  ok("dry run ignores a month-old message", !mine(dry, stale));
  ok("dry run skips a reaction", /no es una pregunta/.test(mine(dry, reaction)?.reason || ""));
  ok("dry run respects a recent claim", /barrida hace poco/.test(mine(dry, claimed)?.reason || ""));

  // Live pass with the sender replaced: the reply is generated for real (so the text is
  // the bot's own) but delivered into this array.
  const sent = [];
  const live = await runUnansweredSweepJob({ send: async (ch, psid, text) => { sent.push({ ch, psid, text }); } });
  const toMarbella = sent.find((s) => s.psid === marbella);
  ok("it answered the dropped turn", !!toMarbella, `sent: ${sent.length}`);
  ok("it answered on the right channel", toMarbella?.ch === "whatsapp");
  ok("the answer has real content", (toMarbella?.text || "").length > 20);
  ok("it answered nobody else", sent.every((s) => s.psid === marbella), sent.map((s) => s.psid).join(","));

  const ledger = await Message.find({ psid: marbella }).sort({ timestamp: 1 }).lean();
  ok("the bot's reply was saved to the transcript", ledger.some((m) => m.senderType === "bot"));
  ok("both missed messages are marked answered",
    ledger.filter((m) => m.senderType === "user").every((m) => m.answered === true));
  const rec = await Conversation.findOne({ psid: marbella }).select("unansweredSweep").lean();
  ok("the repair is recorded on the conversation", !!rec?.unansweredSweep?.sentAt && rec.unansweredSweep.waitedMinutes >= 9);

  const second = await runUnansweredSweepJob({ send: async (ch, psid, text) => { sent.push({ ch, psid, text }); } });
  ok("a second tick does not answer it again", sent.filter((s) => s.psid === marbella).length === 1,
    `sends: ${sent.filter((s) => s.psid === marbella).length}, answered: ${second.answered}`);

  await Conversation.deleteMany({ psid: { $regex: `^${PREFIX}` } });
  await Message.deleteMany({ psid: { $regex: `^${PREFIX}` } });
  console.log(`\n${pass} passed, ${fail} failed`);
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error(e);
  try {
    await Conversation.deleteMany({ psid: { $regex: `^${PREFIX}` } });
    await Message.deleteMany({ psid: { $regex: `^${PREFIX}` } });
  } catch {}
  process.exit(1);
});
