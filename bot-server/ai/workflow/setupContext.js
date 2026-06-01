// ai/workflow/setupContext.js
//
// Resolves a workflow's setup vars (merged with per-conversation overrides from
// an ad assignment or the sandbox) into a human-readable CONTEXT block that the
// router and node prompts read each turn. Also resolves the price for the
// preloaded product via the quoting hierarchy (ML → Inventario → handoff).
const mongoose = require("mongoose");
const { resolvePrice } = require("./priceResolver");
const { getBusinessInfo } = require("../../businessInfoManager");

const pick = (a, b) => (a !== undefined && a !== null && a !== "" ? a : b);

// Merge workflow.setup defaults with per-conversation overrides (override wins).
function mergeSetup(base = {}, override = {}) {
  const o = override || {};
  return {
    buyer: pick(o.buyer, base.buyer),
    purchaseType: pick(o.purchaseType, base.purchaseType),
    saleChannel: pick(o.saleChannel, base.saleChannel),
    productSpecific: {
      kind: pick(o.productSpecific?.kind, base.productSpecific?.kind),
      id: pick(o.productSpecific?.id, base.productSpecific?.id),
    },
    products:
      Array.isArray(o.products) && o.products.length
        ? o.products
        : Array.isArray(base.products)
        ? base.products
        : [],
    hasPromo: pick(o.hasPromo, base.hasPromo),
    tone: pick(o.tone, base.tone),
    catalog: {
      kind: pick(o.catalog?.kind, base.catalog?.kind),
      value: pick(o.catalog?.value, base.catalog?.value),
    },
  };
}

const LABELS = {
  buyer: { end_user: "comprador final", reseller: "revendedor" },
  purchaseType: { retail: "menudeo (retail)", wholesale: "mayoreo (wholesale)" },
  saleChannel: {
    marketplace: "marketplace (Mercado Libre, link de compra + compra protegida)",
    manual: "venta manual (datos + transferencia/depósito, cierra un asesor)",
  },
  tone: {
    casual: "casual y cercano (como un amigo que sabe del tema)",
    professional: "profesional y claro (asesor formal pero amable)",
    technical: "técnico y detallado (especificaciones, datos, precisión)",
  },
};

async function loadProductDoc(productSpecific) {
  if (!productSpecific?.kind || !productSpecific?.id) return null;
  if (!mongoose.isValidObjectId(productSpecific.id)) return null;
  try {
    // The product picker selects from the ProductFamily tree (sellable leaves
    // included), so resolve against ProductFamily for BOTH kinds. Fall back to
    // the legacy Product model only if the id is not a ProductFamily.
    const fam = await mongoose
      .model("ProductFamily")
      .findById(productSpecific.id)
      .select("name price mlPrice onlineStoreLinks sellable active")
      .lean();
    if (fam) return fam;
    return await mongoose.model("Product").findById(productSpecific.id).select("name price").lean();
  } catch {
    return null;
  }
}

async function resolvePromo(hasPromo) {
  if (!hasPromo) return null;
  if (typeof hasPromo === "string" && mongoose.isValidObjectId(hasPromo)) {
    try {
      const p = await mongoose.model("Promo").findById(hasPromo).select("name").lean();
      if (p) return `promoción activa: "${p.name}"`;
    } catch {
      /* ignore */
    }
  }
  return "hay una promoción activa";
}

/**
 * @returns {Promise<{ setup: object, contextBlock: string, product: object|null, priceInfo: object|null }>}
 */
// Resolve a family's full ancestry path (root > ... > leaf) for the realm line.
async function resolveFamilyRealm(family) {
  if (!family || !family.id) return null;
  if (!mongoose.isValidObjectId(family.id)) return family.name || null;
  try {
    const PF = mongoose.model("ProductFamily");
    const names = [];
    let cur = await PF.findById(family.id).select("name parentId").lean();
    let guard = 0;
    while (cur && guard++ < 10) {
      names.unshift(cur.name);
      if (!cur.parentId) break;
      cur = await PF.findById(cur.parentId).select("name parentId").lean();
    }
    return names.length ? names.join(" > ") : (family.name || null);
  } catch {
    return family.name || null;
  }
}

