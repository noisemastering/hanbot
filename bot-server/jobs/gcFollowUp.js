// jobs/gcFollowUp.js
//
// GROUND COVER — the campaign's single 24h follow-up (client spec, 2026-10-27).
//
// One message, 23h after the CUSTOMER's last message, inside the hours below, only
// when the conversation is genuinely PENDING, and never again after that. The client's
// words for the goal: recover the conversation, and let the customer tell us what we
// got wrong.
//
// WHEN IT MAY GO OUT (the user's call, 2026-10-28, narrowing the spec's flat 24h /
// 7:00–20:00 every day):
//   • Monday–Friday — 23 h after their last message, inside 7:00–20:00 México.
//   • Saturday — 7:00 to 14:00, and a conversation whose 23 h land LATER that Saturday
//     is pinged just before 14:00 rather than waiting: "23 horas después o antes de
//     las 14:00, lo que pase primero".
//   • Sunday — nothing goes out, and a conversation that comes due on a Sunday is LET
//     GO for good, with no catch-up on Monday ("if Sunday we'll have to let those
//     go"). Two days late, the message stops being a continuation of the conversation,
//     which was the whole point of it.
//
// Two things about the design are deliberate and should not be "simplified":
//
//  1. NOTHING IS SCHEDULED AHEAD OF TIME. The job computes eligibility from the
//     customer's last message every time it runs. §3.1 says the clock RESETS if the
//     customer writes again — with a stored timer that is a second thing to keep in
//     sync (the old silenceFollowUp timer has three separate places that clear it);
//     derived from the transcript it simply cannot go stale.
//
//  2. THE AI GATE CAN ONLY VETO. §3.3 asks for a judgement call ("solo cuando exista
//     una posibilidad razonable de que el cliente tenga una consulta o compra
//     pendiente"), which is a model's job. But every hard exclusion in §4 is CODE,
//     and the model is only ever asked to withhold a message, never to send one. A
//     model failure, a timeout or a bad key therefore costs us a follow-up we might
//     have sent — it can never put an unwanted message in front of a customer. This
//     is the standing lesson in this repo: a rule that lives only in a prompt is not
//     in force.
//
// OFF BY DEFAULT. The switch is `SystemState.gcFollowUp.engaged`, flipped from Spec
// Ops — a DB switch, not an env var, because the user never touches Railway config.
// It is NOT gated behind REMARKETING_ENABLED: that blanket kill-switch (2026-06-05)
// turned off the old 23h remarketing ping, and this is a different thing the client
// asked for by name. Both can be off at once; neither implies the other.

const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const SystemState = require("../models/SystemState");

// 23h — the user's call (2026-10-28), one hour under the spec's 24. It also fits
// inside Meta's 24h messaging window, which is why the old remarketing ping used 23h:
// on Messenger a standard message sent after that window is rejected outright. The
// send tolerates that failure and records it rather than retrying forever.
const WAIT_MS = 23 * 60 * 60 * 1000;

// …and an upper bound, which the spec does not state but plainly intends: the message
// is meant to read as "una continuación natural de la conversación". A dry run against
// prod found 59 eligible Ground Cover conversations whose last message was in
// FEBRUARY — turning the switch on without this would have sent all of them a
// "¿encontraste lo que buscabas?" about a chat eight months old. A conversation is
// PENDING while it is plausibly still live; after a week it is history, and reopening
// it is a marketing blast, which is not what was asked for. Raise it if the client
// wants a longer tail, but it must stay finite.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// Matches the campaign on any of the fields that name it: the engine stamps
// `currentFlow`, the ad-entry path sets `productInterest`, and the legacy convo_flows
// use their own ref. Used BOTH in the Mongo query and in the JS double-check — the
// query has to carry it, because filtering in JS after a `.limit()` means a batch of
// unrelated conversations can crowd out every Ground Cover one (it did: the first dry
// run considered 0 of 59).
const GC_RE = /ground[\s_-]*cover|anti[\s_-]*maleza/i;

