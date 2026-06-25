// ai/workflow/tools.js
//
// Tool registry for the workflow engine. Each tool has an Anthropic tool
// definition (schema the model sees) and an execute() the runtime runs when the
// model calls it. A node only gets the tools listed in its `toolsAllowed`;
// anything else is stripped before the request (never exposed to the model).
//
// In Phase 1 the executors are lightweight: they record the intent on the state
// and return a confirmation string. Wiring them to the existing helpers
// (ML links, handoff trigger, lead capture, location stats) happens hands-on
// later — kept behind this single seam so the engine doesn't change.

// Full ancestry path of a ProductFamily ("Root > ... > Family"), cached. Used to
// describe a flow's realm to the scope classifier: a bare leaf name like
// "Rectangular" isn't recognizable as a product, but "Malla Sombra Raschel >
// 90% > Confeccionada con Refuerzo > Rectangular" is — so the flow becomes
// summonable from cold-start / any other flow.
const _pathCache = new Map();
async function familyFullPath(PF, id) {
  const key = String(id);
  if (_pathCache.has(key)) return _pathCache.get(key);
  const path = [];
  let cur = await PF.findById(key).select("name parentId").lean();
  let guard = 0;
  while (cur && guard++ < 12) {
    if (cur.name) path.unshift(cur.name);
    if (!cur.parentId) break;
    cur = await PF.findById(cur.parentId).select("name parentId").lean();
  }
  const out = path.join(" > ");
  _pathCache.set(key, out);
  return out;
}

