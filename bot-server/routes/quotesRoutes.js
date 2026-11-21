// routes/quotesRoutes.js — "Cotizada": the mark a salesperson puts on a
// conversation the bot handed over, with the folio from the quoting system and
// the items it covers. See models/ConvoQuote.js for what it is and is not.
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const ConvoQuote = require("../models/ConvoQuote");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const ClickLog = require("../models/ClickLog");
const { cleanQuoteNumber, splitSessions, sessionIndexAt, quotesOfSession } = require("../utils/quoteSessions");
const { loadCatalog, suggestItems } = require("../utils/quoteSuggest");

const whoIs = (req) => (req.user && (req.user.username || req.user.email || req.user.name)) || "dashboard";

// Nothing from the body is stored as it came: a label, a whole quantity, and a
// product id only when it is one of ours.
async function cleanItems(raw) {
  const catalog = await loadCatalog();
  const byId = new Map(catalog.map((c) => [c.productId, c]));
  const out = [];
  for (const it of Array.isArray(raw) ? raw.slice(0, 40) : []) {
    if (!it || typeof it !== "object") continue;
    const c = typeof it.productId === "string" ? byId.get(it.productId) : null;
    const label = c ? c.label : String(typeof it.label === "string" ? it.label : "").trim().slice(0, 160);
    if (!label) continue;
    const q = Number(it.qty);
    out.push({
      productId: c ? c.productId : null,
      productCode: c ? c.productCode : null,
      label,
      qty: Number.isFinite(q) && q >= 1 ? Math.min(Math.round(q), 100000) : 1,
      source: it.source === "bot" ? "bot" : "manual",
    });
  }
  return out;
}

async function loadConvo(psid) {
  const [convo, messages, quotes] = await Promise.all([
    Conversation.findOne({ psid }).select("psid state handoffRequested handoffTimestamp handoffReason").lean(),
    Message.find({ psid }).select("text senderType timestamp").sort({ timestamp: 1 }).lean(),
    ConvoQuote.find({ psid }).sort({ createdAt: -1 }).lean(),
  ]);
  // "On every hand-off": the conversation reached a person — the bot escalated
  // it, or a human is (or was) the one answering.
  const eligible =
    !!convo &&
    (!!convo.handoffRequested || !!convo.handoffTimestamp ||
      ["needs_human", "human_active"].includes(convo.state) ||
      messages.some((m) => m.senderType === "human"));
  return { convo, messages, quotes, eligible };
}

