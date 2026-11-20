// node scripts/quoteSessionsTest.js — no DB/LLM/network.
// The visit split, the folio cleaner and the prefill's validation layer.
const { cleanQuoteNumber, splitSessions, sessionIndexAt, quotesOfSession } = require("../utils/quoteSessions");
const { shapeSuggestion } = require("../utils/quoteSuggest");
let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  if (!ok) console.log(`✗ ${name}\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`);
};
const H = 3600e3, t0 = Date.UTC(2026, 10, 3, 15);
const m = (h, senderType, text) => ({ timestamp: new Date(t0 + h * H), senderType, text });

// folio
eq("4 digits", cleanQuoteNumber("1234"), "1234");
eq("6 digits", cleanQuoteNumber("123456"), "123456");
eq("leading zero kept", cleanQuoteNumber("00123"), "00123");
eq("pasted with label", cleanQuoteNumber("Cot. #45 678"), "45678");
eq("number type", cleanQuoteNumber(98765), "98765");
eq("3 digits refused", cleanQuoteNumber("123"), null);
eq("7 digits refused", cleanQuoteNumber("1234567"), null);
eq("empty refused", cleanQuoteNumber(""), null);
eq("null refused", cleanQuoteNumber(null), null);
eq("object refused", cleanQuoteNumber({ $ne: null }), null);

// visits
const msgs = [
  m(0, "user", "precio del borde"), m(0.1, "bot", "6 m $…"), m(5, "user", "el de 18"),
  m(400, "user", "ahora quiero un rollo de antimaleza"), m(400.2, "bot", "2x100…"), m(401, "human", "le cotizo"),
  m(900, "user", "y malla sombra 4x6?"),
];
const s = splitSessions([...msgs].reverse()); // order must not matter
eq("three visits", s.length, 3);
eq("visit sizes", s.map((x) => x.count), [3, 3, 1]);
eq("first user text", s[1].firstUserText, "ahora quiero un rollo de antimaleza");
eq("user counts", s.map((x) => x.userCount), [2, 1, 1]);
eq("11h gap stays one visit", splitSessions([m(0, "user", "a"), m(11, "user", "b")]).length, 1);
eq("13h gap is two", splitSessions([m(0, "user", "a"), m(13, "user", "b")]).length, 2);
eq("empty", splitSessions([]), []);
eq("no timestamp dropped", splitSessions([{ text: "x", senderType: "user" }]), []);
eq("visit with no customer message", splitSessions([m(0, "bot", "hola")])[0].firstUserText, null);

// which visit a hand-off belongs to
eq("hand-off inside 2nd", sessionIndexAt(s, new Date(t0 + 400.5 * H)), 1);
eq("hand-off just after 2nd", sessionIndexAt(s, new Date(t0 + 402 * H)), 1);
eq("no hand-off → last", sessionIndexAt(s, null), 2);
eq("before everything → first", sessionIndexAt(s, new Date(t0 - 50 * H)), 0);
eq("no visits", sessionIndexAt([], null), -1);

// which quotes sit on which visit
const quotes = [
  { quoteNumber: "1111", sessionStart: s[1].start, sessionEnd: s[1].end },
  { quoteNumber: "2222", sessionStart: s[1].start, sessionEnd: s[1].end },
  { quoteNumber: "3333", sessionStart: s[2].start, sessionEnd: s[2].end },
  { quoteNumber: "4444", sessionStart: null, sessionEnd: null },
];
eq("two quotes on one visit", quotesOfSession(s[1], quotes).map((q) => q.quoteNumber), ["1111", "2222"]);
eq("none on the first", quotesOfSession(s[0], quotes), []);
eq("one on the third", quotesOfSession(s[2], quotes).map((q) => q.quoteNumber), ["3333"]);

// the prefill never trusts the model
const cat = [
  { productId: "a1", productCode: "GC-NEG-04X100", label: "Ground Cover > 4x100 > Negro" },
  { productId: "b2", productCode: "CIN-BOR-GRU-18M", label: "Borde > Grueso > Rollo de 18 m" },
  { productId: "c3", productCode: null, label: "sin código" },
];
const sh = shapeSuggestion({
  tema: "Rollo antimaleza 4x100",
  items: [
    { codigo: "GC-NEG-04X100", cantidad: 10 }, { codigo: "gc-neg-04x100", cantidad: 3 }, // duplicate
    { codigo: "INVENTADO-99", cantidad: 2 }, { codigo: "CIN-BOR-GRU-18M", cantidad: "muchos" }, { cantidad: 4 },
  ],
  libres: [{ descripcion: "Malla confeccionada 6.20 x 18 m a la medida", cantidad: 1 }, { descripcion: "x" }, null],
}, cat);
eq("known codes only, once", sh.items.filter((i) => i.productId).map((i) => i.productCode), ["GC-NEG-04X100", "CIN-BOR-GRU-18M"]);
eq("qty kept", sh.items[0].qty, 10);
eq("bad qty → 1", sh.items[1].qty, 1);
eq("free text kept as free text", sh.items[2], { productId: null, productCode: null, label: "Malla confeccionada 6.20 x 18 m a la medida", qty: 1, source: "bot" });
eq("too-short free text dropped", sh.items.length, 3);
eq("label is OURS, not the model's", sh.items[0].label, "Ground Cover > 4x100 > Negro");
eq("topic", sh.topic, "Rollo antimaleza 4x100");
eq("garbage in", shapeSuggestion(null, cat), { topic: null, items: [] });
eq("wrong shapes", shapeSuggestion({ tema: 5, items: "x", libres: {} }, cat), { topic: null, items: [] });
eq("negative qty → 1", shapeSuggestion({ items: [{ codigo: "GC-NEG-04X100", cantidad: -3 }] }, cat).items[0].qty, 1);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
