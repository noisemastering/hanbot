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

// Color preference from promo/product text (the base color is beige).
function colorFromText(...texts) {
  const t = texts.filter(Boolean).join(" ").toLowerCase();
  if (/\bnegro\b/.test(t)) return "negro";
  if (/\bverde\b/.test(t)) return "verde";
  if (/\bblanco\b/.test(t)) return "blanco";
  return "beige";
}

// If `doc` is a non-sellable SIZE-GROUP (e.g. "6m x 4m", whose price AND ML link
// actually live on its color leaves), descend to the best sellable leaf: prefer
// one that matches the color (default beige) AND has a real ML link, then any
// with a link, then any matching color, then the first sellable. Returns `doc`
// unchanged when it's already sellable or has no sellable descendants. This is
// why a promo/ad pointing at the size-group still quotes the right price+link.
async function resolveSellableLeaf(doc, colorHint = "beige") {
  if (!doc || doc.sellable === true) return doc;
  try {
    const PF = mongoose.model("ProductFamily");
    const queue = [String(doc._id)];
    const sellables = [];
    let guard = 0;
    while (queue.length && guard++ < 200) {
      const kids = await PF.find({ parentId: queue.shift() })
        .select("name size price mlPrice onlineStoreLinks sellable active parentId")
        .lean();
      for (const k of kids) {
        if (k.sellable && k.active !== false) sellables.push(k);
        queue.push(String(k._id));
      }
    }
    if (!sellables.length) return doc;
    const hasLink = (p) => (p.onlineStoreLinks || []).some((l) => /mercadolibre/i.test(l?.url || l || ""));
    const isColor = (p) => new RegExp(colorHint, "i").test(p.name || "");
    return (
      sellables.find((p) => isColor(p) && hasLink(p)) ||
      sellables.find((p) => hasLink(p)) ||
      sellables.find((p) => isColor(p)) ||
      sellables[0]
    );
  } catch {
    return doc;
  }
}