// The catalogue the asesor confirms against (and searches to add an item).
router.get("/catalog", async (req, res) => {
  try {
    res.json({ success: true, items: await loadCatalog() });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// A date range on the day the quote was RECORDED. Bad or missing dates are ignored.
function rangeOf(q) {
  const out = {};
  const from = typeof q.dateFrom === "string" ? new Date(q.dateFrom) : null;
  const to = typeof q.dateTo === "string" ? new Date(q.dateTo) : null;
  if (from && !isNaN(from)) out.$gte = from;
  if (to && !isNaN(to)) out.$lte = to;
  return Object.keys(out).length ? { createdAt: out } : {};
}

// The list for the Cotizaciones page: every quote with who it is for and which
// ad the conversation came from.
router.get("/", async (req, res) => {
  try {
    const { escapeRegex } = require("../utils/escapeRegex");
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
    const filter = rangeOf(req.query);
    const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 60) : "";
    if (search) {
      const re = new RegExp(escapeRegex(search), "i");
      const named = await Conversation.find({
        $or: [{ extractedName: re }, { "workflowState.lead.name": re }, { crmName: re }],
      }).select("psid").limit(500).lean();
      filter.$or = [
        { quoteNumber: re }, { "items.label": re }, { "items.productCode": re }, { psid: re },
        { psid: { $in: named.map((c) => c.psid) } },
      ];
    }
    const [total, rows, totalsAgg] = await Promise.all([
      ConvoQuote.countDocuments(filter),
      ConvoQuote.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      ConvoQuote.aggregate([{ $match: filter }, { $group: { _id: "$psid" } }, { $count: "n" }]),
    ]);
    const convos = await Conversation.find({ psid: { $in: rows.map((r) => r.psid) } })
      .select("psid channel extractedName crmName workflowState.lead adId adHeadline adSourceUrl ctwaClid city stateMx").lean();
    const byPsid = new Map(convos.map((c) => [c.psid, c]));
    const { resolveAdNames, originOf } = require("../utils/adOrigin");
    const names = await resolveAdNames(convos.map((c) => c.adId));
    res.json({
      success: true,
      quotes: rows.map((q) => {
        const c = byPsid.get(q.psid) || null;
        const lead = (c && c.workflowState && c.workflowState.lead) || {};
        return {
          ...q,
          customer: {
            name: lead.name || (c && (c.crmName || c.extractedName)) || null,
            phone: lead.phone || (String(q.psid).startsWith("wa:") ? String(q.psid).slice(3) : null),
            channel: (c && c.channel) || (String(q.psid).startsWith("wa:") ? "whatsapp" : "facebook"),
            city: (c && c.city) || null,
            state: (c && c.stateMx) || null,
          },
          origin: c ? originOf(c, names) : null,
        };
      }),
      totals: { quotes: total, conversations: (totalsAgg[0] && totalsAgg[0].n) || 0 },
      pagination: { page, limit, total, pages: Math.max(Math.ceil(total / limit), 1) },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Quoted conversations per AD, for the ad-performance table: how many
// conversations that came from each ad carry a quote recorded in the range.
router.get("/by-ad", async (req, res) => {
  try {
    const rows = await ConvoQuote.find(rangeOf(req.query)).select("psid").lean();
    const psids = [...new Set(rows.map((r) => r.psid))];
    const quotesOf = {};
    for (const r of rows) quotesOf[r.psid] = (quotesOf[r.psid] || 0) + 1;
    const convos = await Conversation.find({ psid: { $in: psids } }).select("psid adId").lean();
    const adOf = new Map(convos.map((c) => [c.psid, c.adId ? String(c.adId) : null]));
    const byAd = {};
    let noAd = 0;
    for (const psid of psids) {
      const ad = adOf.get(psid);
      if (!ad) { noAd++; continue; }
      const e = (byAd[ad] = byAd[ad] || { conversations: 0, quotes: 0 });
      e.conversations++;
      e.quotes += quotesOf[psid];
    }
    res.json({ success: true, byAd, noAd, total: psids.length });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Everything the panel needs: is it quotable, its quotes, and its visits.
router.get("/convo/:psid", async (req, res) => {
  try {
    const { convo, messages, quotes, eligible } = await loadConvo(req.params.psid);
    const sessions = splitSessions(messages);
    res.json({
      success: true,
      eligible,
      handoffAt: (convo && convo.handoffTimestamp) || null,
      defaultSession: sessionIndexAt(sessions, convo && convo.handoffTimestamp),
      sessions: sessions.map((s) => ({
        index: s.index, start: s.start, end: s.end, count: s.count, userCount: s.userCount,
        firstUserText: s.firstUserText,
        quoteNumbers: quotesOfSession(s, quotes).map((q) => q.quoteNumber),
      })),
      quotes,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// The bot's prefill for ONE visit. Reads, suggests, saves nothing.
router.get("/suggest/:psid", async (req, res) => {
  try {
    const psid = req.params.psid;
    const { messages } = await loadConvo(psid);
    const sessions = splitSessions(messages);
    if (!sessions.length) return res.json({ success: true, topic: null, items: [], readByModel: false });
    const asked = Number(req.query.session);
    const s = sessions[Number.isInteger(asked) && asked >= 0 && asked < sessions.length ? asked : sessions.length - 1];
    const clicks = await ClickLog.find({
      psid, productId: { $ne: null },
      createdAt: { $gte: s.start, $lte: new Date(s.end.getTime() + 60 * 1000) },
    }).select("productId").lean();
    const out = await suggestItems(s.messages, clicks.map((c) => c.productId).filter(Boolean));
    res.json({ success: true, session: s.index, ...out });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const body = req.body || {};
    const psid = typeof body.psid === "string" ? body.psid : null;
    if (!psid) return res.status(400).json({ success: false, error: "Falta la conversación" });
    const quoteNumber = cleanQuoteNumber(body.quoteNumber);
    if (!quoteNumber) return res.status(400).json({ success: false, error: "El número de cotización debe tener de 4 a 6 dígitos" });
    const { convo, messages, eligible } = await loadConvo(psid);
    if (!convo) return res.status(404).json({ success: false, error: "Conversación no encontrada" });
    if (!eligible) return res.status(400).json({ success: false, error: "Esta conversación no ha pasado a una persona" });
    const items = await cleanItems(body.items);
    if (!items.length) return res.status(400).json({ success: false, error: "Agrega al menos un producto cotizado" });
    const sessions = splitSessions(messages);
    const asked = Number(body.session);
    const s = sessions[Number.isInteger(asked) && asked >= 0 && asked < sessions.length ? asked : sessions.length - 1] || null;
    if (await ConvoQuote.exists({ psid, quoteNumber })) {
      return res.status(409).json({ success: false, error: `La cotización ${quoteNumber} ya está registrada en esta conversación` });
    }
    const hAt = convo.handoffTimestamp ? new Date(convo.handoffTimestamp) : null;
    const quote = await ConvoQuote.create({
      psid, quoteNumber, items,
      sessionStart: s ? s.start : null,
      sessionEnd: s ? s.end : null,
      handoffAt: hAt && s && hAt >= s.start && hAt.getTime() <= s.end.getTime() + 12 * 3600e3 ? hAt : null,
      note: typeof body.note === "string" ? body.note.trim().slice(0, 500) || null : null,
      by: whoIs(req),
    });
    // The same number on a DIFFERENT customer is worth a second look (a paste
    // into the wrong chat), but it is the asesor's call — so we say it, not block it.
    const elsewhere = await ConvoQuote.find({ quoteNumber, psid: { $ne: psid } }).select("psid").limit(3).lean();
    res.json({ success: true, quote, alsoIn: elsewhere.map((q) => q.psid) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, error: "Id inválido" });
    const quote = await ConvoQuote.findById(req.params.id);
    if (!quote) return res.status(404).json({ success: false, error: "Cotización no encontrada" });
    const body = req.body || {};
    if (body.quoteNumber !== undefined) {
      const n = cleanQuoteNumber(body.quoteNumber);
      if (!n) return res.status(400).json({ success: false, error: "El número de cotización debe tener de 4 a 6 dígitos" });
      if (n !== quote.quoteNumber && (await ConvoQuote.exists({ psid: quote.psid, quoteNumber: n }))) {
        return res.status(409).json({ success: false, error: `La cotización ${n} ya está registrada en esta conversación` });
      }
      quote.quoteNumber = n;
    }
    if (body.items !== undefined) {
      const items = await cleanItems(body.items);
      if (!items.length) return res.status(400).json({ success: false, error: "Agrega al menos un producto cotizado" });
      quote.items = items;
    }
    if (body.note !== undefined) quote.note = typeof body.note === "string" ? body.note.trim().slice(0, 500) || null : null;
    await quote.save();
    res.json({ success: true, quote });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, error: "Id inválido" });
    const r = await ConvoQuote.deleteOne({ _id: req.params.id });
    res.json({ success: true, deleted: r.deletedCount });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