// §3.2 — THE SCHEDULE. Mexico abolished DST in 2022, so the centre runs at a flat
// UTC-6 all year; DB timestamps are UTC (see the convo-times-are-UTC note in
// CLAUDE.md). Monday–Friday the window is 7:00–20:00; Saturday it shuts at 14:00;
// Sunday is closed and is not deferred to Monday (see the header).
const MX_OFFSET_MS = 6 * 60 * 60 * 1000;
const WINDOW_OPEN_H = 7;
const WINDOW_CLOSE_H = 20; // Monday–Friday
const SAT_CLOSE_H = 14; // Saturday's deadline
// How long before Saturday's deadline the "lo que pase primero" sweep runs. The job
// ticks every 5 minutes, so a 20-minute band gives it four chances to fire — and
// waiting for the band means the customer gets as close to the full 23 h as Saturday
// allows: a conversation due Saturday 17:00 is pinged at ~13:45, not at 07:00.
const SAT_SWEEP_MS = 20 * 60 * 1000;
const SUNDAY = 0;
const SATURDAY = 6;

/** The same instant, shifted so the UTC getters read as México-centro wall clock. */
function mxClock(at = new Date()) {
  return new Date(at.getTime() - MX_OFFSET_MS);
}
/** 0 = Sunday … 6 = Saturday, in México. */
function mxDay(at = new Date()) {
  return mxClock(at).getUTCDay();
}
function sameMxDay(a, b) {
  const x = mxClock(a);
  const y = mxClock(b);
  return (
    x.getUTCFullYear() === y.getUTCFullYear() &&
    x.getUTCMonth() === y.getUTCMonth() &&
    x.getUTCDate() === y.getUTCDate()
  );
}
/** The hour the window shuts on that weekday, or null when the day is closed. */
function closeHourFor(day) {
  if (day === SUNDAY) return null;
  return day === SATURDAY ? SAT_CLOSE_H : WINDOW_CLOSE_H;
}
function inSendWindow(at = new Date()) {
  const local = mxClock(at);
  const close = closeHourFor(local.getUTCDay());
  if (close == null) return false;
  const h = local.getUTCHours();
  return h >= WINDOW_OPEN_H && h < close;
}
/** The next instant the window is open — today's 7:00 if we are still before it. */
function nextWindowOpenAt(at = new Date()) {
  const local = mxClock(at);
  const open = new Date(local);
  open.setUTCHours(WINDOW_OPEN_H, 0, 0, 0);
  if (local.getUTCHours() >= WINDOW_OPEN_H) open.setUTCDate(open.getUTCDate() + 1);
  while (open.getUTCDay() === SUNDAY) open.setUTCDate(open.getUTCDate() + 1);
  return new Date(open.getTime() + MX_OFFSET_MS);
}
/** Saturday's "lo que pase primero" band: the last minutes before 14:00 México. */
function inSaturdaySweep(at = new Date()) {
  const local = mxClock(at);
  if (local.getUTCDay() !== SATURDAY) return false;
  const close = new Date(local);
  close.setUTCHours(SAT_CLOSE_H, 0, 0, 0);
  return local.getTime() >= close.getTime() - SAT_SWEEP_MS && local.getTime() < close.getTime();
}
/** The next midnight México — on a Saturday, Sunday 00:00. */
function mxNextMidnight(at = new Date()) {
  const mid = mxClock(at);
  mid.setUTCHours(0, 0, 0, 0);
  mid.setUTCDate(mid.getUTCDate() + 1);
  return new Date(mid.getTime() + MX_OFFSET_MS);
}

/**
 * When this conversation's follow-up comes due, and whether it may still go out.
 *
 *   "due"     — send it now (`early` when Saturday's deadline brought it forward)
 *   "wait"    — not yet; a later tick takes it
 *   "domingo" — it came due on a Sunday, so it is let go for good
 *
 * Deriving the Sunday verdict from the customer's last message is what makes it
 * stick without storing anything: the same Sunday is still a Sunday on Monday, and if
 * the customer writes again the clock resets (§3.1) and the new due date is judged
 * afresh.
 *
 * @param {Date|string|number} lastUserAt the customer's last message
 * @param {Date} [now]
 */
function dueStatus(lastUserAt, now = new Date()) {
  const dueAt = new Date(new Date(lastUserAt).getTime() + WAIT_MS);
  if (mxDay(dueAt) === SUNDAY) return { state: "domingo", dueAt };
  if (dueAt.getTime() <= now.getTime()) return { state: "due", dueAt, early: false };
  // Saturday, due later today and after the 14:00 deadline → go now instead.
  if (inSaturdaySweep(now) && mxDay(dueAt) === SATURDAY && sameMxDay(dueAt, now)) {
    return { state: "due", dueAt, early: true };
  }
  return { state: "wait", dueAt };
}

// §2 — the client's message, verbatim.
const FOLLOW_UP_TEXT = `¡Hola!
Solo queremos dar seguimiento a tu consulta sobre nuestra malla antimaleza (Ground Cover).
¿Encontraste lo que buscabas o hay algo más en lo que podamos ayudarte?
Si necesitas otra medida, presentación o información adicional, con gusto podemos revisar las opciones disponibles.`;

