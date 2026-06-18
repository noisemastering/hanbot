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
        .select("name promoProductIds promoPrices colorNote terms timeframe")
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
      // A promo is ALWAYS a product (or range of products) at a promo price —
      // never a quantity mechanic. Describe it by its PRODUCT so the model can't
      // misread the name (e.g. read "6x4" as "buy 4 get 6").
      const count = (p.promoProductIds || []).length;
      let text = `"${p.name}"`;
      if (product) {
        text += count > 1
          ? ` — aplica a un grupo de productos (el destacado es "${product.name}"), a precio promocional`
          : ` — es el producto/medida "${product.name}" a precio promocional`;
      }
      if (p.colorNote) text += `. ${p.colorNote}`;
      if (p.terms) text += `. Condiciones: ${p.terms}`;
      if (p.timeframe) text += `. Vigencia: ${p.timeframe}`;
      return { text, name: p.name, product, priceInfo };
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

// Resolve the catalog to share. The catalog is NEVER set per-ad — it comes
// from the PRODUCT TREE, climbing up to the company-wide catalog:
//   1. Climb the flow's family tree (family node → ancestors → root) for the
//      nearest ProductFamily.catalog.url.
//   2. Still nothing → the company general catalog (businessInfo.catalog.url).
//   3. Nothing anywhere → null.
// Returns { url, kind, source } or null. (Always PDF; store links are separate
// and sourced from the company's marketplaces, not here.)
async function resolveCatalog(familyList) {
  const PF = mongoose.model("ProductFamily");
  // 1. Climb each flow family up to its root looking for a catalog.url.
  for (const fam of familyList || []) {
    if (!fam.id || !mongoose.isValidObjectId(fam.id)) continue;
    let cur = await PF.findById(fam.id).select("name parentId catalog").lean();
    let guard = 0;
    while (cur && guard++ < 12) {
      if (cur.catalog?.url) {
        return { url: cur.catalog.url, kind: "pdf", source: `family:${cur.name}` };
      }
      if (!cur.parentId) break;
      cur = await PF.findById(cur.parentId).select("name parentId catalog").lean();
    }
  }
  // 2. Company general catalog.
  try {
    const { getBusinessInfo } = require("../../businessInfoManager");
    const biz = await getBusinessInfo();
    if (biz?.catalog?.url) return { url: biz.catalog.url, kind: "pdf", source: "global" };
  } catch {
    /* ignore */
  }
  // 3. Nothing.
  return null;
}

