// ONE owner for "did Meta really send this webhook?".
//
// POST /webhook (Messenger) and POST /webhook/whatsapp are public by necessity, and
// until 2026-11-13 they believed anything: nobody checked Meta's signature, so anyone
// who knew the URL could post a made-up "customer message" and the bot would store it,
// spend a model turn on it and SEND A REPLY to whatever customer id the payload named.
//
// Meta signs every delivery: `X-Hub-Signature-256: sha256=<HMAC-SHA256(raw body, app
// secret)>`. `signatureVerdict` is that check and nothing else — pure, no I/O.
//
// THE ROLLOUT IS SELF-ARMING, and that is deliberate. A wrong or missing app secret
// would make every real delivery look forged and the bot would go SILENT for every
// customer — the costliest failure this project has — and the deployment's variables
// are not ours to inspect or change. So a channel starts in OBSERVE mode (verdicts are
// counted, nothing is refused) and ARMS ITSELF the first time a delivery on that
// channel verifies. One valid signature proves the secret we hold is the right one,
// and a forger cannot produce it, so arming can only be triggered by Meta. Once armed,
// anything on that channel that does not verify is refused. Arming is stored in Mongo
// (`webhook_guard`), so it survives restarts and is shared by every instance.
const crypto = require("crypto");
const mongoose = require("mongoose");

const VALID = "valid", INVALID = "invalid", MISSING = "missing", NO_SECRET = "no_secret";

// Pure. `secrets` may hold more than one candidate (Messenger and WhatsApp can belong
// to different Meta apps); the delivery is valid if ANY of them produced the signature.
function signatureVerdict(rawBody, header, secrets) {
  const usable = (secrets || []).filter((s) => typeof s === "string" && s.trim());
  if (!usable.length) return NO_SECRET;
  if (typeof header !== "string" || !Buffer.isBuffer(rawBody)) return MISSING;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!m) return MISSING;
  const given = Buffer.from(m[1].toLowerCase(), "hex");
  for (const secret of usable) {
    const want = crypto.createHmac("sha256", secret.trim()).update(rawBody).digest();
    if (want.length === given.length && crypto.timingSafeEqual(want, given)) return VALID;
  }
  return INVALID;
}

// The one decision: may this delivery be processed?
function decide(verdict, armed) {
  if (verdict === VALID) return true;
  return !armed; // observe mode lets it through; an armed channel refuses it
}

// ---- state (Mongo-backed, cached per process) ------------------------------------
const armedCache = {};            // channel -> true once armed (never un-arms itself)
const lastValidAt = {};           // channel -> ms, this process
const refusedSinceValid = {};     // channel -> count, this process
let alertedAt = 0;
const col = () => mongoose.connection.collection("webhook_guard");

function appSecrets() {
  return [process.env.FB_APP_SECRET, process.env.WHATSAPP_APP_SECRET, process.env.META_APP_SECRET];
}

async function isArmed(channel) {
  if (armedCache[channel]) return true;
  const doc = await col().findOne({ _id: channel }, { projection: { armedAt: 1 } });
  if (doc && doc.armedAt) armedCache[channel] = true;
  return !!armedCache[channel];
}

function record(channel, verdict, extra) {
  const set = { [`last.${verdict}`]: new Date(), ...(extra || {}) };
  col().updateOne({ _id: channel }, { $inc: { [`count.${verdict}`]: 1 }, $set: set }, { upsert: true }).catch(() => {});
}

// If an ARMED channel refuses several deliveries in a row and has verified none for a
// while, that is either an attack or the app secret was rotated at Meta — and the second
// one means the bot is silent. Either way a person must know. Once per 6 h.
function maybeAlert(channel) {
  refusedSinceValid[channel] = (refusedSinceValid[channel] || 0) + 1;
  const quietFor = Date.now() - (lastValidAt[channel] || 0);
  if (refusedSinceValid[channel] < 5 || quietFor < 30 * 60 * 1000) return;
  if (Date.now() - alertedAt < 6 * 60 * 60 * 1000) return;
  alertedAt = Date.now();
  try {
    const { sendToSuperAdmins } = require("../services/pushNotifications");
    Promise.resolve(sendToSuperAdmins(
      "⚠️ Webhooks rechazados",
      `El canal ${channel} lleva ${refusedSinceValid[channel]} entregas con firma inválida y ninguna válida en 30+ min. Si Meta rotó el app secret, el bot está en silencio.`,
      "/"
    )).catch(() => {});
  } catch { /* alerting must never break the webhook */ }
}

// Express-facing. Returns true when the delivery may be processed; when it returns
// false the response has already been sent (403).
async function acceptWebhook(channel, req, res) {
  let verdict, armed = false;
  try {
    verdict = signatureVerdict(req.rawBody, req.headers["x-hub-signature-256"], appSecrets());
    armed = await isArmed(channel);
    if (verdict === VALID) {
      lastValidAt[channel] = Date.now();
      refusedSinceValid[channel] = 0;
      if (!armed) {
        armedCache[channel] = true;
        record(channel, verdict, { armedAt: new Date() });
        console.log(`🔐 Webhook signature check ARMED for ${channel}`);
        return true;
      }
    }
  } catch (e) {
    // A failure of the CHECK ITSELF (DB read) must not silence the bot: fall back to
    // whatever this process already knows about the channel.
    console.error("⚠️ webhook signature check failed:", e.message);
    armed = !!armedCache[channel];
    verdict = verdict || MISSING;
  }
  record(channel, verdict);
  if (decide(verdict, armed)) return true;
  console.warn(`🚫 Refused ${channel} webhook: signature ${verdict}`);
  maybeAlert(channel);
  res.sendStatus(403);
  return false;
}

module.exports = { signatureVerdict, decide, acceptWebhook, VALID, INVALID, MISSING, NO_SECRET };