// §4 — the hard exclusions, in code. Each one is a thing the customer SAID; the key is
// what gets recorded as the skip reason, so the dashboard can show why a conversation
// was passed over instead of leaving it a mystery.
//
// NOTE ON THE TRAILING BOUNDARY: these patterns must NOT end in `\b`. An accented
// vowel is not a regex word character, so `\b` after "compré" or "conseguí" demands a
// word→non-word transition that cannot happen, and "ya la compré" silently failed to
// match — the single most load-bearing exclusion in the list. `END` is the boundary
// that works for Spanish: "not followed by another letter".
const END = "(?![a-záéíóúñ])";
const HARD_EXCLUSIONS = [
  // "El cliente haya indicado que inició la conversación por accidente o error."
  { key: "accidente", re: new RegExp(`\\b(fue\\s+un\\s+error|me\\s+equivoqu[eé]|por\\s+(error|equivocaci[oó]n)|sin\\s+querer|no\\s+quer[ií]a\\s+(escribir|mandar)|n[uú]mero\\s+equivocado|me\\s+sal[ií][oó]\\s+solo)${END}`, "i") },
  // "…haya solicitado que no se le vuelva a contactar."
  { key: "no_contactar", re: new RegExp(`\\b(no\\s+me\\s+(vuelvas?|vuelvan?)\\s+a\\s+(contactar|escribir|llamar|marcar|molestar)|(no|ya\\s+no)\\s+me\\s+(contacten|escriban|llamen|marquen|molesten)|d[eé]jen?me\\s+en\\s+paz|b[oó]rren?me|d[eé]n?me\\s+de\\s+baja|no\\s+quiero\\s+(m[aá]s\\s+)?(mensajes|publicidad|spam))${END}`, "i") },
  // "…expresiones ofensivas, insultos o lenguaje hostil."
  { key: "hostil", re: new RegExp(`\\b(pendej\\w*|est[uú]pid\\w*|idiot\\w*|imb[eé]cil\\w*|chinga\\w*|ching[uo]\\w*|verga|mierda|put[oa]s?|jodan?|j[oó]dete|maldit\\w*|estafa\\w*|fraude|ladrones?|rateros?|chingen)${END}`, "i") },
  // "…la conversación haya concluido satisfactoriamente o el cliente ya haya
  //  confirmado su compra."
  { key: "ya_compro", re: new RegExp(`\\b(ya\\s+(la\\s+|lo\\s+|les\\s+)?(compr[eé]|pagu[eé]|orden[eé]|ped[ií]|adquir[ií])|ya\\s+(hice|realic[eé])\\s+(el\\s+|mi\\s+)?(pedido|compra|orden)|compra\\s+(hecha|realizada)|ya\\s+qued[oó]\\s+(el\\s+)?(pedido|la\\s+compra))${END}`, "i") },
  // "…haya informado que retomará el contacto por su cuenta en otro momento."
  { key: "cliente_retoma", re: new RegExp(`\\b(yo\\s+(te|le|les)\\s+(busco|contacto|aviso|escribo|marco)|(luego|despu[eé]s|m[aá]s\\s+adelante)\\s+(te|le|les)\\s+(aviso|busco|escribo|contacto|marco)|(te|le|les)\\s+aviso\\s+(luego|despu[eé]s|cuando)|cuando\\s+(decida|lo\\s+decida|tenga|est[eé]\\s+listo)\\s+(te|le|les)\\s+(aviso|busco|escribo))${END}`, "i") },
  // "…haya manifestado claramente que no está interesado." Only the unambiguous
  // phrasings; a bare "no gracias" can be a reply to one offer rather than a verdict
  // on the conversation, so that nuance is left to the AI gate, which can only veto.
  { key: "no_interesado", re: new RegExp(`\\b(ya\\s+no\\s+(me\\s+)?interesa|no\\s+me\\s+interesa|ya\\s+no\\s+(lo\\s+|la\\s+)?quiero|ya\\s+(lo|la)\\s+consegu[ií]|ya\\s+compr[eé]\\s+(en|con)\\s+otr|desisto|olv[ií]d[ae]lo)${END}`, "i") },
];

/**
 * Does this conversation belong to the Ground Cover campaign? The engine stamps
 * `currentFlow` as "workflow:Ground Cover (Malla Antimaleza)"; productInterest and
 * the point-of-interest root are the older/ad-entry spellings.
 */
