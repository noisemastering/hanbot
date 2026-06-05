// ai/workflow/setupContext.js
//
// Resolves a workflow's setup vars (merged with per-conversation overrides from
// an ad assignment or the sandbox) into a human-readable CONTEXT block that the
// router and node prompts read each turn. Also resolves the price for the
// preloaded product via the quoting hierarchy (ML → Inventario → handoff).
const mongoose = require("mongoose");
const { resolvePrice, mlLinkOf } = require("./priceResolver");
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

// Resolve the promo: its name AND its featured product (so a promo-driven ad can
// use that product as the DEFAULT measure). Returns { text, name, product, priceInfo }.
async function resolvePromo(hasPromo) {
  if (!hasPromo) return null;
  if (typeof hasPromo === "string" && mongoose.isValidObjectId(hasPromo)) {
    try {
      const p = await mongoose
        .model("Promo")
        .findById(hasPromo)
        .select("name promoProductIds promoPrices")
        .lean();
      if (!p) return { text: "hay una promoción activa", product: null, priceInfo: null };

      let product = null;
      let priceInfo = null;
      const pid = (p.promoProductIds || [])[0]; // featured product
      if (pid) {
        const doc = await mongoose
          .model("ProductFamily")
          .findById(pid)
          .select("name price mlPrice onlineStoreLinks sellable active")
          .lean();
        if (doc) {
          product = doc;
          const override = (p.promoPrices || []).find(
            (x) => String(x.productId) === String(pid)
          )?.price;
          priceInfo = override
            ? { amount: override, source: "promo", handoff: false, link: mlLinkOf(doc) }
            : await resolvePrice(doc);
        }
      }
      return { text: `promoción activa: "${p.name}"`, name: p.name, product, priceInfo };
    } catch {
      /* ignore */
    }
  }
  return { text: "hay una promoción activa", product: null, priceInfo: null };
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

async function resolveSetupContext(workflowSetup, overrides, families, opts = {}) {
  const setup = mergeSetup(workflowSetup, overrides);
  const lines = [];

  // Accept either a single family object (legacy) or an array of families.
  const familyList = Array.isArray(families) ? families.filter((f) => f && f.id) : families && families.id ? [families] : [];

  // Flow switch: this conversation was handed over from another flow. Don't
  // greet again — continue seamlessly with the product the client asked for.
  if (overrides && overrides.comesFromFlowSwitch) {
    lines.push(
      "[INTERNO] El cliente ya venía conversando y ahora pregunta por este producto. " +
        "NO saludes de nuevo, NO te presentes, y NUNCA le digas que cambió de flujo, de área o de asesor. " +
        "Para el cliente es la MISMA conversación fluida; simplemente continúa atendiéndolo sobre este producto."
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

  const realms = [];
  for (const f of familyList) {
    const r = await resolveFamilyRealm(f);
    if (r) realms.push(r);
  }
  if (realms.length === 1) {
    lines.push(
      `- Familia / realm de este flujo: ${realms[0]}. SOLO ofrece productos y variantes DENTRO de esta familia. ` +
        `NUNCA ofrezcas presentaciones o variantes que estén fuera de ella (por ejemplo, si la familia es "con refuerzo", no ofrezcas "sin refuerzo"; si es una forma específica como "Rectangular", no ofrezcas otras formas). Da por hecho la variante de la familia.`
    );
  } else if (realms.length > 1) {
    lines.push(
      `- Familias / realm de este flujo (este flujo cubre VARIAS):\n` +
        realms.map((r) => `    • ${r}`).join("\n") +
        `\n  SOLO ofrece productos dentro de ESTAS familias. NUNCA ofrezcas nada fuera de ellas. Si el cliente no especifica, ayúdale a elegir entre estas opciones.`
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
    pi && (pi.source === "ml" || pi.source === "inventario" || pi.source === "promo")
      ? ` ($${pi.amount})`
      : "";

  // Resolve the promo up front — a promo-driven ad uses the promo's featured
  // product as the DEFAULT measure when no specific measure is preloaded.
  const promo = await resolvePromo(setup.hasPromo);

  // Push the "this is the default measure — assume it, don't ask which" lines.
  const pushDefault = async (prod, pi, promoLabel) => {
    const prodPath = await resolveFamilyRealm({ id: prod._id, name: prod.name });
    lines.push(
      `- ${promoLabel ? `PRODUCTO EN PROMOCIÓN (medida por defecto): "${promoLabel}" → ` : "Producto de interés (precargado): "}` +
        `${prodPath || prod.name}${priceTxt(pi)}. El cliente YA está hablando de ESTA medida. ` +
        `Si pide información, precio, colores, fotos, etc., asume que se refiere a ESTA medida; NUNCA preguntes "¿de qué producto?" ni "¿qué medida?". ` +
        `Solo si el cliente pide explícitamente OTRA medida, cotiza esa.`
    );
    if (pi && pi.source === "ml") {
      const { trackedLink } = require("./priceResolver");
      const plink = await trackedLink(pi.link, {
        psid: opts.psid || null,
        sandbox: !!opts.sandbox,
        productName: prod.name,
        productId: prod._id ? String(prod._id) : null,
      });
      lines.push(
        `- PRECIO: $${pi.amount} (fuente: Mercado Libre${pi.hasDiscount ? `, con descuento desde $${pi.originalPrice}` : ""}). Cotiza este precio. Link: ${plink || "(usa la herramienta)"}.`
      );
    } else if (pi && pi.source === "inventario") {
      lines.push(`- PRECIO: $${pi.amount} (fuente: Inventario). Cotiza este precio.`);
    } else if (pi && pi.source === "promo") {
      lines.push(`- PRECIO: $${pi.amount} (precio de promoción). Cotiza este precio.`);
    } else if (pi && pi.handoff) {
      lines.push(
        `- PRECIO: NO disponible. El producto es vendible pero no tiene precio. NUNCA inventes un precio: ofrece pasar con un asesor (usa request_handoff).`
      );
    }
  };

  if (resolved.length === 1 && resolved[0].sellable === true) {
    // A single SPECIFIC measure was preloaded → it's the default.
    product = resolved[0];
    priceInfo = await resolvePrice(product);
    await pushDefault(product, priceInfo);
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

  // No specific measure preloaded (e.g. only a FAMILY was selected), but the ad
  // has a promo with a featured product → use THAT product as the default measure.
  if ((!product || product.sellable !== true) && promo && promo.product && promo.product.sellable) {
    product = promo.product;
    priceInfo = promo.priceInfo || (await resolvePrice(product));
    await pushDefault(product, priceInfo, promo.name || "promoción");
  }

  if (promo) lines.push(`- Promoción: ${promo.text}. Preséntala cuando sea oportuno.`);

  if (setup.catalog?.value) {
    const what = setup.catalog.kind === "pdf" ? "catálogo en PDF" : "enlace a la tienda";
    lines.push(`- Catálogo disponible (${what}): ${setup.catalog.value}. Compártelo si lo piden o si aplica.`);
  }

  return { setup, contextBlock: lines.join("\n"), product: product || null, priceInfo };
}

module.exports = { resolveSetupContext, mergeSetup };
