// node scripts/quotesRouteTest.js — drives the real /quotes routes in-process.
// Needs the DB (it seeds and removes `test:quote-*` docs) and, for the prefill
// case, the LLM. Sends nothing to anyone.
require("dotenv").config();
const mongoose = require("mongoose");
const express = require("express");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const ConvoQuote = require("../models/ConvoQuote");

const A = "test:quote-a", B = "test:quote-b";
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { cond ? pass++ : fail++; if (!cond) console.log(`✗ ${name}`, extra === undefined ? "" : JSON.stringify(extra)); };

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const clean = async () => {
    await Promise.all([Conversation.deleteMany({ psid: { $in: [A, B] } }), Message.deleteMany({ psid: { $in: [A, B] } }), ConvoQuote.deleteMany({ psid: { $in: [A, B] } })]);
  };
  await clean();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { username: "prueba" }; next(); });
  app.use("/quotes", require("../routes/quotesRoutes"));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/quotes`;
  const call = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  };
  try {
    const H = 3600e3, now = Date.now();
    const msg = (psid, hAgo, senderType, text) => ({ psid, senderType, text, timestamp: new Date(now - hAgo * H) });
    // A: two visits, handed off in the second. B: never reached a person.
    await Conversation.create({ psid: A, state: "needs_human", handoffRequested: true, handoffTimestamp: new Date(now - 1.5 * H), lastMessageAt: new Date(now - 1 * H) });
    await Conversation.create({ psid: B, state: "active", lastMessageAt: new Date(now - 1 * H) });
    await Message.insertMany([
      msg(A, 400, "user", "Hola, precio del borde separador de 18 m"),
      msg(A, 399.9, "bot", "El Rollo de 18 m está en $709"),
      msg(A, 2, "user", "Buenas tardes, necesito 10 rollos de malla antimaleza de 4 x 100 m en negro"),
      msg(A, 1.9, "bot", "Con gusto te preparamos tu cotización. ¿Me compartes un teléfono?"),
      msg(A, 1.5, "user", "4421234567"),
      msg(B, 2, "user", "hola"), msg(B, 1.9, "bot", "¡Hola!"),
    ]);

    let r = await call("GET", `/convo/${encodeURIComponent(A)}`);
    ok("A is quotable", r.body.eligible === true, r.body);
    ok("A has two visits", r.body.sessions.length === 2, r.body.sessions);
    ok("default visit is the hand-off's", r.body.defaultSession === 1, r.body.defaultSession);
    ok("no quotes yet", r.body.quotes.length === 0);
    r = await call("GET", `/convo/${encodeURIComponent(B)}`);
    ok("B is not quotable", r.body.eligible === false);

    r = await call("GET", "/catalog");
    const cat = r.body.items;
    ok("catalog loads", cat.length > 100, cat.length);
    const gc = cat.find((c) => /Ground Cover/i.test(c.label) && /4x100/.test(c.label) && /Negro/i.test(c.label));
    ok("catalog has GC 4x100 negro", !!gc);

    r = await call("GET", `/suggest/${encodeURIComponent(A)}?session=1`);
    const s1 = r.body.items || [];
    ok("prefill read by the model", r.body.readByModel === true, r.body);
    ok("prefill found the 4x100 antimaleza", s1.some((i) => i.productId === gc.productId), s1);
    ok("prefill kept the quantity 10", (s1.find((i) => i.productId === gc.productId) || {}).qty === 10, s1);
    ok("prefill did not bring the borde from the OTHER visit", !s1.some((i) => /Borde/i.test(i.label)), s1);
    r = await call("GET", `/suggest/${encodeURIComponent(A)}?session=0`);
    ok("first visit's prefill is the borde", (r.body.items || []).some((i) => /Borde/i.test(i.label) && /18/.test(i.label)), r.body.items);

    const items = [{ productId: gc.productId, label: "lo que sea", qty: 10, source: "bot" }, { productId: null, label: "Flete a Veracruz", qty: 1 }];
    r = await call("POST", "/", { psid: A, session: 1, quoteNumber: "123", items });
    ok("3 digits refused", r.status === 400);
    r = await call("POST", "/", { psid: A, session: 1, quoteNumber: "1234567", items });
    ok("7 digits refused", r.status === 400);
    r = await call("POST", "/", { psid: A, session: 1, quoteNumber: "45678", items: [] });
    ok("no items refused", r.status === 400);
    r = await call("POST", "/", { psid: B, quoteNumber: "45678", items });
    ok("not handed off refused", r.status === 400, r.body);
    r = await call("POST", "/", { psid: "test:quote-nope", quoteNumber: "45678", items });
    ok("unknown conversation refused", r.status === 404);
    r = await call("POST", "/", { psid: { $ne: null }, quoteNumber: "45678", items });
    ok("non-string psid refused", r.status === 400);

    r = await call("POST", "/", { psid: A, session: 1, quoteNumber: " #45678 ", items, note: "  urge  " });
    ok("quote saved", r.status === 200 && r.body.quote.quoteNumber === "45678", r.body);
    const q = r.body.quote;
    ok("label is the catalogue's, not the caller's", q.items[0].label === gc.label && q.items[0].productCode === gc.productCode, q.items[0]);
    ok("free item kept as free", q.items[1].productId === null && q.items[1].label === "Flete a Veracruz" && q.items[1].source === "manual");
    ok("filed under the second visit", new Date(q.sessionStart).getTime() > now - 3 * H, q.sessionStart);
    ok("hand-off time recorded", !!q.handoffAt);
    ok("who and note", q.by === "prueba" && q.note === "urge");
    r = await call("POST", "/", { psid: A, session: 1, quoteNumber: "45678", items });
    ok("same folio twice refused", r.status === 409);
    r = await call("POST", "/", { psid: A, session: 0, quoteNumber: "0099", items: [{ label: "Rollo de borde 18 m", qty: 2 }] });
    ok("second quote, other visit", r.status === 200 && r.body.quote.quoteNumber === "0099", r.body);

    r = await call("GET", `/convo/${encodeURIComponent(A)}`);
    ok("two quotes listed", r.body.quotes.length === 2);
    ok("each visit shows its own folio", r.body.sessions[0].quoteNumbers.join() === "0099" && r.body.sessions[1].quoteNumbers.join() === "45678", r.body.sessions);

    // the Cotizaciones page and the ad-performance column
    await Conversation.updateOne({ psid: A }, { $set: { adId: "test-ad-777", extractedName: "Zutano Pruebas" } });
    r = await call("GET", "/?search=Zutano");
    ok("list finds by customer name", r.body.quotes.length === 2 && r.body.quotes[0].customer.name === "Zutano Pruebas", r.body);
    ok("list carries the ad", r.body.quotes[0].origin && r.body.quotes[0].origin.adId === "test-ad-777", r.body.quotes[0].origin);
    ok("list totals", r.body.totals.quotes === 2 && r.body.totals.conversations === 1, r.body.totals);
    r = await call("GET", "/?search=45678");
    ok("list finds by folio", r.body.quotes.length >= 1 && r.body.quotes.some((x) => x.psid === A && x.quoteNumber === "45678"));
    r = await call("GET", "/?search=" + encodeURIComponent("(("));
    ok("a regex-breaking search does not 500", r.status === 200);
    r = await call("GET", "/?limit=1&page=1");
    ok("pagination", r.body.quotes.length === 1 && r.body.pagination.limit === 1);
    r = await call("GET", "/by-ad");
    ok("by-ad counts the conversation once, both quotes", r.body.byAd["test-ad-777"] && r.body.byAd["test-ad-777"].conversations === 1 && r.body.byAd["test-ad-777"].quotes === 2, r.body.byAd["test-ad-777"]);
    r = await call("GET", "/by-ad?dateTo=2020-01-01T00:00:00.000Z");
    ok("by-ad honours the range", !r.body.byAd["test-ad-777"]);

    r = await call("PUT", `/${q._id}`, { quoteNumber: "0099" });
    ok("edit into a taken folio refused", r.status === 409);
    r = await call("PUT", `/${q._id}`, { quoteNumber: "456789", items: [{ productId: gc.productId, qty: 12 }] });
    ok("edit saved", r.status === 200 && r.body.quote.quoteNumber === "456789" && r.body.quote.items.length === 1 && r.body.quote.items[0].qty === 12, r.body);
    r = await call("PUT", "/not-an-id", { quoteNumber: "1234" });
    ok("bad id refused", r.status === 400);
    r = await call("DELETE", `/${q._id}`);
    ok("deleted", r.body.deleted === 1);
    r = await call("GET", `/convo/${encodeURIComponent(A)}`);
    ok("one quote left", r.body.quotes.length === 1);
  } catch (e) {
    fail++; console.log("✗ threw:", e.stack);
  } finally {
    await clean();
    server.close();
    console.log(`\n${pass}/${pass + fail} passed`);
    process.exit(fail ? 1 : 0);
  }
})();