async function loadProductDoc(productSpecific) {
  if (!productSpecific?.kind || !productSpecific?.id) return null;
  if (!mongoose.isValidObjectId(productSpecific.id)) return null;
  // A FAMILY preload is the flow's REALM (a range of products), NOT a single
  // default measure. Don't descend it to one sellable leaf — doing so made an
  // ad like "Promo Futbol" (preloads the whole Rectangular family) collapse to a
  // sticky "6x4" default that overrode whatever size the customer actually asked
  // for. The realm comes from the workflow's families; the customer's measure is
  // resolved per-turn.
  if (productSpecific.kind === "family") return null;
  try {
    // The product picker selects from the ProductFamily tree (sellable leaves
    // included), so resolve against ProductFamily for BOTH kinds. Fall back to
    // the legacy Product model only if the id is not a ProductFamily.
    const fam = await mongoose
      .model("ProductFamily")
      .findById(productSpecific.id)
      .select("name price mlPrice onlineStoreLinks sellable active parentId")
      .lean();
    // A preloaded "product" can be a size-group node; descend to the sellable
    // leaf so price + ML link resolve (else the bot has no link to share).
    if (fam) return await resolveSellableLeaf(fam);
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
        .select("name promoProductIds promoPrices colorNote terms timeframe salesPitch")
        .lean();
      if (!p) return { text: "hay una promoción activa", product: null, priceInfo: null, pitch: null, products: [] };

      // Per-product PRICE: an override (promoPrices) is the offer; otherwise the
      // cardinal rule (live ML → synced ML → inventario). Resolve EVERY promo
      // product (descending size-groups to the real sellable leaf) so a
      // multi-product promo can be quoted a line per product.
      const overrideFor = (id) => {
        const m = (p.promoPrices || []).find((x) => String(x.productId) === String(id));
        return m ? m.price : undefined;
      };
      const products = []; // [{ doc, name, id, priceInfo }]
      for (const rawId of p.promoProductIds || []) {
        const doc = await mongoose
          .model("ProductFamily")
          .findById(rawId)
          .select("name price mlPrice onlineStoreLinks sellable active")
          .lean();
        if (!doc) continue;
        const leaf = await resolveSellableLeaf(doc, colorFromText(p.colorNote, p.name));
        const ov = overrideFor(rawId) ?? overrideFor(leaf._id);
        const priceInfo =
          ov != null
            ? { amount: ov, source: "promo", handoff: false, link: mlLinkOf(leaf) }
            : await resolvePrice(leaf);
        products.push({ doc: leaf, name: leaf.name, id: String(leaf._id), priceInfo });
      }
      const featured = products[0] || null;
      const product = featured ? featured.doc : null;
      const priceInfo = featured ? featured.priceInfo : null;

      // A promo is ALWAYS a product (or range of products) at a promo price —
      // never a quantity mechanic. Describe it by its PRODUCT so the model can't
      // misread the name (e.g. read "6x4" as "buy 4 get 6").
      let text = `"${p.name}"`;
      if (product) {
        text += products.length > 1
          ? ` — aplica a varios productos (el destacado es "${product.name}"), a precio promocional`
          : ` — es el producto/medida "${product.name}" a precio promocional`;
      }
      if (p.colorNote) text += `. ${p.colorNote}`;
      if (p.terms) text += `. Condiciones: ${p.terms}`;
      const tf = p.timeframe || {};
      if (tf.startDate || tf.endDate) {
        const f = (d) => (d ? new Date(d).toLocaleDateString("es-MX", { day: "numeric", month: "long" }) : "");
        text += `. Vigencia: ${tf.startDate ? `del ${f(tf.startDate)}` : ""}${tf.endDate ? ` hasta el ${f(tf.endDate)}` : ""}`.trim();
      }
      return { text, name: p.name, product, priceInfo, pitch: p.salesPitch || null, products };
    } catch {
      /* ignore */
    }
  }
  return { text: "hay una promoción activa", product: null, priceInfo: null, pitch: null, products: [] };
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
        `Preséntate UNA sola vez al inicio; NO te vuelvas a presentar ni a saludar si ya saludaste antes. ` +
        `NUNCA respondas ÚNICAMENTE con un saludo o presentación ("¡Hola! Soy X, ¿en qué te ayudo?") cuando el cliente ya hizo una pregunta o pidió un precio/medida: SIEMPRE atiende lo que pidió en ese mismo mensaje.`
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
      if (biz.phones && biz.phones.length) {
        // Present phones PROFESSIONALLY and LABELED, never as a bare slash list.
        // 10-digit MX numbers are spaced 3-3-4 ("442 227 8247"). First phone is the
        // store line, second is WhatsApp (per the business).
        const fmtPhone = (p) => {
          const d = String(p || "").replace(/\D/g, "").slice(-10);
          return d.length === 10 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : String(p || "").trim();
        };
        const labels = ["Teléfono de tienda", "WhatsApp"];
        const phoneLines = biz.phones
          .slice(0, 2)
          .map((p, i) => `      ${labels[i] || "Teléfono"}: ${fmtPhone(p)}`)
          .join("\n");
        ci.push(
          `  - Teléfonos (compártelos SIEMPRE con esta etiqueta y formato EXACTO, uno por línea, nunca en una lista con "/"):\n${phoneLines}`
        );
      }
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
  //
  // SKIP for cold-start: it spans many incompatible categories (malla in meters,
  // cinta/borde in inches/lengths, ground cover, etc.), so a single "desde X
  // hasta Y" range is meaningless ("2x2 → rollos de 2 pulgadas"). Cold-start's
  // job is to identify the product and route — not to list measures. A specific
  // measure the customer names is still resolved per-turn by the engine (1.6).
  if (opts.isColdStart) {
    lines.push(
      `- NO listes medidas ni des un rango: este flujo cubre varias categorías distintas. ` +
        `Identifica qué PRODUCTO y medida busca el cliente y enruta al flujo correcto; si pide un precio de una medida concreta, cotízala con la herramienta.`
    );
  }
  // ROLLO realm: the flow now carries MANY roll sizes (widths 2–5 m × lengths
  // 10–100 m × several shade %). Listing them — or a "desde X hasta Y" range
  // across mixed widths/lengths — is overkill and meaningless. Instead we ask the
  // customer for the LENGTH they need (or the AREA to cover, → width×length) and
  // quote that specific roll. Shade % and width come PRESET from the ad. Detected
  // here (suppress the list), directive emitted after the product is resolved.
  // Roll-like realm: Raschel rollo OR ground cover (malla antimaleza) — both are
  // sold in W×L rolls and get the "ask length/area, don't list" treatment.
  const isRollRealm = realms.length > 0 && realms.every((r) => /\brollo\b|ground\s*cover|antimaleza/i.test(r));
  // Only Raschel rollo has shade %; ground cover does not. The path carries the
  // shade ("… > 90% > Rollo"), so detect it to keep shade out of GC's directive.
  const realmHasShade = realms.some((r) => /\d{1,3}\s*%/.test(r));
  let rollLengths = [],
    rollWidths = [];
  try {
    const { availableMeasuresForFamilies } = require("./tools");
    const measures = opts.isColdStart ? [] : await availableMeasuresForFamilies(familyList);
    if (isRollRealm && measures.length) {
      rollLengths = [...new Set(measures.map((m) => m.dims && m.dims[1]).filter((n) => n != null))].sort((a, b) => a - b);
      rollWidths = [...new Set(measures.map((m) => m.dims && m.dims[0]).filter((n) => n != null))].sort((a, b) => a - b);
    }
    if (measures.length && !isRollRealm) {
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

  // NEVER OVER-DENY. The bot was caught flatly denying things we DO offer (custom
  // sizes, negro color). Affirm availability and offer the closest option and/or an
  // asesor instead of a hard "no" — never invent a price.
  lines.push(
    `- NUNCA NIEGUES DE MÁS: si el cliente pide una medida, color o variante que no está lista directamente en catálogo, NO lo niegues tajantemente. ` +
      `Ofrécele la opción estándar más cercana y/o pasar con un asesor para conseguir justo lo que pide (sin inventar precio). ` +
      `NUNCA des un "no" rotundo ("no lo manejamos", "no la podemos ofrecer") sin ofrecer una alternativa real.`
  );
  const isSinRefuerzo = realms.some((r) => /sin\s*refuerzo/i.test(r));
  if (isSinRefuerzo) {
    lines.push(
      `- QUÉ VENDES: malla sombra confeccionada SIN refuerzo (también llamada "con argollas"). Es la MISMA malla que la reforzada pero sin el refuerzo en las esquinas; es la opción MÁS ECONÓMICA (mismas demás características: % de sombra, argollas, lista para instalar). Nunca la menosprecies.`
    );
    lines.push(
      `- COLOR: SOLO manejas BEIGE en sin refuerzo. NO ofrezcas negro ni verde aquí.`
    );
    lines.push(
      `- CATÁLOGO MÁS CORTO: si el cliente pide una medida que NO está en tu lista, el sistema te dará el precio y link de esa medida en la opción REFORZADA. Menciónalo con naturalidad ("en esa medida la tengo en opción reforzada por $X") y ofrécele ESE link. NO cambies de flujo.`
    );
  } else if (realms.some((r) => /malla\s*sombra|raschel|confeccionada/i.test(r))) {
    lines.push(
      `- COLOR POR DEFECTO = BEIGE: cotiza y ofrece SIEMPRE en BEIGE de manera predeterminada. NO ofrezcas ni menciones proactivamente negro ni verde. ` +
        `SOLO ofrece otro color (negro/verde) si el CLIENTE lo pide explícitamente. ` +
        `- MALLA SOMBRA — HAY MÁS DE LO QUE LISTAS: Hanlob fabrica malla sombra SOBRE MEDIDA (cualquier medida) y, SI EL CLIENTE PREGUNTA, también en NEGRO y VERDE. ` +
        `Afírmalo cuando pregunten. NUNCA digas "solo tenemos beige" ni "no manejamos esa medida": si no tienes un link directo para ese color o medida exacta, ofrécele pasar con un asesor para ESA opción (nunca niegues que existe).`
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

  // Push the DEFAULT/featured measure. It's a default for unspecified requests —
  // NOT a lock. The bot must still adapt to any other size the customer names
  // and answer product questions; otherwise a promo ad glues every conversation
  // to one measure (the regression where "5x6" got answered with "6x4").
  // The pinned/promo default is a VOLATILE startup guide: it's the default ONLY
  // until the client asks for a different measure, at which point it must VANISH
  // from context. We TAG every default/promo line with §D§ so the engine can strip
  // them the moment the client pivots (the tag itself is removed before display).
  const D = (s) => `§D§${s}`;
  const pushDefault = async (prod, pi, promoLabel) => {
    const prodPath = await resolveFamilyRealm({ id: prod._id, name: prod.name });
    lines.push(D(
      `- ${promoLabel ? `PROMOCIÓN destacada: "${promoLabel}" → ` : "Medida destacada (por defecto): "}` +
        `${prodPath || prod.name}${priceTxt(pi)}. Es la opción por DEFECTO. ` +
        `El cliente YA viene de un anuncio de ESTA medida, así que es el punto de partida: si muestra interés en comprar o pide precio/info SIN especificar otra medida ` +
        `(p. ej. "quiero una", "me interesa", "cuánto cuesta", "la quiero", "comprar", "sí"), NO le preguntes qué medida necesita — asume ESTA medida y cotízala directamente con su precio y link. ` +
        `PERO un SALUDO a secas o charla SIN señal de compra ni medida ("buenas tardes", "hola", "buenos días", "qué tal", "buenas") NO es interés de compra: contesta como humano con un saludo cálido y breve e invítalo a decirte qué busca (puedes mencionar en UNA línea, sin precio, que hay una promoción) — NO sueltes el precio ni el link todavía; eso es SOLO cuando pida precio/info o muestre interés. ` +
        `PERO ADÁPTATE: si el cliente menciona CUALQUIER otra medida (p. ej. 5x6, 3x2, 8x10), cotiza ESA medida — NUNCA le impongas la medida destacada ni cambies la que pidió. ` +
        `Responde con normalidad sus preguntas y detalles del producto (% de sombra, refuerzo, colores, envío, etc.); no escales por dudas que puedes responder.`
    ));
    if (pi && pi.source === "ml") {
      const { trackedLink } = require("./priceResolver");
      const plink = await trackedLink(pi.link, {
        psid: opts.psid || null,
        sandbox: !!opts.sandbox,
        productName: prod.name,
        productId: prod._id ? String(prod._id) : null,
      });
      lines.push(D(
        `- PRECIO: $${pi.amount} (fuente: Mercado Libre${pi.hasDiscount ? `, con descuento desde $${pi.originalPrice}` : ""}). Cotiza este precio. Link: ${plink || "(usa la herramienta)"}.`
      ));
    } else if (pi && pi.source === "inventario") {
      lines.push(D(`- PRECIO: $${pi.amount} (fuente: Inventario). Cotiza este precio.`));
    } else if (pi && pi.source === "promo") {
      lines.push(D(`- PRECIO: $${pi.amount} (precio de promoción). Cotiza este precio.`));
    } else if (pi && pi.handoff) {
      lines.push(D(
        `- PRECIO: NO disponible. El producto es vendible pero no tiene precio. NUNCA inventes un precio: ofrece pasar con un asesor (usa request_handoff).`
      ));
    }
    if (pi && (Number.isFinite(pi.amount) || pi.source)) {
      const measureTxt = prod.size || prod.name;
      lines.push(D(
        `- IMPORTANTE: ese precio es EXCLUSIVO de la medida ${measureTxt}. Para CUALQUIER otra medida que pida el cliente, cotiza el precio PROPIO de esa medida; NUNCA apliques este precio (ni el de promoción) a otra medida.`
      ));
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
    lines.push(D(
      `- Productos de interés (precargados): ${items.join(", ")}. El cliente está interesado en ESTAS medidas/variantes. ` +
        `Si pide "información" o precio, NO listes precios de memoria: cotiza CADA medida por separado con la herramienta de cotización para obtener su precio y link correctos. ` +
        `NUNCA copies el precio de una medida a otra, NUNCA pongas el mismo precio a dos medidas distintas, y NUNCA inventes precios.`
    ));
  }

  // No specific measure preloaded (e.g. only a FAMILY was selected), but the ad
  // has a promo with a featured product → use THAT product as the default measure.
  if ((!product || product.sellable !== true) && promo && promo.product && promo.product.sellable) {
    product = promo.product;
    priceInfo = promo.priceInfo || (await resolvePrice(product));
    noteResolved(priceInfo);
    await pushDefault(product, priceInfo, promo.name || "promoción");
  }

  // ROLLO directive (paired with the suppressed list above). Ask for LENGTH or
  // AREA; shade %/width come PRESET from the ad (derived from the resolved
  // product when present). Emitted here, after `product` is known.
  if (isRollRealm) {
    let presetW = null,
      presetShade = null;
    if (product) {
      const ws = String(product.size || "").match(/(\d+(?:\.\d+)?)\s*x/i); // width = first dim of "WxL"
      if (ws) presetW = ws[1];
      try {
        const PF = mongoose.model("ProductFamily");
        let c = product.parentId ? await PF.findById(product.parentId).select("name parentId").lean() : null;
        for (let i = 0; i < 8 && c; i++) {
          const sm = String(c.name || "").match(/(\d{2,3})\s*%/);
          if (sm) { presetShade = sm[1]; break; }
          c = c.parentId ? await PF.findById(c.parentId).select("name parentId").lean() : null;
        }
      } catch { /* shade just won't be preset */ }
    }
    const lenTxt = rollLengths.length ? `${rollLengths.join(", ")} m` : "varios largos";
    const widthTxt = rollWidths.length ? `${rollWidths.join(", ")} m` : "varios anchos";
    const exW = presetW || rollWidths[rollWidths.length - 1] || 4;
    const exL = rollLengths[rollLengths.length - 1] || 100;
    const shadePrefix = realmHasShade ? "el % de sombra y " : "";
    const exShadePrefix = realmHasShade ? `${presetShade || 90}% ` : "";
    const presetLine =
      presetShade || presetW
        ? `${realmHasShade ? "El % de sombra y el ancho" : "El ancho"} YA vienen definidos por el anuncio${presetShade ? ` (${presetShade}% de sombra)` : ""}${presetW ? ` (ancho ${presetW} m)` : ""}; NO los vuelvas a preguntar.`
        : `${realmHasShade ? "El % de sombra y el ancho" : "El ancho"} NO están predefinidos: pregúntalos solo si el cliente no los menciona (anchos: ${widthTxt}${realmHasShade ? "; sombra 35–90%" : ""}).`;
    lines.push(
      `- MEDIDAS DE ROLLO — NO LAS LISTES NI DES UN RANGO: hay muchísimas combinaciones (ancho × largo${realmHasShade ? " × % de sombra" : ""}). ` +
        `En lugar de listarlas, PREGUNTA al cliente qué LARGO de rollo necesita (largos disponibles: ${lenTxt}) o qué ÁREA quiere cubrir. ` +
        `Si te da un ÁREA, calcula el largo ≈ área ÷ ancho y propón el largo disponible MÁS CERCANO (confírmalo con el cliente). ` +
        presetLine +
        ` Cuando ya tengas ${shadePrefix}el ancho + el largo, cotiza ESE rollo con la herramienta indicando la medida COMPLETA, ej. "${exShadePrefix}${exW}x${exL}". NUNCA inventes un precio ni listes todas las medidas.`
    );
  }

  if (promo)
    lines.push(D(
      `- PROMOCIÓN ACTIVA: ${promo.text}. Preséntala cuando sea oportuno. ` +
        `REGLA: una promoción SIEMPRE es un producto (o rango de productos) a un precio especial; NUNCA es una promoción de cantidad ("compra X y llévate Y", "2x1", etc.). ` +
        `NUNCA inventes mecánicas de cantidad. Si el nombre de la promo incluye una medida como "6x4", se refiere a los METROS del producto (6 m x 4 m), NO a cantidades. ` +
        `El precio promocional es el del producto mostrado arriba; NUNCA lo cambies de medida ni digas que la medida anunciada "no aplica".`
    ));

  // MULTI-PRODUCT promo → one line per product, each with its own engine-resolved
  // price (override → offer, else cardinal/ML) + its own tracked link. Each price
  // is bound to its product here, so the model never copies one onto another.
  if (promo && Array.isArray(promo.products) && promo.products.length > 1) {
    const rows = [];
    for (const it of promo.products) {
      const pi = it.priceInfo;
      if (!pi) continue;
      noteResolved(pi);
      let line = `    • ${it.name}`;
      if (pi.handoff || pi.amount == null) {
        line += `: sin precio en línea — cotízalo con un asesor`;
      } else {
        let plink = pi.link;
        if (pi.link) {
          const { trackedLink } = require("./priceResolver");
          plink = await trackedLink(pi.link, { psid: opts.psid || null, sandbox: !!opts.sandbox, productName: it.name, productId: it.id });
        }
        line += `: $${pi.amount}${plink ? ` → ${plink}` : ""}`;
      }
      rows.push(line);
    }
    if (rows.length)
      lines.push(D(
        `- PRECIOS DE LA PROMOCIÓN (uno por producto — cotiza el que pida el cliente con SU precio y SU link; NUNCA mezcles precios entre medidas):\n` +
          rows.join("\n")
      ));
  }

  // Catalog from the product tree: nearest family catalog (climb to root) →
  // company general catalog. Never set per-ad.
  const catalogResolved = await resolveCatalog(familyList);
  if (catalogResolved) {
    lines.push(`- Catálogo disponible (PDF): ${catalogResolved.url}. Compártelo (usa share_catalog) si el cliente lo pide.`);
  }

  // Deterministic promo QUOTE — used when the customer asks for the promo and
  // there is NO verbatim pitch. The featured promo product + its price + a
  // tracked link, so the engine can answer the promo-buy click directly instead
  // of leaving it to the router (which can detour to handoff).
  let promoQuote = null;
  if (
    promo &&
    promo.product &&
    promo.priceInfo &&
    Number.isFinite(promo.priceInfo.amount) &&
    promo.priceInfo.amount > 0 &&
    !promo.priceInfo.handoff
  ) {
    const size = (promo.product.size || "").trim().replace(/m$/i, " m").trim();
    const color = colorFromText(promo.product.name, promo.name);
    const label = size ? `la malla sombra de ${size} en color ${color}` : `la ${promo.product.name}`;
    let plink = promo.priceInfo.link || null;
    if (plink) {
      const { trackedLink } = require("./priceResolver");
      plink = await trackedLink(plink, {
        psid: opts.psid || null,
        sandbox: !!opts.sandbox,
        productName: promo.product.name,
        productId: promo.product._id ? String(promo.product._id) : null,
      });
    }
    promoQuote = { label, amount: promo.priceInfo.amount, link: plink };
  }

  return {
    setup,
    contextBlock: lines.join("\n"),
    product: product || null,
    priceInfo,
    catalog: catalogResolved || null,
    preloadedAmounts,
    promoPitch: (promo && promo.pitch) || null, // verbatim sales pitch (sent once, on ask)
    promoQuote, // deterministic quote (product + price + link) when no pitch is set
  };
}

module.exports = { resolveSetupContext, mergeSetup };
