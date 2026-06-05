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

// Normalize a measure/product query to comparable dimension tokens.
// "4x3", "4 x 3 m", "4 por 3", "de 4x3 metros" → ["4","3"] (sorted for order-insensitivity).
function dimsOf(text) {
  if (!text) return null;
  // Strip metric units, including 'm' glued to a digit ("6m" → "6").
  const m = String(text)
    .toLowerCase()
    .replace(/(\d)\s*(?:m\b|mts?\b|metros?\b)/g, "$1 ")
    .replace(/\bmts?\.?\b|\bmetros?\b|\bm\b/g, " ")
    .match(/(\d+(?:\.\d+)?)\s*(?:[x×*]|por)\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  // Sort numerically so "6x4" and "4x6" compare equal regardless of order.
  return [m[1], m[2]].map(Number).sort((a, b) => a - b);
}

// Find a sellable product in the flow's family subtrees that matches the
// customer's requested measure/name. Returns the ProductFamily doc or null.
async function findProductInFamilies(query, familyList) {
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
      .select("name sellable active price mlPrice onlineStoreLinks parentId")
      .lean();
    for (const k of kids) {
      if (k.sellable && k.active !== false) candidates.push(k);
      queue.push(k._id);
    }
    // also consider the family node itself if it's sellable
  }

  const wantDims = dimsOf(query);
  if (wantDims) {
    const hit = candidates.find((c) => {
      const cd = dimsOf(c.name);
      return cd && cd[0] === wantDims[0] && cd[1] === wantDims[1];
    });
    if (hit) return hit;
  }
  // Fallback: loose name contains (e.g. a named variant, not a measure).
  const q = query.toLowerCase();
  return candidates.find((c) => (c.name || "").toLowerCase().includes(q)) || null;
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
async function aiClassifyProductScope(query, currentFlowName, flowCatalog) {
  const { getClient, CHAT_MODEL } = require("./llmClient");
  const flowsDesc = (flowCatalog || [])
    .map(
      (f) =>
        `- "${f.name}"${f.isCurrent ? " (FLUJO ACTUAL)" : ""}: ${
          f.families && f.families.length ? f.families.join(", ") : "(sin familias)"
        }`
    )
    .join("\n");

  try {
    const client = getClient();
    const res = await client.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        {
          role: "system",
          content: `Eres un clasificador de alcance de producto para Hanlob (fabricante mexicano de malla sombra).

Tu trabajo: decidir a qué FLUJO de venta pertenece el producto que pide el cliente, o si no aplica. NO interpretes colores, saludos ni preguntas tipo "qué hago" como productos.

FLUJOS ACTIVOS Y LO QUE VENDE CADA UNO:
${flowsDesc || "(ninguno)"}

${currentFlowName ? `El cliente está actualmente en el flujo: "${currentFlowName}".` : ""}

REGLAS:
- "no_product": el mensaje NO nombra un producto concreto. Saludos, agradecimientos, un color suelto (beige/negro/verde…), o preguntas como "¿qué hago?", "me interesa", "info" → no_product. Los COLORES son ATRIBUTOS, nunca productos.
- "current": el producto pertenece al FLUJO ACTUAL (misma categoría que ya está atendiendo).
- "other_flow": pertenece claramente a OTRO flujo activo distinto del actual. Pon su nombre EXACTO en targetFlow.
- "needs_human": es malla sombra o algo que Hanlob fabrica, pero ningún flujo activo lo cubre.
- "not_sold": algo que Hanlob NO vende (toldo, lona impermeable, geomembrana, plástico agrícola, etc.).

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
      const { resolvePrice } = require("./priceResolver");
      const requested = (input.product || "").trim();
      const pi = ctx.priceInfo; // preloaded product (a default/shortcut, NOT a lock)

      // Decide which product to quote:
      //  - If the customer named a specific measure/product, resolve THAT within
      //    the flow's families (any measure is available, not just the preloaded one).
      //  - Else fall back to the preloaded product as a convenient default.
      let priceInfo = null;
      let resolvedName = null;
      let resolvedId = null;

      if (requested) {
        const doc = await findProductInFamilies(requested, ctx.families);
        if (doc) {
          priceInfo = await resolvePrice(doc);
          resolvedName = doc.name;
          resolvedId = String(doc._id);
        } else {
          // Customer named a SPECIFIC product/measure we couldn't find in this
          // flow's families. NEVER fall back to the preloaded product (that would
          // quote the wrong thing). Tell the model to clarify, not invent.
          return `[INTERNO] No encontré "${requested}" entre las medidas/variantes de este flujo. ` +
            `Si el cliente dio una medida, confírmala o pídela exacta (ancho x largo); NO compartas el link del producto precargado ni inventes precio.`;
        }
      } else if (pi) {
        // No specific product named → use the preloaded one as a default shortcut.
        priceInfo = pi;
        resolvedId = ctx.product && ctx.product._id ? String(ctx.product._id) : null;
      }

      if (!priceInfo) {
        return "Pregunta al cliente qué medida necesita para poder cotizar.";
      }

      // Quoting hierarchy: sellable-but-no-price → human, never invent.
      if (priceInfo.handoff) {
        ctx.handoffRequested = true;
        ctx.handoffReason = `Producto vendible sin precio: ${resolvedName || "(producto del flujo)"} — requiere cotización de un asesor`;
        return `${resolvedName ? `"${resolvedName}"` : "Ese producto"} no tiene precio disponible. NO inventes un precio: ofrece pasar con un asesor.`;
      }
      if (priceInfo.link || priceInfo.amount) {
        // psid-traceable redirect so the click is attributed in commerce-status.
        const { trackedLink } = require("./priceResolver");
        const link = await trackedLink(priceInfo.link, {
          psid: ctx.psid,
          sandbox: ctx.sandbox,
          productName: resolvedName || ctx.product?.name,
          productId: resolvedId,
        });
        const price = priceInfo.amount
          ? ` Precio: $${priceInfo.amount}${priceInfo.source === "ml" ? "" : " (inventario)"}.`
          : "";
        const linkPart = link ? `Link de compra: ${link}.` : "";
        return `${resolvedName ? resolvedName + " — " : ""}${linkPart}${price}`.trim();
      }
      return ctx.sandbox
        ? "No hay producto resoluble en este test; asigna familia/productos en Setup."
        : "No pude resolver el link de compra. Pide la medida exacta al cliente.";
    },
  },

  share_store_link: {
    definition: {
      name: "share_store_link",
      description: "Share the generic store link (Distribuidora Hanlob) when no product-specific link applies.",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
    },
    async execute(input, ctx) {
      ctx.actions.push({ tool: "share_store_link", input });
      const STORE_URL = "https://www.mercadolibre.com.mx/perfil/DISTRIBUIDORA+HANLOB";
      const { trackedLink } = require("./priceResolver");
      const link = await trackedLink(STORE_URL, {
        psid: ctx.psid,
        sandbox: ctx.sandbox,
        productName: "Tienda Distribuidora Hanlob",
      });
      return link || STORE_URL;
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
      // MEASURE (e.g. "6x4") that exists as a sellable product in THIS flow's
      // families, it's in-scope. Pure numeric dimension comparison.
      const inFamilyByDims = await findProductInFamilies(
        q,
        Array.isArray(ctx.families) ? ctx.families : ctx.family ? [ctx.family] : []
      );
      if (inFamilyByDims) {
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
          .select("name family families")
          .lean();
      } catch {
        /* ignore */
      }

      const flowCatalog = await Promise.all(
        workflows.map(async (w) => {
          const fams = WorkflowModel.familyListOf(w) || [];
          const names = [];
          for (const f of fams) {
            if (f.name) names.push(f.name);
            else if (f.id) {
              const doc = await PF.findById(f.id).select("name").lean();
              if (doc?.name) names.push(doc.name);
            }
          }
          const isCurrent = fams.some((f) => flowFamilyIds.has(String(f.id)));
          return { id: String(w._id), name: w.name, families: names, isCurrent };
        })
      );

      const verdict = await aiClassifyProductScope(q, ctx.currentFlowName || null, flowCatalog);

      // no_product → the message didn't name a concrete product (greeting,
      // color, filler). Don't switch, don't deny — just continue.
      if (verdict.verdict === "no_product") {
        return "[INTERNO — no menciones nada de esto al cliente] El mensaje no nombra un producto distinto; continúa la conversación normalmente sin cambiar de tema ni de flujo.";
      }

      // current → product belongs to this flow.
      if (verdict.verdict === "current") {
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

module.exports = { REGISTRY, toolDefsFor, runTool, dimsOf, findProductInFamilies };