function isGroundCoverConvo(c) {
  // THE ACTIVE FLOW WINS. A stale productInterest from an earlier session must not pull
  // a conversation into this campaign: psid 39693838233563590 sits on the BORDE flow
  // asking borde prices while still carrying productInterest "ground_cover" from a
  // previous visit, and a "seguimiento a tu consulta sobre Ground Cover" would be about
  // a product he never asked about. Only a REAL flow is authoritative — "default" and
  // the empty string say nothing, so those fall through to the interest fields.
  const flow = String(c.currentFlow || "");
  if (/^(workflow|convo):/i.test(flow)) return GC_RE.test(flow);
  return GC_RE.test([c.productInterest, c.poiRootName, c.adMainProductName].filter(Boolean).join(" "));
}

/** The hard exclusion a transcript trips, if any. Looks at what the CUSTOMER wrote. */
function hardExclusion(userTexts) {
  const blob = userTexts.join("\n");
  for (const { key, re } of HARD_EXCLUSIONS) {
    const m = blob.match(re);
    if (m) return { key, quote: m[0] };
  }
  return null;
}

/** Is the GC follow-up switched on? DB switch (Spec Ops), never an env var. */
async function isEnabled() {
  try {
    const st = await SystemState.findById("singleton").select("gcFollowUp").lean();
    return !!(st && st.gcFollowUp && st.gcFollowUp.engaged);
  } catch (e) {
    console.error("⚠️ gcFollowUp switch read failed:", e.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §3.3 — the coherence judgement. VETO ONLY: `false`/unknown means we do not send.
// ─────────────────────────────────────────────────────────────────────────────
let _openai = null;
function openai() {
  if (!_openai) {
    const { OpenAI } = require("openai");
    _openai = new OpenAI({ apiKey: process.env.AI_API_KEY });
  }
  return _openai;
}

/**
 * @param {{role: string, text: string}[]} turns
 * @returns {Promise<{send: boolean, reason: string}>}
 */
async function aiConversationIsPending(turns) {
  const convo = turns
    .map((t) => `${t.role === "user" ? "CLIENTE" : "BOT"}: ${String(t.text || "").slice(0, 400)}`)
    .join("\n")
    .slice(-6000);
  try {
    const res = await openai().chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Eres un supervisor de ventas de Hanlob (malla antimaleza / Ground Cover). Te doy una conversación de WhatsApp o Messenger que quedó SIN RESPUESTA del cliente hace más de 24 horas.

Decide UNA cosa: ¿tiene sentido mandarle un mensaje de seguimiento comercial?

Responde SÍ (pending=true) sólo si existe una posibilidad razonable de que el cliente tenga una CONSULTA o una COMPRA pendiente: preguntó un precio, una medida, un color, un envío; pidió una cotización; dijo que lo iba a pensar o a consultar; se quedó a medias en el proceso; o el bot le hizo una pregunta que nunca contestó.

Responde NO (pending=false) si la conversación ya está cerrada o rechazada: el cliente ya compró o confirmó su compra, dijo que no le interesa, pidió que no lo contacten, escribió por error, insultó, dijo que él va a buscarnos, o un asesor humano ya está atendiendo una negociación con él.

REGLAS:
- La simple falta de respuesta NO significa falta de interés. Si la conversación quedó a medias, es PENDIENTE.
- Si no estás seguro, responde pending=false. Es mejor no mandar nada que molestar a un cliente.
- Básate SÓLO en lo que el cliente escribió. No inventes motivos que él no expresó.

Responde JSON: {"pending": true|false, "reason": "<motivo en menos de 12 palabras>"}`,
        },
        { role: "user", content: convo },
      ],
      max_tokens: 120,
    });
    const out = JSON.parse(res.choices[0].message.content || "{}");
    return {
      send: out.pending === true,
      reason: String(out.reason || "").slice(0, 160) || (out.pending ? "pendiente" : "no pendiente"),
    };
  } catch (e) {
    // The gate is veto-only, so a failure withholds the message. Recorded as its own
    // skip reason so a broken key or a rate limit is visible instead of looking like
    // a deliberate decision about the customer.
    console.error("⚠️ gcFollowUp coherence check failed:", e.message);
    return { send: false, reason: `verificación no disponible: ${e.message}`.slice(0, 160) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// THE SENDER
// ─────────────────────────────────────────────────────────────────────────────

async function sendOn(channel, psid, text) {
  if (channel === "whatsapp") {
    const { sendTextMessage } = require("../channels/whatsapp/api");
    await sendTextMessage(psid.replace(/^wa:/, ""), text);
    return;
  }
  const axios = require("axios");
  const fbPsid = psid.replace(/^fb:/, "");
  await axios.post(
    "https://graph.facebook.com/v18.0/me/messages",
    { recipient: { id: fbPsid }, message: { text } },
    { headers: { Authorization: `Bearer ${process.env.FB_PAGE_TOKEN}`, "Content-Type": "application/json" } }
  );
}

/** Record why a conversation was passed over, without claiming anything was sent. */
async function noteSkip(psid, reason) {
  await Conversation.updateOne(
    { psid },
    { $set: { "gcFollowUp.skipReason": String(reason).slice(0, 200), "gcFollowUp.skipAt": new Date() } }
  ).catch(() => {});
}

/**
 * Periodic job: send the campaign's one follow-up to pending Ground Cover
 * conversations. Safe to run often — eligibility is derived, not scheduled.
 *
 * @param {{dryRun?: boolean, now?: Date, limit?: number}} [opts]
 */
async function runGcFollowUpJob(opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  const dryRun = !!opts.dryRun;
  const results = { considered: 0, sent: 0, early: 0, skipped: {}, deferred: 0, errors: 0 };
  const skip = (psid, key) => {
    results.skipped[key] = (results.skipped[key] || 0) + 1;
    if (!dryRun) return noteSkip(psid, key);
  };

  try {
    if (!dryRun && !(await isEnabled())) return results;

    // §3.2 — outside the window nothing goes out. Don't even look: the job runs on a
    // timer and the next tick inside the window picks everything up, which is exactly
    // "programarse para las 7:00 a.m. del siguiente día permitido" — Sundays excepted,
    // since those conversations are let go rather than carried to Monday.
    if (!inSendWindow(now)) {
      results.deferred = -1; // sentinel: the whole tick was outside the window
      results.closedBecause = mxDay(now) === SUNDAY ? "domingo" : "fuera_de_horario";
      return results;
    }

    const cutoff = new Date(now.getTime() - WAIT_MS);
    const floor = new Date(now.getTime() - MAX_AGE_MS);
    // SATURDAY'S DEADLINE WIDENS THE QUERY. In the sweep band we also want
    // conversations that are NOT yet 23 h old but would come due after 14:00 — the
    // widest such case is one due just before Sunday, i.e. a last message up to 23 h
    // before Sunday 00:00 México. Without this the sweep would find nothing, because
    // the query only ever returned conversations already past the wait.
    const sweeping = inSaturdaySweep(now);
    const queryCutoff = sweeping ? new Date(mxNextMidnight(now).getTime() - WAIT_MS) : cutoff;
    // Candidates: Ground Cover, bot-active, never followed up, not opted out, and
    // between 24h and MAX_AGE old. The campaign filter is IN the query so a limit can
    // never crowd out the conversations we came for, and the newest are taken first.
    // The 24h test is re-checked per conversation against the last USER message,
    // because lastMessageAt also moves when the BOT writes.
    const candidates = await Conversation.find({
      "gcFollowUp.sentAt": null,
      doNotFollowUp: { $ne: true },
      state: { $in: ["active", "new"] },
      lastMessageAt: { $lte: queryCutoff, $gte: floor },
      $or: [
        { currentFlow: GC_RE },
        { productInterest: GC_RE },
        { poiRootName: GC_RE },
        { adMainProductName: GC_RE },
      ],
    })
      .select(
        "psid channel currentFlow productInterest poiRootName adMainProductName state lastMessageAt gcFollowUp"
      )
      .sort({ lastMessageAt: -1 })
      .limit(opts.limit || 200)
      .lean();

    for (const c of candidates) {
      if (!isGroundCoverConvo(c)) continue;
      results.considered++;
      try {
        const msgs = await Message.find({ psid: c.psid })
          .sort({ timestamp: 1 })
          .select("text senderType timestamp")
          .lean();
        const userMsgs = msgs.filter((m) => m.senderType === "user");
        if (!userMsgs.length) {
          await skip(c.psid, "sin_mensajes_del_cliente");
          continue;
        }

        // §3.1 — 23h since the CUSTOMER's last message, and the clock resets whenever
        // they write again, which falls out of measuring from the transcript. The day
        // rules live in dueStatus: Saturday's 14:00 deadline can bring a send FORWARD,
        // and a conversation that comes due on a Sunday is let go for good.
        const lastUser = userMsgs[userMsgs.length - 1];
        const due = dueStatus(lastUser.timestamp, now);
        if (due.state === "domingo") {
          await skip(c.psid, "vencio_en_domingo");
          continue;
        }
        if (due.state === "wait") {
          results.deferred++;
          continue;
        }
        if (due.early) results.early++;
        // If the customer wrote last, the BOT owes them an answer — a "¿encontraste lo
        // que buscabas?" on top of an unanswered question is worse than silence. That
        // is the engine's silent-turn case (lastSilentTurn), not a follow-up case.
        const lastMsg = msgs[msgs.length - 1];
        if (lastMsg && lastMsg.senderType === "user") {
          await skip(c.psid, "el_bot_no_contesto_el_ultimo_mensaje");
          continue;
        }

        // §4 — the hard exclusions, from what the customer actually wrote.
        const hard = hardExclusion(userMsgs.map((m) => String(m.text || "")));
        if (hard) {
          await skip(c.psid, `excluido:${hard.key}`);
          // "No me contacten" and an insult are standing instructions, not one-offs:
          // mark the conversation so no other follow-up path reaches them either.
          if (!dryRun && (hard.key === "no_contactar" || hard.key === "hostil" || hard.key === "no_interesado")) {
            await Conversation.updateOne(
              { psid: c.psid },
              { $set: { doNotFollowUp: true, doNotFollowUpReason: `gc_followup:${hard.key}`, doNotFollowUpAt: new Date() } }
            ).catch(() => {});
          }
          continue;
        }

        // §3.3 — the judgement call, veto-only.
        const turns = msgs.map((m) => ({ role: m.senderType === "user" ? "user" : "bot", text: m.text }));
        const verdict = await aiConversationIsPending(turns);
        if (!verdict.send) {
          await skip(c.psid, `no_pendiente:${verdict.reason}`);
          continue;
        }

        const channel = c.channel || (String(c.psid).startsWith("wa:") ? "whatsapp" : "facebook");
        if (dryRun) {
          results.sent++;
          continue;
        }

        // §7 — exactly one per conversation. Claim it BEFORE sending so a second tick
        // (or a second instance) can't double-send; a send failure is recorded on the
        // claim rather than released, because a retry loop against Meta's 24h window
        // would just send the same message at a worse time.
        const claimed = await Conversation.findOneAndUpdate(
          { psid: c.psid, "gcFollowUp.sentAt": null },
          {
            $set: {
              "gcFollowUp.sentAt": new Date(),
              "gcFollowUp.text": FOLLOW_UP_TEXT,
              "gcFollowUp.channel": channel,
              "gcFollowUp.skipReason": null,
              "gcFollowUp.skipAt": null,
            },
          },
          { new: true }
        );
        if (!claimed) continue;

        try {
          await sendOn(channel, c.psid, FOLLOW_UP_TEXT);
        } catch (sendErr) {
          results.errors++;
          await Conversation.updateOne(
            { psid: c.psid },
            { $set: { "gcFollowUp.skipReason": `envio_fallido: ${sendErr.message}`.slice(0, 200), "gcFollowUp.skipAt": new Date() } }
          ).catch(() => {});
          console.error(`❌ GC follow-up send failed for ${c.psid}:`, sendErr.message);
          continue;
        }

        await Message.create({ psid: c.psid, text: FOLLOW_UP_TEXT, senderType: "bot" }).catch(() => {});
        results.sent++;
        console.log(`📨 GC follow-up sent to ${c.psid} (${channel}) — ${verdict.reason}`);
      } catch (err) {
        results.errors++;
        console.error(`❌ GC follow-up failed for ${c.psid}:`, err.message);
      }
    }
  } catch (err) {
    results.errors++;
    console.error("❌ runGcFollowUpJob failed:", err.message);
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// §5 + §6 + §8 — what the answer meant, recorded for the dashboard.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classify the customer's reply to the follow-up: which of §5's four cases it is, and
 * why they had stalled (§8's reason buckets). Returns null when it can't tell, so a
 * failure leaves the row unanalyzed and retryable instead of inventing a motive — the
 * client's own constraint: "sin asumir motivos que el cliente no haya expresado".
 */
async function classifyFollowUpReply(replyText, contextTurns = []) {
  const ctx = contextTurns
    .slice(-8)
    .map((t) => `${t.role === "user" ? "CLIENTE" : "BOT"}: ${String(t.text || "").slice(0, 300)}`)
    .join("\n");
  try {
    const res = await openai().chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Clasifica la RESPUESTA de un cliente al mensaje de seguimiento de la campaña Ground Cover (malla antimaleza) de Hanlob.

"outcome" — qué quiere el cliente ahora:
- "interesado": sigue interesado, quiere continuar o cotizar.
- "otra_medida": necesitaba otra medida, largo, ancho o presentación.
- "inconformidad": se queja del precio, la medida, la información o la atención.
- "no_interesado": ya no quiere continuar.
- "otro": no encaja en ninguna.

"reason" — por qué NO había continuado antes, si el cliente lo dice:
- "precio", "medidas", "atencion", "informacion", "otros".
Si el cliente no expresó ningún motivo, usa null. NO inventes un motivo.

Responde JSON: {"outcome":"...","reason":"precio|medidas|atencion|informacion|otros|null","note":"<cita o resumen de 12 palabras max>"}`,
        },
        { role: "user", content: `${ctx ? `CONTEXTO:\n${ctx}\n\n` : ""}RESPUESTA AL SEGUIMIENTO:\n${String(replyText || "").slice(0, 1200)}` },
      ],
      max_tokens: 150,
    });
    const out = JSON.parse(res.choices[0].message.content || "{}");
    const OUTCOMES = ["interesado", "otra_medida", "inconformidad", "no_interesado", "otro"];
    const REASONS = ["precio", "medidas", "atencion", "informacion", "otros"];
    const outcome = OUTCOMES.includes(out.outcome) ? out.outcome : null;
    if (!outcome) return null;
    return {
      outcome,
      reasonCategory: REASONS.includes(out.reason) ? out.reason : null,
      reasonNote: out.note ? String(out.note).slice(0, 200) : null,
    };
  } catch (e) {
    console.error("⚠️ gcFollowUp reply classification failed:", e.message);
    return null;
  }
}