// Normalize a measure/product query to comparable dimension tokens.
// "4x3", "4 x 3 m", "4 por 3", "de 4x3 metros" → ["4","3"] (sorted for order-insensitivity).
function dimsOf(text) {
  if (!text) return null;
  // Strip metric units, including 'm' glued to a digit ("6m" → "6"), AND the
  // descriptive words customers put between the numbers and the separator
  // ("13 de largo x 3 de ancho", "13 metros de largo por 3 de ancho") — without
  // this, the number isn't adjacent to the x/por and the match fails.
  const m = String(text)
    .toLowerCase()
    .replace(/(\d)\s*(?:m\b|mts?\b|metros?\b)/g, "$1 ")
    .replace(/\bmts?\.?\b|\bmetros?\b|\bm\b/g, " ")
    .replace(/\bde\s+(?:largo|ancho|alto|altura|fondo|lado)\b/g, " ") // "13 de largo x 3 de ancho" → "13 x 3"
    .replace(/\b(?:largo|ancho|alto|altura|fondo)\s+de\b/g, " ")      // "largo de 13 x ancho de 3"
    .match(/(\d+(?:\.\d+)?)\s*(?:[x×*]|por)\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  // Sort numerically so "6x4" and "4x6" compare equal regardless of order.
  return [m[1], m[2]].map(Number).sort((a, b) => a - b);
}

// Find a sellable product in the flow's family subtrees that matches the
// customer's requested measure/name. Returns the ProductFamily doc or null.
async function findProductInFamilies(query, familyList, wantDimsArg = null) {
  if (!query) return null;
  const PF = require("../../models/ProductFamily");
  const ids = (Array.isArray(familyList) ? familyList : familyList ? [familyList] : [])
    .filter((f) => f && f.id)
    .map((f) => String(f.id));
  if (!ids.length) return null;

  // Gather all sellable descendants of the flow families (BFS, bounded).
  const queue = [...ids];
  const candidates = [];
  let guard = 0;
  while (queue.length && guard++ < 500) {
    const pid = queue.shift();
    const kids = await PF.find({ parentId: pid })
      .select("name size sellable active price mlPrice onlineStoreLinks parentId enabledDimensions")
      .lean();
    for (const k of kids) {
      if (k.sellable && k.active !== false) candidates.push(k);
      queue.push(k._id);
    }
    // also consider the family node itself if it's sellable
  }

  // Wanted dims come from the AI extractor for customer text (passed in); fall
  // back to dimsOf only if not provided. Candidate (catalog) sizes are still
  // parsed with dimsOf — they're clean, controlled "6x4m" strings.
  const wantDims = wantDimsArg || dimsOf(query);
  if (wantDims) {
    // Match the measure against the candidate's SIZE field first, then its
    // name. After a tree restructure the sellable leaf can be named for an
    // attribute ("Color Beige") with the measure living only in `size`
    // ("5x10m") — so name-only matching misses every size. Check both.
    const hit = candidates.find((c) => {
      // A width×length request never matches a length-only product (borde).
      const ed = c.enabledDimensions;
      if (Array.isArray(ed) && ed.length > 0 && !ed.includes("width")) return false;
      const cd = dimsOf(c.size) || dimsOf(c.name);
      return cd && cd[0] === wantDims[0] && cd[1] === wantDims[1];
    });
    if (hit) return hit;
  }
  // Fallback: loose name contains (e.g. a named variant, not a measure).
  const q = query.toLowerCase();
  return candidates.find((c) => (c.name || "").toLowerCase().includes(q)) || null;
}

// When a requested measure isn't in the catalog (e.g. 13x3, out of range),
// find the CLOSEST available measure so the bot can offer a real size and ask
// if the customer still wants the exact one — instead of inventing a size or
// saying "no manejamos decimales". Closeness = squared distance between the
// sorted dimension pairs (so 13x3 → nearest by both width and length).
// Returns the measure object from availableMeasuresForFamilies, or null.
async function closestAvailableMeasure(query, familyList, wantDimsArg = null) {
  const want = wantDimsArg || dimsOf(query);
  if (!want) return null;
  const measures = await availableMeasuresForFamilies(familyList);

  // A two-number (width × length) request — e.g. "4x50" — is by definition a
  // 2-D product (malla rollo / confeccionada). LENGTH-ONLY products (borde
  // separador: you choose only a length; the 13 cm is a fixed height spec, not a
  // width) are a different KIND of product and must never match. The catalog
  // tells us which is which via enabledDimensions (no "width" → length-only),
  // so this is a structural exclusion, not a numeric guess. This is why "4 m"
  // can never match "13 cm".
  const candidates = measures.filter((m) => m.dims && !m.lengthOnly);
  if (!candidates.length) return null; // no 2-D product in scope → don't offer a length-only one

  // Among real 2-D products, pick the closest by RELATIVE distance (squared
  // log-ratio) so scale is respected proportionally: "4x50" lands on "4x100",
  // not on a smaller piece that's near in raw units.
  let best = null;
  let bestDist = Infinity;
  for (const m of candidates) {
    const dw = Math.log(m.dims[0] / want[0]);
    const dl = Math.log(m.dims[1] / want[1]);
    const d = dw * dw + dl * dl;
    if (d < bestDist) {
      bestDist = d;
      best = m;
    }
  }
  return best;
}

// Given a resolved product leaf, return its sibling VARIANTS — the other
// sellable+active products under the same parent that share the same size.
// In a size→color tree, those siblings ARE the available colors for that size.
// Purely structural (no color-word matching): a "variant" = same parent + same
// size. If the leaf has no same-size siblings (e.g. it's a plain size leaf
// directly under a size list), returns just itself → caller sees no choice.
// Returns [{ id, name, label, price, mlPrice, link, sellable, active }].
async function availableVariantsForProduct(productDoc) {
  const PF = require("../../models/ProductFamily");
  if (!productDoc || !productDoc.parentId || !productDoc.size) return [];
  const siblings = await PF.find({ parentId: productDoc.parentId, sellable: true, active: { $ne: false } })
    .select("name size price mlPrice onlineStoreLinks")
    .lean();
  const sizeKey = String(productDoc.size).toLowerCase();
  const variants = siblings.filter((s) => String(s.size || "").toLowerCase() === sizeKey);
  if (variants.length <= 1) return []; // no real variant choice for this size
  return variants.map((v) => ({
    id: String(v._id),
    name: v.name,
    // cosmetic: "Color Beige" → "Beige" for customer-facing display
    label: (v.name || "").replace(/^\s*color\s+/i, "").trim() || v.name,
    price: v.price,
    mlPrice: v.mlPrice,
    link: (v.onlineStoreLinks || []).find((l) => l?.url && /mercadolibre/i.test(l.url))?.url || null,
  }));
}

// Walk DOWN the flow's family tree and return every distinct available measure
// (sellable + active descendants), so the bot can answer "¿qué medidas
// manejas?" with real data. You configure ONLY the family on the flow — this
// discovers all the sizes/lengths under it automatically (no per-product
// selection). Color/variant leaves that share a size collapse to ONE measure.
// Returns measures sorted small→large by area: [{ label, size, price, dims }].
async function availableMeasuresForFamilies(familyList) {
  const PF = require("../../models/ProductFamily");
  const ids = (Array.isArray(familyList) ? familyList : familyList ? [familyList] : [])
    .filter((f) => f && f.id)
    .map((f) => String(f.id));
  if (!ids.length) return [];

  const queue = [...ids];
  const leaves = [];
  let guard = 0;
  while (queue.length && guard++ < 800) {
    const pid = queue.shift();
    const kids = await PF.find({ parentId: pid })
      .select("name size sellable active price parentId enabledDimensions")
      .lean();
    for (const k of kids) {
      if (k.sellable && k.active !== false) leaves.push(k);
      queue.push(k._id);
    }
  }

  // For each sellable leaf, decide what the customer-facing MEASURE is:
  //   - If the leaf's PARENT is a size-group (has its own size, e.g. the
  //     "6m x 4m" node whose children are color leaves) → the measure is the
  //     PARENT (label "6m x 4m"); color variants collapse into it.
  //   - Else the leaf IS the product (e.g. borde's "Rollo de 6 m" sitting
  //     directly under the family) → the measure is the leaf, labelled by its
  //     own NAME (length-focused, not the raw "13x6m" size).
  // Keyed by the measure node's id; keep the cheapest price seen.
  const parentCache = new Map();
  const getParent = async (pid) => {
    const key = String(pid);
    if (parentCache.has(key)) return parentCache.get(key);
    const doc = await PF.findById(pid).select("name size").lean();
    parentCache.set(key, doc);
    return doc;
  };

  // A TRIANGULAR net has three sides ("2 m x 2 m x 2 m"). Per business rule, we
  // do NOT list or suggest triangular nets proactively — only quote them if the
  // customer explicitly asks. (findProductInFamilies still resolves them on an
  // explicit ask; this only keeps them out of the proactive measures list and
  // the "closest measure" suggestions.)
  const isTriangular = (s) => (String(s || "").match(/\d+(?:\.\d+)?/g) || []).length >= 3;

  const byMeasure = new Map();
  for (const leaf of leaves) {
    const parent = leaf.parentId ? await getParent(leaf.parentId) : null;
    const node = parent && parent.size ? parent : leaf; // size-group → parent, else leaf
    if (isTriangular(node.size) || isTriangular(node.name)) continue; // skip triangular (don't suggest unless asked)
    const key = String(node._id);
    const price = numericOrNull(leaf.price);
    // Length-only product (e.g. borde separador: you choose only a length; its
    // height/thickness are fixed specs, NOT a width). The catalog says so via
    // enabledDimensions — no "width" enabled. Such products must never match a
    // width×length request like "4x50".
    const ed = leaf.enabledDimensions;
    const lengthOnly = Array.isArray(ed) && ed.length > 0 && !ed.includes("width");
    const existing = byMeasure.get(key);
    if (!existing) {
      byMeasure.set(key, {
        label: (node.name || node.size || "").trim(),
        size: node.size || null,
        price,
        dims: dimsOf(node.size) || dimsOf(node.name),
        lengthOnly,
      });
    } else {
      if (price != null && (existing.price == null || price < existing.price)) existing.price = price;
      // If any contributing variant has a width, the measure is NOT length-only.
      existing.lengthOnly = existing.lengthOnly && lengthOnly;
    }
  }

  const list = [...byMeasure.values()];
  // Sort small → large by area (dims product); measures without dims go last.
  list.sort((a, b) => {
    const aa = a.dims ? a.dims[0] * a.dims[1] : Infinity;
    const bb = b.dims ? b.dims[0] * b.dims[1] : Infinity;
    return aa - bb;
  });
  return list;
}

function numericOrNull(p) {
  if (p == null) return null;
  const n = typeof p === "number" ? p : parseFloat(String(p).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// AI-based product-scope classifier. Replaces the old stopword + name-regex
// matcher (which misrouted on attribute words). Given the customer's message
// and the catalog of active flows, decides which flow handles the product they
// asked about — or that the message names no product at all.
//
// Returns { verdict, targetFlow, productName }:
//   - "no_product"  → message doesn't name a concrete product (greeting, color,
//                     filler, "qué hago"). Don't switch, don't deny.
//   - "current"     → product belongs to the flow they're already in.
//   - "other_flow"  → belongs to a DIFFERENT active flow (targetFlow = its name).
//   - "needs_human" → Hanlob sells it but no active flow covers it → human.
//   - "not_sold"    → genuinely not our category (toldo, lona, geomembrana…).
// On any error: "no_product" (safest — no false switch, no false denial).
async function aiClassifyProductScope(query, currentFlowName, flowCatalog, currentIsColdStart = false) {
  const { getClient, CHAT_MODEL } = require("./llmClient");
  const flowsDesc = (flowCatalog || [])
    .map(
      (f) =>
        `- "${f.name}"${f.isCurrent ? " (FLUJO ACTUAL)" : ""}${f.isColdStart ? " (TRIAGE / ARRANQUE EN FRÍO)" : ""}: ${
          f.families && f.families.length ? f.families.join(", ") : "(sin familias)"
        }`
    )
    .join("\n");

  try {
    const client = getClient();
    const res = await client.chat.completions.create({
      // Classification task — gpt-4o-mini is plenty and ~15x cheaper than the
      // engine's gpt-4o. This runs on most messages (flow-switch detection), so
      // it's a meaningful cost lever.
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Eres un clasificador de alcance de producto para Hanlob (fabricante mexicano de malla sombra).

Tu trabajo: decidir a qué FLUJO de venta pertenece el producto que pide el cliente, o si no aplica. NO interpretes colores, saludos ni preguntas tipo "qué hago" como productos.

FLUJOS ACTIVOS Y LO QUE VENDE CADA UNO:
${flowsDesc || "(ninguno)"}

${currentFlowName ? `El cliente está actualmente en el flujo: "${currentFlowName}".` : ""}
${currentIsColdStart ? `\n⚠️ EL FLUJO ACTUAL ES DE TRIAGE (ARRANQUE EN FRÍO). Su único trabajo es enrutar al cliente al flujo especialista correcto. NUNCA devuelvas "current" para este flujo: aunque sus familias abarcan toda la categoría, NO atiende productos directamente. Si un flujo especialista maneja lo que pide el cliente, devuelve SIEMPRE "other_flow" apuntando a ese especialista. Solo usa needs_human / not_sold cuando ningún especialista aplique.` : ""}

REGLAS:
- "no_product": el mensaje NO nombra un producto concreto. Saludos, agradecimientos, un color suelto (beige/negro/verde…), o preguntas como "¿qué hago?", "me interesa", "info" → no_product. Los COLORES son ATRIBUTOS, nunca productos.
- "current": el producto pertenece al FLUJO ACTUAL (misma categoría que ya está atendiendo). ${currentIsColdStart ? "NO USES ESTE VALOR — el flujo actual es de triage." : ""}
- "other_flow": pertenece claramente a OTRO flujo activo distinto del actual (un especialista). Pon su nombre EXACTO en targetFlow.
- "needs_human": es malla sombra o algo que Hanlob fabrica, pero ningún flujo activo lo cubre.
- "not_sold": algo que Hanlob NO vende (toldo, lona impermeable, geomembrana, plástico agrícola, etc.).

INTERPRETA POR MEDIDAS/PRESENTACIÓN: una medida de DOS dimensiones (ANCHO x LARGO) — "6x8", "3x3", "tres x tres", "4 por 5", "6 de ancho y 8" — es POR SÍ SOLA un producto concreto: malla sombra CONFECCIONADA → enruta (other_flow) al flujo que vende malla sombra confeccionada, AUNQUE el cliente NO escriba la palabra "malla". NUNCA marques una medida de DOS dimensiones como no_product. El borde separador y los rollos se venden por UN SOLO largo lineal; una medida de DOS lados NUNCA es borde separador. Una "malla sombra" en ROLLO o "por metro" → flujo de rollo. Nombrar "malla sombra" + una medida SÍ es nombrar un producto concreto: NUNCA lo marques como no_product.
Responde SOLO JSON: {"verdict":"no_product|current|other_flow|needs_human|not_sold","targetFlow":"<nombre exacto del flujo o null>","productName":"<el producto que pidió o null>"}`,
        },
        { role: "user", content: query },
      ],
      temperature: 0,
      max_tokens: 120,
      response_format: { type: "json_object" },
    });
    const parsed = JSON.parse(res.choices[0].message.content);
    const valid = ["no_product", "current", "other_flow", "needs_human", "not_sold"];
    return {
      verdict: valid.includes(parsed.verdict) ? parsed.verdict : "no_product",
      targetFlow: parsed.targetFlow || null,
      productName: parsed.productName || null,
    };
  } catch (err) {
    console.error("❌ aiClassifyProductScope error:", err.message);
    return { verdict: "no_product", targetFlow: null, productName: null };
  }
}

const REGISTRY = {
  share_product_link: {
    definition: {
      name: "share_product_link",
      description:
        "Share the tracked purchase link for the product the customer is interested in. Use only when you are ready to send them to buy.",
      input_schema: {
        type: "object",
        properties: {
          product: { type: "string", description: "Product or variant name to link" },
        },
        required: ["product"],
        additionalProperties: false,
      },
    },
    async execute(input, ctx) {
      ctx.actions.push({ tool: "share_product_link", input });
      const { resolvePrice, trackedLink } = require("./priceResolver");
      const requested = (input.product || "").trim();

      // Resolve ONE measure/product → a customer-facing quote line, or null if it
      // can't be found. Sets handoff only for a sellable-but-priceless product.
      const quoteOne = async (q) => {
        let doc = await findProductInFamilies(q, ctx.families);
        if (!doc) {
          // Retry with just the numeric token so "18 mt" / "18 metros" still match
          // a length product named "Rollo de 18 m".
          const nums = String(q).match(/\d+(?:\.\d+)?/g) || [];
          if (nums.length === 1) doc = await findProductInFamilies(nums[0], ctx.families);
        }
        if (!doc) return { ok: false };
        const pInfo = await resolvePrice(doc);
        if (pInfo.handoff) {
          ctx.handoffRequested = true;
          ctx.handoffReason = `Producto vendible sin precio: ${doc.name} — requiere cotización de un asesor`;
          return { ok: true, line: `"${doc.name}" no tiene precio en línea; para esa medida pasa con un asesor.` };
        }
        if (pInfo.link || pInfo.amount) {
          const link = await trackedLink(pInfo.link, {
            psid: ctx.psid,
            sandbox: ctx.sandbox,
            productName: doc.name,
            productId: String(doc._id),
          });
          const price = pInfo.amount ? ` Precio: $${pInfo.amount}${pInfo.plusIva ? " + IVA" : ""}${pInfo.source === "ml" ? "" : " (inventario)"}.` : "";
          const linkPart = link ? `Link de compra: ${link}.` : "";
          return { ok: true, line: `${doc.name} — ${linkPart}${price}`.trim() };
        }
        return { ok: false };
      };

      if (requested) {
        // MULTI-MEASURE: the customer may ask for several in one message ("6 y 18",
        // "6x4 y 8x5"). Split on word/punctuation separators — NOT on the "x"
        // inside a single measure — and quote EACH. Never escalate just because a
        // combined string didn't resolve as one product.
        const segments = requested
          .split(/\s*(?:,|;|\/|\+|\by\b|\bo\b|\band\b|\be\b)\s*/i)
          .map((s) => s.trim())
          .filter(Boolean);
        if (segments.length > 1) {
          const lines = [];
          const missing = [];
          for (const seg of segments) {
            const r = await quoteOne(seg);
            if (r.ok) lines.push(r.line);
            else missing.push(seg);
          }
          if (lines.length) {
            let out = `Comparte estas cotizaciones (una por medida, cada una con SU precio y SU link):\n` + lines.join("\n");
            if (missing.length)
              out += `\n(No encontré: ${missing.join(", ")} — pide solo esa(s) medida(s) exacta(s); NO digas que hubo un problema ni transfieras por esto.)`;
            return out;
          }
          // none resolved → fall through to single handling / clarify
        }

        const one = await quoteOne(requested);
        if (one.ok) return one.line;
        // Truly couldn't resolve. Guide the model to split / clarify — do NOT make
        // it announce a problem or transfer.
        return (
          `[INTERNO] No encontré "${requested}" como una sola medida de este flujo. ` +
          `Si el cliente pidió VARIAS medidas en un mensaje (p. ej. "6 y 18"), cotiza CADA UNA por separado ` +
          `(llama esta herramienta una vez por medida). NO digas que hubo un problema ni transfieras por esto; ` +
          `pide la medida exacta solo si de verdad no la entiendes. NO compartas el link del producto precargado ni inventes precio.`
        );
      }

      // No specific product named → use the preloaded one as a default shortcut.
      const pi = ctx.priceInfo;
      if (!pi) return "Pregunta al cliente qué medida necesita para poder cotizar.";
      if (pi.handoff) {
        ctx.handoffRequested = true;
        ctx.handoffReason = `Producto vendible sin precio: ${ctx.product?.name || "(producto del flujo)"} — requiere cotización de un asesor`;
        return `${ctx.product?.name ? `"${ctx.product.name}"` : "Ese producto"} no tiene precio disponible. NO inventes un precio: ofrece pasar con un asesor.`;
      }
      if (pi.link || pi.amount) {
        const link = await trackedLink(pi.link, {
          psid: ctx.psid,
          sandbox: ctx.sandbox,
          productName: ctx.product?.name,
          productId: ctx.product && ctx.product._id ? String(ctx.product._id) : null,
        });
        const price = pi.amount ? ` Precio: $${pi.amount}${pi.plusIva ? " + IVA" : ""}${pi.source === "ml" ? "" : " (inventario)"}.` : "";
        const linkPart = link ? `Link de compra: ${link}.` : "";
        return `${ctx.product?.name ? ctx.product.name + " — " : ""}${linkPart}${price}`.trim();
      }
      return ctx.sandbox
        ? "No hay producto resoluble en este test; asigna familia/productos en Setup."
        : "No pude resolver el link de compra. Pide la medida exacta al cliente.";
    },
  },

  share_store_link: {
    definition: {
      name: "share_store_link",
      description: "Share the company's official store link when no product-specific link applies.",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
    },
    async execute(input, ctx) {
      ctx.actions.push({ tool: "share_store_link", input });
      // Source the store link from the company's AVAILABLE MARKETPLACES (config),
      // never a hardcoded or per-ad URL. Prefer Mercado Libre, else any active one.
      let storeUrl = null;
      try {
        const { getBusinessInfo } = require("../../businessInfoManager");
        const biz = await getBusinessInfo();
        const mkts = (biz?.marketplaces || []).filter((m) => m && m.url && m.active !== false);
        const ml = mkts.find((m) => /mercado\s*libre|mercadolibre/i.test(m.name || "")) || mkts[0];
        if (ml?.url) storeUrl = ml.url;
      } catch {
        /* ignore — fall through */
      }
      if (!storeUrl) {
        return "[INTERNO] No hay tienda configurada en los marketplaces de la empresa. NO inventes un link; si el cliente quiere comprar, ofrece pasar con un asesor.";
      }
      const { trackedLink } = require("./priceResolver");
      const link = await trackedLink(storeUrl, {
        psid: ctx.psid,
        sandbox: ctx.sandbox,
        productName: "Tienda oficial",
      });
      return link || storeUrl;
    },
  },

  share_catalog: {
    definition: {
      name: "share_catalog",
      description:
        "Send the product catalog to the customer when they ask for it (lista de precios, catálogo, qué medidas/productos manejan). Sends it as a document/file in the chat — you don't need to paste a URL.",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
    },
    async execute(input, ctx) {
      ctx.actions.push({ tool: "share_catalog", input });
      const cat = ctx.catalog; // resolved from the tree: family climb → company general
      if (!cat || !cat.url) {
        return "[INTERNO] No hay catálogo disponible para este flujo. Ofrece de forma natural pasar con un asesor o pregunta qué medida busca.";
      }
      // Send the catalog PDF as a document attachment (replicates legacy
      // sendCatalog — arrives as a file bubble, not a link).
      ctx.catalogToSend = { url: cat.url, filename: "Catalogo_Hanlob.pdf" };
      return "[INTERNO] El catálogo en PDF se enviará como documento adjunto. Acompáñalo con una frase breve y natural (ej. 'Te comparto nuestro catálogo 📄'). NO pegues la URL en el texto.";
    },
  },

  request_handoff: {
    definition: {
      name: "request_handoff",
      description: "Hand the conversation to a human specialist. Use for hot leads, complaints, or anything you cannot resolve.",
      input_schema: {
        type: "object",
        properties: { reason: { type: "string", description: "Why a human is needed" } },
        required: ["reason"],
        additionalProperties: false,
      },
    },
    async execute(input, ctx) {
      ctx.actions.push({ tool: "request_handoff", input });
      ctx.handoffRequested = true;
      ctx.handoffReason = input.reason || ctx.handoffReason || "El cliente necesita atención de un asesor";
      return "Handoff registrado: un asesor continuará la conversación.";
    },
  },

  capture_lead: {
    definition: {
      name: "capture_lead",
      description: "Record the customer's contact details (name, phone, and/or email) when they share them.",
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          phone: { type: "string" },
          email: { type: "string" },
        },
        additionalProperties: false,
      },
    },
    async execute(input, ctx) {
      ctx.actions.push({ tool: "capture_lead", input });
      ctx.lead = { ...(ctx.lead || {}), ...input };
      return "Datos de contacto guardados.";
    },
  },

  ask_location: {
    definition: {
      name: "ask_location",
      description: "Record the customer's city or zip code when they provide it (for shipping).",
      input_schema: {
        type: "object",
        properties: {
          city: { type: "string" },
          zip: { type: "string" },
        },
        additionalProperties: false,
      },
    },
    async execute(input, ctx) {
      ctx.actions.push({ tool: "ask_location", input });
      ctx.location = { ...(ctx.location || {}), ...input };
      return "Ubicación registrada.";
    },
  },

  check_product_scope: {
    definition: {
      name: "check_product_scope",
      description:
        "When the customer asks about a DIFFERENT product or variant (not the one this flow handles), call this with what they asked for. It tells you whether that product is within this flow's scope, handled by another flow, sold but needs a human, or not sold at all. Use the verdict to respond correctly — do NOT guess what we sell.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The product/variant the customer asked for, in their words" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
    async execute(input, ctx) {
      ctx.actions.push({ tool: "check_product_scope", input });
      const q = (input.query || "").trim();
      if (!q) return "Sin término de búsqueda.";

      const PF = require("../../models/ProductFamily");
      const WorkflowModel = require("../../models/Workflow");

      // This flow's realm = the UNION of its families' ids (multi-family).
      const flowFamilyIds = new Set(
        (Array.isArray(ctx.families) ? ctx.families : ctx.family ? [ctx.family] : [])
          .filter((f) => f && f.id)
          .map((f) => String(f.id))
      );

      // FAST PATH (dimension-only, no name matching): if the customer named a
      // MEASURE (e.g. "6x4" or "13 de largo x 3 de ancho") that exists as a
      // sellable product in THIS flow's families, it's in-scope. Dims extracted
      // by AI from the customer's text (any phrasing); catalog sizes parsed
      // deterministically inside findProductInFamilies.
      const { extractMeasure } = require("../utils/measureExtractor");
      const scopeDims = await extractMeasure(q).catch(() => null);
      const inFamilyByDims = await findProductInFamilies(
        q,
        Array.isArray(ctx.families) ? ctx.families : ctx.family ? [ctx.family] : [],
        scopeDims
      );
      // A TRIAGE (cold-start) flow must NOT claim a product just because its
      // broad realm contains it — its job is to route to the specialist. Skip
      // the fast path for cold-start so the AI classifier below picks the flow.
      if (inFamilyByDims && !ctx.isColdStart) {
        return `[INTERNO — no menciones nada de esto al cliente] "${inFamilyByDims.name}" sí lo manejas tú aquí. Atiéndelo con normalidad.`;
      }

      // Build the catalog of active flows for the AI classifier. The previous
      // implementation regex-matched the message words against ProductFamily
      // names, which misrouted on attribute words ("color beige" → the rollo
      // "Color Beige" leaf). Now an AI classifier decides which flow (if any)
      // handles the product, with NO keyword/regex matching.
      let workflows = [];
      try {
        workflows = await WorkflowModel.find({ active: true })
          .select("name family families isColdStart")
          .lean();
      } catch {
        /* ignore */
      }

      const flowCatalog = await Promise.all(
        workflows.map(async (w) => {
          const fams = WorkflowModel.familyListOf(w) || [];
          const names = [];
          for (const f of fams) {
            // Full ancestry path so the classifier recognizes the product (a bare
            // "Rectangular" reads as nothing). Fall back to the stored name.
            const path = f.id ? await familyFullPath(PF, f.id) : "";
            names.push(path || f.name || "");
          }
          const isCurrent = fams.some((f) => flowFamilyIds.has(String(f.id)));
          return { id: String(w._id), name: w.name, families: names, isCurrent, isColdStart: !!w.isColdStart };
        })
      );

      // Is the CURRENT flow the cold-start/triage flow? If so, it must always
      // route OUT to a specialist — never claim "current" — because its broad
      // family realm overlaps every specialist flow.
      const currentIsColdStart = flowCatalog.some((f) => f.isCurrent && f.isColdStart);

      const verdict = await aiClassifyProductScope(q, ctx.currentFlowName || null, flowCatalog, currentIsColdStart);

      // no_product → the message didn't name a concrete product (greeting,
      // color, filler). Don't switch, don't deny — just continue.
      if (verdict.verdict === "no_product") {
        return "[INTERNO — no menciones nada de esto al cliente] El mensaje no nombra un producto distinto; continúa la conversación normalmente sin cambiar de tema ni de flujo.";
      }

      // current → product belongs to this flow.
      // SAFETY: a cold-start/triage flow must never keep a product as "current"
      // — its job is to route out. If the classifier still said "current" here
      // (e.g. its broad realm overlapped a specialist), treat it as needs_human
      // so the customer gets a real asesor instead of a dead-end "no puedo
      // cotizar". Better than parking them on the triage node.
      if (verdict.verdict === "current") {
        if (currentIsColdStart) {
          ctx.handoffRequested = true;
          ctx.handoffReason = `Cliente en flujo de triage pidió "${q}"; no se pudo enrutar a un especialista — requiere asesor`;
          return `[INTERNO — no menciones flujos ni procesos internos] No pudiste enrutar este producto a un flujo especialista. Ofrece de forma natural pasarlo con un asesor que le cotiza (usa request_handoff). NUNCA digas que no puedes dar precios sin ofrecer el asesor.`;
        }
        return `[INTERNO — no menciones nada de esto al cliente] Eso sí lo manejas tú aquí. Atiéndelo con normalidad como parte de esta conversación.`;
      }

      // other_flow → belongs to a different active flow → surface switch target.
      if (verdict.verdict === "other_flow" && verdict.targetFlow) {
        const other = flowCatalog.find((f) => f.name === verdict.targetFlow && !f.isCurrent);
        if (other) {
          ctx.scopeResult = {
            verdict: "other_flow",
            product: verdict.productName ? { kind: "product", name: verdict.productName } : null,
            toWorkflowId: other.id,
            toName: other.name,
          };
          return `[INTERNO — NUNCA menciones flujos, especialistas, ni que "se maneja en otro lado"; el cambio debe ser TRANSPARENTE para el cliente] Sí vendemos ${verdict.productName ? `"${verdict.productName}"` : "ese producto"}. Es otro producto de nuestro catálogo, así que confirma de forma natural que es lo que busca y, cuando lo confirme, usa la herramienta switch_flow para continuar atendiéndolo sobre ese producto SIN avisarle de ningún cambio. NO inventes datos de ese producto tú misma.`;
        }
      }

      // needs_human → sold but no active flow handles it → human.
      if (verdict.verdict === "needs_human") {
        ctx.handoffRequested = true;
        ctx.handoffReason = `Cliente pidió "${q}" — sí se vende pero no hay flujo; requiere asesor`;
        return `[INTERNO — no menciones flujos ni procesos internos] Sí lo vendemos, pero para cotizarlo necesitas a un asesor. De forma natural ofrece pasarlo con un asesor (usa request_handoff). NUNCA digas que no lo vendemos.`;
      }

      // not_sold → genuinely not our category.
      return `[INTERNO — no menciones nada de esto al cliente] No vendemos "${q}". Dile de forma amable y natural que no manejamos ese producto, sin tecnicismos.`;
    },
  },

  switch_flow: {
    definition: {
      name: "switch_flow",
      description:
        "Hand the conversation over to another flow that handles a product outside this flow's scope. Call this ONLY after check_product_scope returned an OTRO FLUJO verdict AND the customer confirmed they want that other product. The target flow takes over seamlessly (no greeting), keeping the conversation and any collected data.",
      input_schema: {
        type: "object",
        properties: {
          confirmed: { type: "boolean", description: "true only if the customer confirmed the switch" },
        },
        required: ["confirmed"],
        additionalProperties: false,
      },
    },
    async execute(input, ctx) {
      ctx.actions.push({ tool: "switch_flow", input });
      const sr = ctx.scopeResult;
      if (!sr || sr.verdict !== "other_flow" || !sr.toWorkflowId) {
        return "No hay un flujo destino identificado. Usa primero check_product_scope.";
      }
      if (input.confirmed === false) {
        return "El cliente no confirmó el cambio. Continúa en este flujo.";
      }
      // Signal the orchestrator to hand over after this turn.
      ctx.switchTo = { toWorkflowId: sr.toWorkflowId, toName: sr.toName, product: sr.product };
      return `[INTERNO] Listo, continúa atendiendo al cliente sobre "${sr.product?.name || "ese producto"}" con normalidad. NO le menciones ningún cambio interno.`;
    },
  },

  note: {
    definition: {
      name: "note",
      description: "Attach an internal note about this conversation. NOT shown to the customer.",
      input_schema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
    },
    async execute(input, ctx) {
      ctx.actions.push({ tool: "note", input });
      ctx.notes.push(input.text);
      return "Nota guardada.";
    },
  },
};

// Anthropic tool definitions for the given allowlist (unknown keys ignored).
function toolDefsFor(allowed = []) {
  return allowed.filter((k) => REGISTRY[k]).map((k) => REGISTRY[k].definition);
}

// Execute a tool the model called. Returns the tool_result content string.
async function runTool(name, input, ctx) {
  const tool = REGISTRY[name];
  if (!tool) return `Herramienta desconocida: ${name}`;
  try {
    return await tool.execute(input || {}, ctx);
  } catch (err) {
    return `Error ejecutando ${name}: ${err.message}`;
  }
}

module.exports = { REGISTRY, toolDefsFor, runTool, dimsOf, findProductInFamilies, availableVariantsForProduct, availableMeasuresForFamilies, closestAvailableMeasure };