async function resolveSetupContext(workflowSetup, overrides, family) {
  const setup = mergeSetup(workflowSetup, overrides);
  const lines = [];

  // Flow switch: this conversation was handed over from another flow. Don't
  // greet again — continue seamlessly with the product the client asked for.
  if (overrides && overrides.comesFromFlowSwitch) {
    lines.push(
      "CONTINUACIÓN DE FLUJO: el cliente ya venía conversando y fue transferido a este flujo por el producto que pidió. " +
        "NO saludes de nuevo ni te presentes; continúa la conversación directamente sobre ese producto."
    );
  }

  // Company info — always available so any node can answer "¿dónde están?",
  // "¿horario?", "¿teléfono?" accurately. Single source of truth: CompanyInfo DB.
  try {
    const biz = await getBusinessInfo();
    if (biz) {
      const ci = [];
      if (biz.name) ci.push(`  - Nombre: ${biz.name}`);
      if (biz.fullAddress) ci.push(`  - Dirección: ${biz.fullAddress}`);
      if (biz.hours) ci.push(`  - Horario: ${biz.hours}`);
      if (biz.phones && biz.phones.length) ci.push(`  - Teléfonos: ${biz.phones.join(" / ")}`);
      if (biz.website) ci.push(`  - Sitio web: ${biz.website}`);
      if (biz.googleMapsUrl) ci.push(`  - Google Maps: ${biz.googleMapsUrl}`);
      if (ci.length) {
        lines.push("DATOS DE LA EMPRESA (compártelos si el cliente los pide):");
        lines.push(ci.join("\n"));
      }
    }
  } catch (e) {
    /* non-fatal: company info just won't be in context */
  }

  const realm = await resolveFamilyRealm(family);
  if (realm) {
    lines.push(
      `- Familia / realm de este flujo: ${realm}. SOLO ofrece productos y variantes DENTRO de esta familia. ` +
        `NUNCA ofrezcas presentaciones o variantes que estén fuera de ella (por ejemplo, si la familia es "con refuerzo", no ofrezcas "sin refuerzo"; si es una forma específica como "Rectangular", no ofrezcas otras formas). Da por hecho la variante de la familia.`
    );
  }

  if (setup.buyer) lines.push(`- Tipo de cliente: ${LABELS.buyer[setup.buyer] || setup.buyer}`);
  if (setup.purchaseType) lines.push(`- Tipo de compra: ${LABELS.purchaseType[setup.purchaseType] || setup.purchaseType}`);
  if (setup.saleChannel) lines.push(`- Canal de venta: ${LABELS.saleChannel[setup.saleChannel] || setup.saleChannel}`);
  if (setup.tone) lines.push(`- Tono de la conversación: ${LABELS.tone[setup.tone] || setup.tone}. Mantén este tono en todas tus respuestas.`);

  // Resolve preloaded product(s). New multi shape setup.products[]; falls back
  // to the legacy single setup.productSpecific.
  const specs =
    Array.isArray(setup.products) && setup.products.length
      ? setup.products
      : setup.productSpecific && setup.productSpecific.id
      ? [setup.productSpecific]
      : [];
  const resolved = [];
  for (const spec of specs) {
    const doc = await loadProductDoc(spec);
    if (doc) resolved.push(doc);
  }

  let priceInfo = null;
  let product = null;
  const priceTxt = (pi) =>
    pi && (pi.source === "ml" || pi.source === "inventario") ? ` ($${pi.amount})` : "";

  if (resolved.length === 1) {
    product = resolved[0];
    const prodPath = await resolveFamilyRealm({ id: product._id, name: product.name });
    priceInfo = await resolvePrice(product);
    lines.push(
      `- Producto de interés (precargado): ${prodPath || product.name}${priceTxt(priceInfo)}. El cliente YA está hablando de ESTE producto. ` +
        `Si pide "información", precio, medidas, colores, fotos, etc., asume que se refiere a este producto; NUNCA preguntes "¿de qué producto?" ni "¿qué información?".`
    );
    if (priceInfo.source === "ml") {
      lines.push(
        `- PRECIO: $${priceInfo.amount} (fuente: Mercado Libre${priceInfo.hasDiscount ? `, con descuento desde $${priceInfo.originalPrice}` : ""}). Cotiza este precio. Link: ${priceInfo.link || "(usa la herramienta)"}.`
      );
    } else if (priceInfo.source === "inventario") {
      lines.push(`- PRECIO: $${priceInfo.amount} (fuente: Inventario). Cotiza este precio.`);
    } else if (priceInfo.handoff) {
      lines.push(
        `- PRECIO: NO disponible. El producto es vendible pero no tiene precio. NUNCA inventes un precio: ofrece pasar con un asesor (usa request_handoff).`
      );
    }
  } else if (resolved.length > 1) {
    product = resolved[0];
    priceInfo = await resolvePrice(product); // tool back-compat: default to first
    const items = [];
    for (const p of resolved) {
      const pi = await resolvePrice(p);
      items.push(`${p.name}${priceTxt(pi)}`);
    }
    lines.push(
      `- Productos de interés (precargados): ${items.join(", ")}. El cliente está interesado en ESTAS medidas/variantes. ` +
        `Si pide "información" o precio, habla de estas opciones concretas; NUNCA preguntes "¿de qué producto?" ni "¿qué medida?". ` +
        `Cotiza solo los precios mostrados arriba; si una opción no tiene precio, no lo inventes.`
    );
  }

  const promo = await resolvePromo(setup.hasPromo);
  if (promo) lines.push(`- Promoción: ${promo}. Preséntala cuando sea oportuno.`);

  if (setup.catalog?.value) {
    const what = setup.catalog.kind === "pdf" ? "catálogo en PDF" : "enlace a la tienda";
    lines.push(`- Catálogo disponible (${what}): ${setup.catalog.value}. Compártelo si lo piden o si aplica.`);
  }

  return { setup, contextBlock: lines.join("\n"), product: product || null, priceInfo };
}

module.exports = { resolveSetupContext, mergeSetup };