/**
 * Periodic job: find follow-ups the customer answered and record what the answer was
 * (§6) and what it meant (§5/§8). Read-only toward the customer — it never replies;
 * the engine handles the live conversation. The one action it takes is §5D: a customer
 * who confirmed they're done is marked so no other follow-up path reaches them.
 *
 * Runs regardless of the switch: replies to follow-ups already sent must still be
 * recorded if the switch is turned off mid-campaign.
 */
async function runGcFollowUpReplyJob(opts = {}) {
  const out = { analyzed: 0, pendingReply: 0, errors: 0 };
  try {
    const rows = await Conversation.find({
      "gcFollowUp.sentAt": { $ne: null },
      "gcFollowUp.analyzedAt": null,
    })
      .select("psid gcFollowUp")
      .limit(opts.limit || 100)
      .lean();

    for (const c of rows) {
      try {
        const sentAt = new Date(c.gcFollowUp.sentAt);
        const reply = await Message.findOne({
          psid: c.psid,
          senderType: "user",
          timestamp: { $gt: sentAt },
        })
          .sort({ timestamp: 1 })
          .select("text timestamp")
          .lean();
        if (!reply) {
          out.pendingReply++;
          continue; // no answer yet — "no respondió" is computed at read time, not stamped
        }

        const ctx = await Message.find({ psid: c.psid, timestamp: { $lte: sentAt } })
          .sort({ timestamp: -1 })
          .limit(8)
          .select("text senderType")
          .lean();
        const turns = ctx
          .reverse()
          .map((m) => ({ role: m.senderType === "user" ? "user" : "bot", text: m.text }));

        const verdict = await classifyFollowUpReply(reply.text, turns);
        const set = {
          "gcFollowUp.repliedAt": reply.timestamp,
          "gcFollowUp.replyText": String(reply.text || "").slice(0, 1000),
        };
        if (verdict) {
          set["gcFollowUp.outcome"] = verdict.outcome;
          set["gcFollowUp.reasonCategory"] = verdict.reasonCategory;
          set["gcFollowUp.reasonNote"] = verdict.reasonNote;
          set["gcFollowUp.analyzedAt"] = new Date();
        }
        // §5D — they confirmed they're done. Close the door on further commercial
        // follow-ups; the engine still answers anything they write.
        if (verdict && verdict.outcome === "no_interesado") {
          set.doNotFollowUp = true;
          set.doNotFollowUpReason = "gc_followup:no_interesado";
          set.doNotFollowUpAt = new Date();
        }
        await Conversation.updateOne({ psid: c.psid }, { $set: set });
        if (verdict) out.analyzed++;
      } catch (err) {
        out.errors++;
        console.error(`❌ GC follow-up reply analysis failed for ${c.psid}:`, err.message);
      }
    }
  } catch (err) {
    out.errors++;
    console.error("❌ runGcFollowUpReplyJob failed:", err.message);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// §8 — the indicators, computed from the stored rows.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {{from?: Date|string, to?: Date|string}} [range]
 */
async function gcFollowUpStats(range = {}) {
  const q = { "gcFollowUp.sentAt": { $ne: null } };
  if (range.from || range.to) {
    q["gcFollowUp.sentAt"] = {
      $ne: null,
      ...(range.from ? { $gte: new Date(range.from) } : {}),
      ...(range.to ? { $lte: new Date(range.to) } : {}),
    };
  }
  const rows = await Conversation.find(q)
    .select("psid extractedName gcFollowUp")
    .sort({ "gcFollowUp.sentAt": -1 })
    .lean();

  const sent = rows.length;
  const replied = rows.filter((r) => r.gcFollowUp.repliedAt).length;
  const pct = (n) => (sent ? Math.round((n / sent) * 1000) / 10 : 0);

  const outcomes = {};
  const reasons = {};
  for (const r of rows) {
    const o = r.gcFollowUp.outcome;
    if (o) outcomes[o] = (outcomes[o] || 0) + 1;
    const rc = r.gcFollowUp.reasonCategory;
    if (rc) reasons[rc] = (reasons[rc] || 0) + 1;
  }
  // "Clientes que retomaron su interés comercial" — kept interest, or came back asking
  // for a different measure. An inconformidad is a live conversation too, but it is
  // reported on its own line because it is the improvement signal, not a recovery.
  const recovered = (outcomes.interesado || 0) + (outcomes.otra_medida || 0);
  const reasonTotal = Object.values(reasons).reduce((a, b) => a + b, 0);

  // How many eligible conversations the job PASSED OVER, and why (§3.3/§4 made
  // auditable). Counted separately from the sent rows: a skip is not a send.
  const skipAgg = await Conversation.aggregate([
    { $match: { "gcFollowUp.sentAt": null, "gcFollowUp.skipReason": { $ne: null } } },
    { $group: { _id: "$gcFollowUp.skipReason", n: { $sum: 1 } } },
    { $sort: { n: -1 } },
    { $limit: 40 },
  ]).catch(() => []);
  // Group the AI's free-text "no_pendiente:<motivo>" under one head; the motivo itself
  // is useful per-conversation but would make the chart a list of one-offs.
  const skipped = {};
  for (const s of skipAgg) {
    const key = String(s._id || "").split(":")[0] || "otro";
    skipped[key] = (skipped[key] || 0) + s.n;
  }

  return {
    enabled: await isEnabled(),
    window: {
      openHour: WINDOW_OPEN_H,
      closeHour: WINDOW_CLOSE_H,
      saturdayCloseHour: SAT_CLOSE_H,
      sundayClosed: true,
      tz: "America/Mexico_City",
      inWindowNow: inSendWindow(),
      nextOpenAt: nextWindowOpenAt(),
    },
    waitHours: WAIT_MS / 3600e3,
    sent,
    replied,
    notReplied: sent - replied,
    repliedPct: pct(replied),
    notRepliedPct: pct(sent - replied),
    recovered,
    recoveredPct: pct(recovered),
    outcomes,
    reasons,
    reasonPct: Object.fromEntries(
      Object.entries(reasons).map(([k, v]) => [k, reasonTotal ? Math.round((v / reasonTotal) * 1000) / 10 : 0])
    ),
    skipped,
    rows: rows.slice(0, 200).map((r) => ({
      psid: r.psid,
      name: r.extractedName || null,
      sentAt: r.gcFollowUp.sentAt,
      repliedAt: r.gcFollowUp.repliedAt || null,
      replyText: r.gcFollowUp.replyText || null,
      outcome: r.gcFollowUp.outcome || null,
      reasonCategory: r.gcFollowUp.reasonCategory || null,
      reasonNote: r.gcFollowUp.reasonNote || null,
    })),
  };
}

module.exports = {
  runGcFollowUpJob,
  runGcFollowUpReplyJob,
  gcFollowUpStats,
  classifyFollowUpReply,
  // exported for tests
  aiConversationIsPending,
  inSendWindow,
  nextWindowOpenAt,
  inSaturdaySweep,
  dueStatus,
  mxDay,
  hardExclusion,
  isGroundCoverConvo,
  FOLLOW_UP_TEXT,
  WAIT_MS,
  SAT_CLOSE_H,
};
