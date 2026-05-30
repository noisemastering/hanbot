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
      const pi = ctx.priceInfo;
      // Enforce the quoting hierarchy: sellable-but-no-price → human, never invent.
      if (pi && pi.handoff) {
        ctx.handoffRequested = true;
        return "Este producto no tiene precio disponible. NO inventes un precio: ofrece pasar con un asesor.";
      }
      const link = pi?.link || null;
      if (link) {
        const price = pi?.amount ? ` Precio: $${pi.amount}${pi.source === "ml" ? "" : " (inventario)"}.` : "";
        return `Link de compra: ${link}.${price}`;
      }
      // TODO(hands-on): when no preloaded product, resolve via free-text product identification.
      return ctx.sandbox
        ? "No hay producto precargado en este test; asigna product_specific en Setup para obtener link/precio reales."
        : "Link pendiente de resolución (sin producto precargado).";
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
      return "https://www.mercadolibre.com.mx/perfil/DISTRIBUIDORA+HANLOB";
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
      const mongoose = require("mongoose");
      const q = (input.query || "").trim();
      if (!q) return "Sin término de búsqueda.";

      const PF = mongoose.model("ProductFamily");
      // Build a loose regex from the query words (data-driven; no hardcoded products).
      const words = q
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 3);
      if (!words.length) return "Búsqueda demasiado corta.";

      let matches = [];
      try {
        const rx = words.map((w) => new RegExp(w, "i"));
        matches = await PF.find({ $or: rx.map((r) => ({ name: r })) })
          .select("name parentId active sellable")
          .limit(10)
          .lean();
      } catch {
        return "No pude buscar el producto en este momento.";
      }
      if (!matches.length) {
        return `NO VENDIDO: no encontramos "${q}" en el catálogo. Dile amablemente que no lo manejamos.`;
      }

      // Ancestry helper.
      const ancestors = async (id) => {
        const chain = [];
        let cur = await PF.findById(id).select("name parentId").lean();
        let guard = 0;
        while (cur && guard++ < 10) {
          chain.push(String(cur._id));
          if (!cur.parentId) break;
          cur = await PF.findById(cur.parentId).select("name parentId").lean();
        }
        return chain;
      };

      const flowFamilyId = ctx.family && ctx.family.id ? String(ctx.family.id) : null;

      // 1) In THIS flow's family?
      if (flowFamilyId) {
        for (const m of matches) {
          const chain = await ancestors(m._id);
          if (chain.includes(flowFamilyId)) {
            return `EN ESTE FLUJO: "${m.name}" pertenece a la familia de este flujo. Atiéndelo normalmente aquí.`;
          }
        }
      }

      // 2) In another ACTIVE workflow's family?
      let workflows = [];
      try {
        workflows = await mongoose
          .model("Workflow")
          .find({ active: true, "family.id": { $ne: null } })
          .select("name family")
          .lean();
      } catch {
        /* ignore */
      }
      for (const m of matches) {
        const chain = await ancestors(m._id);
        const other = workflows.find(
          (w) => w.family && chain.includes(String(w.family.id)) && String(w.family.id) !== flowFamilyId
        );
        if (other) {
          ctx.handoffRequested = true; // until cross-flow switching exists, route to a human
          return `OTRO FLUJO: "${m.name}" lo maneja el flujo "${other.name}". Por ahora, pasa la conversación a un asesor para continuar con ese producto (usa request_handoff).`;
        }
      }

      // 3) Sold (sellable exists) but no flow handles it → human.
      const sellable = matches.find((m) => m.sellable && m.active !== false);
      if (sellable) {
        ctx.handoffRequested = true;
        return `VENDIDO SIN FLUJO: sí manejamos "${sellable.name}", pero requiere atención de un asesor. Ofrécele pasar con un humano (usa request_handoff).`;
      }

      // 4) Found in catalog but not sellable/active.
      return `NO DISPONIBLE: "${matches[0].name}" existe en el catálogo pero no está disponible para venta directa. Ofrece pasar con un asesor si insiste.`;
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

module.exports = { REGISTRY, toolDefsFor, runTool };
