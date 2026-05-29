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
      // TODO(hands-on): resolve a real tracked ML link via the existing helpers.
      const link = ctx.sandbox
        ? `https://example.test/link/${encodeURIComponent(input.product || "producto")}`
        : null;
      return link
        ? `Link listo: ${link}`
        : "Link pendiente de resolución (no resuelto en este entorno).";
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