async function resolveSetupContext(workflowSetup, overrides, families, opts = {}) {
  const setup = mergeSetup(workflowSetup, overrides);
  const lines = [];

  // Accept either a single family object (legacy) or an array of families.
  const familyList = Array.isArray(families) ? families.filter((f) => f && f.id) : families && families.id ? [families] : [];

  // Persona name — ONE name per conversation, assigned + persisted upstream and
  // passed in here. Every node uses this exact name; the model must not invent
  // or change it, and must not re-greet once it has already greeted.
  if (opts.personaName) {
    lines.push(
      `[INTERNO] Tu nombre como asesora en esta conversación es "${opts.personaName}". ` +
        `Úsalo SIEMPRE que te presentes; NUNCA uses otro nombre ni inventes uno. ` +
        `NO te vuelvas a presentar ni a saludar si ya saludaste antes en esta conversación.`
    );
  }

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

  // Available measures — discovered by walking DOWN the flow's family tree
  // (sellable descendants). You only configure the family; this finds every
  // size/length under it. Count-aware so we never dump a long list:
  //   ≤ 8 measures → list them; more → smallest/largest range.
  try {
    const { availableMeasuresForFamilies } = require("./tools");
    const measures = await availableMeasuresForFamilies(familyList);
    if (measures.length) {
      // NEVER list per-measure prices here. Listing every size's price lets the
      // model grab a NEIGHBOR'S number when quoting (e.g. answering "7x4" with
      // the 7x10 price). Measures are listed by LABEL only; the price for the
      // specific measure the customer asks about is resolved deterministically
      // by the engine (step 1.6) / the share_product_link tool, and is the ONLY
      // price allowed to reach the customer (see clampPrices).
      const fmt = (m) => m.label;
      if (measures.length <= 8) {
        lines.push(
          `- MEDIDAS DISPONIBLES (de la familia del flujo): ${measures.map(fmt).join(", ")}. ` +
            `Si el cliente pregunta qué medidas/largos manejas, ofrécele ESTAS. No inventes otras. ` +
            `NUNCA des un precio que no venga de la herramienta de cotización; si te preguntan un precio, cotiza esa medida con la herramienta.`
        );
      } else {
        const lo = measures[0];
        const hi = measures[measures.length - 1];
        lines.push(
          `- MEDIDAS DISPONIBLES (de la familia del flujo): ${measures.length} medidas, desde ${fmt(lo)} hasta ${fmt(hi)}. ` +
            `Si preguntan qué medidas manejas, da ESE RANGO (desde X hasta Y) y pide la que necesitan; NUNCA enumeres las ${measures.length}. No inventes medidas fuera del rango. ` +
            `NUNCA des un precio que no venga de la herramienta de cotización.`
        );
      }
    }
  } catch (err) {
    console.error("⚠️ available-measures resolution failed:", err.message);
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
  // Every preloaded product's RESOLVED price — fed to the deterministic price
  // clamp so it can't corrupt a legit multi-product quote (and so a neighbor's
  // price can be detected). See clampPrices / runWorkflowTurn.
  const preloadedAmounts = [];
  const noteResolved = (pi) => {
    if (pi && Number.isFinite(pi.amount) && pi.amount > 0) preloadedAmounts.push(pi.amount);
    if (pi && Number.isFinite(pi.originalPrice) && pi.originalPrice > 0) preloadedAmounts.push(pi.originalPrice);
  };
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
    noteResolved(priceInfo);
    await pushDefault(product, priceInfo);
  } else if (resolved.length > 1) {
    product = resolved[0];
    priceInfo = await resolvePrice(product); // tool back-compat: default to first
    const items = [];
    for (const p of resolved) {
      const pi = await resolvePrice(p);
      noteResolved(pi);
      // NAMES ONLY — never list inline prices for multiple products. Listing
      // each measure's price side-by-side lets the model copy one measure's
      // price onto another (the "54 m quoted at the 18 m's $689" bug). Prices
      // for a specific measure come ONLY from the share_product_link tool.
      items.push(p.name);
    }
    lines.push(
      `- Productos de interés (precargados): ${items.join(", ")}. El cliente está interesado en ESTAS medidas/variantes. ` +
        `Si pide "información" o precio, NO listes precios de memoria: cotiza CADA medida por separado con la herramienta de cotización para obtener su precio y link correctos. ` +
        `NUNCA copies el precio de una medida a otra, NUNCA pongas el mismo precio a dos medidas distintas, y NUNCA inventes precios.`
    );
  }

  // No specific measure preloaded (e.g. only a FAMILY was selected), but the ad
  // has a promo with a featured product → use THAT product as the default measure.
  if ((!product || product.sellable !== true) && promo && promo.product && promo.product.sellable) {
    product = promo.product;
    priceInfo = promo.priceInfo || (await resolvePrice(product));
    noteResolved(priceInfo);
    await pushDefault(product, priceInfo, promo.name || "promoción");
  }

  if (promo)
    lines.push(
      `- PROMOCIÓN ACTIVA: ${promo.text}. Preséntala cuando sea oportuno. ` +
        `REGLA: una promoción SIEMPRE es un producto (o rango de productos) a un precio especial; NUNCA es una promoción de cantidad ("compra X y llévate Y", "2x1", etc.). ` +
        `NUNCA inventes mecánicas de cantidad. Si el nombre de la promo incluye una medida como "6x4", se refiere a los METROS del producto (6 m x 4 m), NO a cantidades. ` +
        `El precio promocional es el del producto mostrado arriba; NUNCA lo cambies de medida ni digas que la medida anunciada "no aplica".`
    );

  // Catalog from the product tree: nearest family catalog (climb to root) →
  // company general catalog. Never set per-ad.
  const catalogResolved = await resolveCatalog(familyList);
  if (catalogResolved) {
    lines.push(`- Catálogo disponible (PDF): ${catalogResolved.url}. Compártelo (usa share_catalog) si el cliente lo pide.`);
  }

  return { setup, contextBlock: lines.join("\n"), product: product || null, priceInfo, catalog: catalogResolved || null, preloadedAmounts };
}

module.exports = { resolveSetupContext, mergeSetup };
