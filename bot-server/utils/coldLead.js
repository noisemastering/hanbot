// utils/coldLead.js
//
// A COLD LEAD is a conversation the bot asked for contact data before escalating, and
// which then went silent without giving any of it — no phone, no email, no CP. The
// pending-handoff timeout parks it instead of alerting a salesperson (jobs/silenceFollowUp.js,
// 2026-10-27: "me mandó la alerta y el cliente aún no contesta nada"), because a lead
// with nothing but a profile name is nothing anyone can act on.
//
// It stops being cold the moment the customer writes again — whatever they write. That
// is one line, but it has to fire on BOTH channels, and the two channels save their
// inbound messages through two separate saveMessage implementations (index.js for
// Messenger, channels/unified/processor.js for WhatsApp), which is exactly the kind of
// half-wiring the Dual Channel Rule exists to prevent. Hence one helper, called twice.
//
// revivedAt is STAMPED, not cleared: the list shows only the still-dead leads, while
// the parking itself stays auditable (coldLead.times counts how often it happened).

/**
 * What the asesor would actually have to work with. Deliberately narrow: a NAME is not
 * contact (the platform profile hands us one for free on every conversation, which is
 * exactly how the dead lead looked "complete"), and neither is a product, a measure or
 * a colonia. The CP counts because the freight quote starts there, and because asking
 * for it is half of what the bot asked for.
 *
 * It lives here rather than in the job so it can be tested without dragging the whole
 * flow manager (and an OpenAI client) in behind it: scripts/coldLeadTest.js.
 *
 * @param {object} c a Conversation document (lean or hydrated)
 * @returns {{phone: string|null, email: string|null, zip: string|null, any: boolean}}
 */
function handoffContactOf(c) {
  const ws = (c && c.workflowState) || {};
  const lead = ws.lead || {};
  const loc = ws.location || {};
  const phone = lead.phone || (c && c.leadData && c.leadData.contact) || null;
  const email = lead.email || null;
  const zip =
    (c && (c.zipcode || c.zipCode)) || loc.zip || loc.zipcode ||
    (c && c.leadData && c.leadData.zipcode) || (c && c.humanSalesZipcode) || null;
  return { phone: phone || null, email: email || null, zip: zip || null, any: !!(phone || email || zip) };
}

/**
 * Is a SILENT lead worth a salesperson's PUSH?
 *
 * Narrower than handoffContactOf on purpose: **a CP alone is not** (2026-11-04,
 * wa:5217351681034, reported twice the same morning — "Me mandó la alerta y no requería
 * atención"). She asked what the shipping cost, gave CP 72760 in answer to that, asked
 * "Precio del rollo", got both roll prices — and then stopped writing. The pending ask
 * was for a PHONE and a COLONIA; she answered neither, so the 10-minute timeout fired
 * on a conversation where nothing was outstanding.
 *
 * The CP still counts as contact everywhere else, because the freight quote starts
 * there and it is half of what the bot asks for — but it is not something a person can
 * ACT on. On WhatsApp the thread (and the number itself) is always available anyway, so
 * a CP adds no way to reach anybody; what it does is help quote a customer who is still
 * talking to us. A phone or an email the customer TYPED is different: they volunteered a
 * way to be contacted, which is worth waking someone for even if they then went quiet.
 *
 * Measured over the 21 days to 2026-11-04: ONE timeout escalation got through the
 * cold-lead split, and it was this one. 39 leads were parked, 10 of them wrote back.
 *
 * @param {object} c a Conversation document (lean or hydrated)
 * @returns {boolean}
 */
function worthAlerting(c) {
  const have = handoffContactOf(c);
  return !!(have.phone || have.email);
}

/**
 * Mark a parked lead as revived because the customer wrote back. No-op for every
 * conversation that was never parked, which is almost all of them — one indexed
 * updateOne against psid, and nothing is written when the filter misses.
 *
 * @param {string} psid
 */
async function reviveColdLead(psid) {
  if (!psid) return false;
  try {
    const Conversation = require("../models/Conversation");
    const res = await Conversation.updateOne(
      { psid, "coldLead.at": { $ne: null }, "coldLead.revivedAt": null },
      { $set: { "coldLead.revivedAt": new Date() } }
    );
    const n = res.modifiedCount || res.nModified || 0;
    if (n) console.log(`🌱 [cold-lead] ${psid} wrote back — out of the cold list`);
    return !!n;
  } catch (e) {
    console.error("⚠️ reviveColdLead failed:", e.message);
    return false;
  }
}

module.exports = { reviveColdLead, handoffContactOf, worthAlerting };
