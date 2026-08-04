// utils/cannedTokens.js
//
// Resolves the dynamic {{tokens}} inside a canned message AT INSERT TIME, against
// the current conversation + live inventory. Price rule: the message's own number
// (the token fallback) is AUTHORITATIVE — the agent curates it; live inventory only
// fills a line the message leaves blank (a token with no fallback). Links/store are
// stamped with the customer's PSID for attribution.
//
// Tokens:
//   {{agente}}            → the logged-in agent's given name
//   {{nombre}}            → the customer's given name (harvested)
//   {{tienda}}            → ML store link + ?psid=… (attribution)
//   {{precio:CODE|1234}}  → live price for productCode CODE; else the 1234 fallback
//   {{link:CODE}}         → live buy link for productCode CODE; else the store link
const { resolvePrice } = require("../ai/workflow/priceResolver");
const { firstGivenName } = require("../ai/workflow/handoffGate");

const fmtPrice = (n) =>
  "$" + Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const storeLink = (psid) =>
  psid
    ? `https://www.mercadolibre.com.mx/tienda/distribuidora-hanlob?psid=${encodeURIComponent(psid)}#from=share_eshop`
    : "https://www.mercadolibre.com.mx/tienda/distribuidora-hanlob#from=share_eshop";

async function resolveCannedTokens(body, ctx = {}) {
  const ProductFamily = require("../models/ProductFamily");
  let out = String(body || "");
  const store = storeLink(ctx.psid);

  // simple text tokens
  out = out.replace(/\{\{agente\}\}/gi, firstGivenName(ctx.agentName || "") || "el equipo de Hanlob");
  out = out.replace(/\{\{nombre\}\}/gi, firstGivenName(ctx.customerName || "") || "");
  out = out.replace(/\{\{tienda\}\}/gi, store);

  // {{precio:CODE|fallback}} — the message's own number (fallback) is AUTHORITATIVE:
  // the agent curates it. Live inventory is used ONLY when the message gives no
  // number for that line (no fallback). This keeps quotes at the agent's price and
  // never lets a stray/higher ML listing over-quote a customer.
  for (const tk of [...out.matchAll(/\{\{precio:([A-Z0-9-]+)(?:\|([\d.]+))?\}\}/gi)]) {
    const [full, code, fallback] = tk;
    let price = fallback != null ? Number(fallback) : null;
    if (price == null) {
      try {
        const p = await ProductFamily.findOne({ productCode: code }).lean();
        if (p) { const r = await resolvePrice(p); if (r && r.amount) price = r.amount; }
      } catch (_) { /* leave unresolved */ }
    }
    out = out.replace(full, price != null ? fmtPrice(price) : "(consultar)");
  }

  // {{link:CODE}} — live buy link, else the store link
  for (const tk of [...out.matchAll(/\{\{link:([A-Z0-9-]+)\}\}/gi)]) {
    const [full, code] = tk;
    let link = "";
    try {
      const p = await ProductFamily.findOne({ productCode: code }).lean();
      if (p) { const r = await resolvePrice(p); link = r.link || ""; }
    } catch (_) { /* fall through */ }
    out = out.replace(full, link || store);
  }

  return out;
}

module.exports = { resolveCannedTokens, storeLink };
