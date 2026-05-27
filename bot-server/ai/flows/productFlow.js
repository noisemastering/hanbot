// ai/flows/productFlow.js
// Model flow — retrieves and manages product information.
// Does NOT handle sales process (that's retail/wholesale/reseller flows).
// Handles: product lookup, variants, pricing, colors, links, wholesale thresholds,
//          out-of-realm detection, "we don't offer" list.
// Called by convo_flows, never drives a conversation alone.

const { OpenAI } = require("openai");
const ProductFamily = require("../../models/ProductFamily");
const Product = require("../../models/Product");
const { parseConfeccionadaDimensions } = require("../utils/dimensionParsers");

const _openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

/**
 * Load products for a given set of family IDs from the DB.
 * Only returns active families with sellable leaf nodes.
 * @param {Array<string>} familyIds - ProductFamily ObjectIds from manifest
 * @returns {Promise<Array>} Loaded product data
 */
/**
 * Load every salable product across the entire catalog (no family restriction).
 * Used by the not_offered fallback so the bot can quote anything we actually
 * sell, even if the customer entered through a restricted promo flow.
 */
async function loadAllSalableProducts() {
  try {
    const all = await ProductFamily.find({ active: true, sellable: true }).lean();
    const products = await Product.find({
      familyId: { $in: all.map(f => f._id) }
    }).lean();
    const allMap = new Map(all.map(f => [String(f._id), f]));

    return all.map(fam => {
      const linkedProducts = products.filter(p => String(p.familyId) === String(fam._id));
      const preferredLink = fam.onlineStoreLinks?.find(l => l.isPreferred)?.url
        || fam.onlineStoreLinks?.[0]?.url
        || null;
      const familyPath = [];
      let current = fam;
      while (current?.parentId) {
        const parent = allMap.get(String(current.parentId));
        if (parent) {
          familyPath.unshift(parent.name);
          current = parent;
        } else break;
      }
      return {
        productId: String(fam._id),
        name: fam.name,
        familyName: familyPath.length > 0 ? familyPath.join(' > ') : null,
        description: fam.description || null,
        price: fam.price || null,
        mlPrice: fam.mlPrice || null,
        link: preferredLink,
        size: fam.size || null,
        colors: linkedProducts.map(p => p.name).filter(Boolean),
        variants: linkedProducts.map(p => ({
          id: String(p._id), name: p.name, price: p.price, size: p.size, link: p.mLink || null
        })),
        attributes: fam.attributes || {}
      };
    });
  } catch (err) {
    console.error('❌ [product] loadAllSalableProducts error:', err.message);
    return [];
  }
}

async function loadProducts(familyIds) {
  if (!familyIds || familyIds.length === 0) return [];

  try {
    // Get the specified families first
    const roots = await ProductFamily.find({
      _id: { $in: familyIds },
      active: true
    }).lean();

    // Recursively find all descendants (breadth-first)
    const seen = new Set(roots.map(f => String(f._id)));
    let queue = [...roots];
    const allFamilies = [...roots];

    while (queue.length > 0) {
      const parentIds = queue.map(f => f._id);
      const children = await ProductFamily.find({
        parentId: { $in: parentIds },
        active: true
      }).lean();

      queue = [];
      for (const child of children) {
        const id = String(child._id);
        if (!seen.has(id)) {
          seen.add(id);
          allFamilies.push(child);
          queue.push(child);
        }
      }
    }

    const sellable = allFamilies.filter(f => f.sellable);

    // Also load Product documents linked to these families
    const products = await Product.find({
      familyId: { $in: allFamilies.map(f => f._id) }
    }).lean();

    // Build a map of family IDs to their names for parent context
    const familyMap = new Map(allFamilies.map(f => [String(f._id), f]));

    // Build normalized product list
    return sellable.map(fam => {
      const linkedProducts = products.filter(p => String(p.familyId) === String(fam._id));
      const preferredLink = fam.onlineStoreLinks?.find(l => l.isPreferred)?.url
        || fam.onlineStoreLinks?.[0]?.url
        || null;

      // Walk up the tree to build family context (e.g. "Borde Separador > Rollo de 9 m")
      const familyPath = [];
      let current = fam;
      while (current?.parentId) {
        const parent = familyMap.get(String(current.parentId));
        if (parent) {
          familyPath.unshift(parent.name);
          current = parent;
        } else break;
      }
      const familyContext = familyPath.length > 0 ? familyPath.join(' > ') : null;

      return {
        productId: String(fam._id),
        name: fam.name,
        familyName: familyContext,  // e.g. "Borde Separador"
        description: fam.description || fam.marketingDescription || null,
        price: fam.price || null,
        mlPrice: fam.mlPrice || null,
        link: preferredLink,
        size: fam.size || null,
        colors: linkedProducts.map(p => p.name).filter(Boolean),
        variants: linkedProducts.map(p => ({
          id: String(p._id),
          name: p.name,
          price: p.price,
          size: p.size,
          link: p.mLink || null
        })),
        wholesaleEnabled: fam.wholesaleEnabled || false,
        wholesaleMinQty: fam.wholesaleMinQty || null,
        wholesalePrice: fam.wholesalePrice || null,
        requiresHumanAdvisor: fam.requiresHumanAdvisor || false,
        attributes: fam.attributes || {},
        imageUrl: fam.imageUrl || fam.thumbnail || null
      };
    });
  } catch (err) {
    console.error('❌ [product] DB load error:', err.message);
    return [];
  }
}

/**
 * Find a product by name/description using AI matching.
 * @param {string} userMessage - What the customer asked for
 * @param {Array} products - Loaded products from loadProducts()
 * @param {Object} conversationContext - { basket, lastBotResponse, customerName, lastQuotedProducts }
 * @returns {Promise<Array>} Matching products
 */
async function findProduct(userMessage, products, conversationContext = {}) {
  if (!userMessage || !products.length) return [];

  const { basket = [], lastBotResponse = null, customerName = null, lastQuotedProducts = [], conversationHistory = '' } = conversationContext;

  // Normalize multiplication sign and Unicode variants → ASCII 'x' so size patterns match
  const normalizedMessage = userMessage
    .replace(/[×✕✖x✗]/g, 'x')
    .replace(/\s+/g, ' ')
    .trim();

  // ── SIZE PATTERN FAST-PATH ──
  // If the user mentioned a dimension like "6x4" / "6 x 4" / "6 por 4",
  // try to deterministically match against the product list before asking the AI.
  // This prevents the AI from flagging legit size queries as outsideRealm.
  const sizeMatch = normalizedMessage.match(/\b(\d{1,2})(?:\s*[x×]\s*|\s+por\s+)(\d{1,2})\b/i);
  if (sizeMatch) {
    const w = parseInt(sizeMatch[1], 10);
    const h = parseInt(sizeMatch[2], 10);
    // Try both orientations (6x4 or 4x6)
    const directMatch = products.filter(p => {
      if (!p.size) return false;
      const sm = String(p.size).match(/(\d{1,2})x(\d{1,2})/i);
      if (!sm) return false;
      const pw = parseInt(sm[1], 10), ph = parseInt(sm[2], 10);
      return (pw === w && ph === h) || (pw === h && ph === w);
    });
    if (directMatch.length > 0) {
      console.log(`🏛️ [product] Direct size match: ${w}x${h} → ${directMatch.length} product(s)`);
      return { matches: directMatch, outsideRealm: false, confidence: 'high' };
    }
  }

  const productSummary = products.map((p, i) => {
    let entry = `${i}: `;
    if (p.familyName) entry += `[${p.familyName}] `;
    entry += p.name;
    if (p.size) entry += ` (${p.size})`;
    if (p.price) entry += ` $${p.price}`;
    if (p.description) entry += ` — ${p.description}`;
    return entry;
  }).join('\n');

  // Build conversation context block
  const contextParts = [];
  if (customerName) contextParts.push(`Cliente: ${customerName}`);
  if (lastQuotedProducts.length > 0) {
    contextParts.push(`Productos recién cotizados: ${lastQuotedProducts.map(p => p.description || p.name).join(', ')}`);
  } else if (basket.length > 0) {
    contextParts.push(`Productos en el carrito: ${basket.map(b => b.description).join(', ')}`);
  }
  if (lastBotResponse) {
    contextParts.push(`Último mensaje del bot: "${lastBotResponse.slice(0, 200)}"`);
  }
  const contextBlock = contextParts.length > 0
    ? `\nCONTEXTO DE LA CONVERSACIÓN:\n${contextParts.join('\n')}\n`
    : '';

  try {
    const systemContent = `Eres un sistema de búsqueda de productos para Hanlob, fabricante mexicano de MALLA SOMBRA. Identifica cuál(es) producto(s) de la lista corresponden a lo que el cliente busca.

REGLA CRÍTICA: La categoría de Hanlob es "malla sombra" (también llamada raschel, malla raschel, raschel 90%, malla 90%, malla, sombra, tela sombra). TODOS nuestros productos son malla sombra o accesorios para malla sombra. NUNCA marques "malla sombra" / "raschel" / "malla" / "sombra" como outsideRealm — son nuestra categoría principal.

Los productos tienen un nombre de familia entre corchetes [Familia]. Si el cliente pide la familia por nombre (ej: "borde separador"), TODOS los productos de esa familia coinciden. Si pide una medida específica, solo el producto que coincida.

Responde con JSON:
{ "matches": [<índices de productos que coinciden>], "confidence": "high"|"medium"|"low", "outsideRealm": <true si el cliente pide algo que NO está en la lista ni en sus familias> }

FORMATO:
- Familia por nombre → devuelve TODOS los productos de esa familia
- Pregunta de seguimiento ("¿cuánto cuesta?", "me interesa", "ese", "solo X", "nada más X") → usa el CONTEXTO para identificar el producto referido. "Solo malla sombra" / "Nomás la malla" = confirmación de alcance, NO una solicitud nueva
- Producto fuera de la lista — SOLO productos genuinamente diferentes (ej: "quiero un toldo", "tienen lonas?", "venden plástico?", "tienen geomembrana?") → outsideRealm: true, matches: []
- Preguntas generales de precio, interés o información sobre los productos de la lista (ej: "pongan los precios", "cuánto cuestan", "me interesan", "precios?") → outsideRealm: false, matches: [], confidence: "low" (NO son outsideRealm — el cliente pregunta por nuestros productos pero sin especificar cuál)
- "malla sombra", "malla", "sombra", "raschel", "tela sombra" → JAMÁS outsideRealm. Si no hay producto específico que matchee, devuelve matches: [], outsideRealm: false, confidence: "low"
- Ante la duda → confidence: "low", outsideRealm: false
- Solo devuelve JSON`;

    const userContent = `${contextBlock}
PRODUCTOS DISPONIBLES:
${productSummary}
${conversationHistory ? `\n${conversationHistory}` : ''}
Mensaje del cliente: ${normalizedMessage}`;

    const response = await _openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: userContent }
      ],
      temperature: 0.1,
      max_tokens: 200,
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(response.choices[0].message.content);

    if (result.outsideRealm) {
      // Safety guard 1: never flag our own product category as outsideRealm.
      const lower = normalizedMessage.toLowerCase();
      const isOurCategory = /\b(malla\s*sombra|malla|sombra|raschel|tela\s*sombra)\b/.test(lower);
      if (isOurCategory) {
        console.log(`🏛️ [product] Overriding outsideRealm — message mentions our category: "${userMessage}"`);
        return { matches: [], outsideRealm: false, confidence: 'low' };
      }
      // Safety guard 2: if the message contains a size pattern, it's a size
      // query — never outside our realm (we sell malla sombra in many sizes).
      // The fast-path above already tried direct match; if we got here, the
      // size isn't in the current flow's list, but the master-catalog fallback
      // in convoFlow will handle it.
      if (/\b\d{1,2}\s*[x×]\s*\d{1,2}\b/i.test(normalizedMessage)) {
        console.log(`🏛️ [product] Overriding outsideRealm — message contains size pattern: "${userMessage}"`);
        return { matches: [], outsideRealm: false, confidence: 'low' };
      }
      return { matches: [], outsideRealm: true };
    }

    const matched = (result.matches || [])
      .filter(i => i >= 0 && i < products.length)
      .map(i => products[i]);

    return { matches: matched, outsideRealm: false, confidence: result.confidence };
  } catch (err) {
    console.error('❌ [product] AI match error:', err.message);
    return { matches: [], outsideRealm: false };
  }
}

/**
 * Check if a product exceeds the wholesale threshold.
 * @param {Object} product - Product from loadProducts()
 * @param {number} quantity - Requested quantity
 * @returns {{ isWholesale: boolean, threshold: number|null }}
 */
function checkWholesaleThreshold(product, quantity) {
  if (!product.wholesaleEnabled || !product.wholesaleMinQty) {
    return { isWholesale: false, threshold: null };
  }
  return {
    isWholesale: quantity >= product.wholesaleMinQty,
    threshold: product.wholesaleMinQty
  };
}

/**
 * Check other convo_flow manifests to find the right flow for an out-of-realm product.
 * @param {string} userMessage - What the customer asked for
 * @param {Array<Object>} manifests - Other convo_flow manifests from DB
 * @returns {Promise<{ flowId: string, flowName: string }|null>}
 */
async function findFlowForProduct(userMessage, manifests) {
  if (!manifests || manifests.length === 0) return null;

  // Enrich each manifest with actual product names/sizes so the AI can match
  // by what the products ARE, not by opaque ObjectIds.
  const ProductFamily = require('../../models/ProductFamily');
  const enriched = await Promise.all(manifests.map(async (m, i) => {
    let productLabels = [];
    if (m.products && m.products.length > 0) {
      try {
        const fams = await ProductFamily.find({ _id: { $in: m.products } })
          .select('name size')
          .lean();
        productLabels = fams.map(f => f.size ? `${f.name} (${f.size})` : f.name).filter(Boolean);
      } catch {}
    }
    return {
      idx: i,
      name: m.name,
      label: m.label || m.name,
      productLabels
    };
  }));

  const manifestSummary = enriched.map(e =>
    `${e.idx}: ${e.label} — productos: ${e.productLabels.join(', ') || '(sin productos cargados)'}`
  ).join('\n');

  try {
    const response = await _openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Identifica cuál flujo maneja el producto que pide el cliente.

FLUJOS DISPONIBLES:
${manifestSummary}

Responde con JSON:
{ "matchIndex": <índice del flujo que maneja ese producto, o -1 si ninguno lo maneja> }

REGLAS:
- Si el cliente pide una medida específica (ej: "6x4", "4x3 metros"), busca el flujo que tiene esa medida en sus productos
- Si el cliente pide una categoría (ej: "malla sombra", "raschel"), busca un flujo que maneje esa categoría
- NO emparejes por palabra clave parcial (ej. "malla pájaros" NO es lo mismo que "malla sombra")
- ANTE LA DUDA con un producto que es claramente malla sombra/raschel → elige el flujo más general (con más productos), no uno promocional
- Solo devuelve JSON`
        },
        { role: "user", content: userMessage }
      ],
      temperature: 0.1,
      max_tokens: 100,
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(response.choices[0].message.content);
    if (result.matchIndex >= 0 && result.matchIndex < manifests.length) {
      const matched = manifests[result.matchIndex];
      return { flowName: matched.name };
    }
    return null;
  } catch (err) {
    console.error('❌ [product] AI flow match error:', err.message);
    return null;
  }
}

/**
 * Handle a product inquiry.
 * @param {string} userMessage - Customer message
 * @param {Object} convo - Conversation object
 * @param {string} psid - Platform sender ID
 * @param {Object} context
 *   familyIds: array of ProductFamily ObjectIds from manifest
 *   products: pre-loaded products (if already initialized, avoids re-querying)
 *   manifests: other convo_flow manifests for flow switching
 *   basket: current product basket from convo_flow state
 *   lastQuotedProducts: products from the last quote
 * @returns {{ type: string, products?: Array, action?: string }|null}
 */
async function handle(userMessage, convo, psid, context = {}) {
  const { familyIds = [], products: preloaded = null, manifests = [], basket = [], lastQuotedProducts = [], conversationHistory = '' } = context;

  // ── LOAD PRODUCTS (once, then cache in convo_flow) ──
  const products = preloaded || await loadProducts(familyIds);

  // ── DIMENSION PRE-PROCESSING ──
  // If any product has a WxHm size format, try to parse dimensions from the message
  // and look up the product directly — skipping the AI product search.
  const hasSizedProducts = products.some(p => p.size && /^\d+x\d+m$/i.test(p.size));
  if (hasSizedProducts) {
    const dims = await parseConfeccionadaDimensions(userMessage);
    if (dims) {
      const w = Math.min(dims.width, dims.height);
      const h = Math.max(dims.width, dims.height);

      // Both sides > 8 → oversize handoff (confeccionada only)
      // Confeccionada products have both dimensions ≤ 10m. Rollos have one side = 100m.
      const isConfeccionada = products.every(p => {
        if (!p.size) return false;
        const m = p.size.match(/^(\d+)x(\d+)m$/i);
        return m && parseInt(m[1]) <= 10 && parseInt(m[2]) <= 10;
      });
      if (isConfeccionada && w > 8 && h > 8) {
        return {
          type: 'dimension_handoff',
          reason: 'oversize',
          width: w, height: h,
          message: `Esa medida (${w}x${h}m) requiere cotización especial ya que es más grande que nuestro catálogo estándar. Te comunico con un especialista para cotizarte.`
        };
      }

      // Fractional dimensions → round to nearest integer
      const hasFractions = (w % 1 !== 0) || (h % 1 !== 0);
      if (hasFractions) {
        const rw = Math.ceil(w);
        const rh = Math.ceil(h);
        const fractionalKey = `${w}x${h}`;
        const isInsisting = convo?.lastFractionalSize === fractionalKey;

        if (isInsisting) {
          return {
            type: 'dimension_handoff',
            reason: 'fractional_insist',
            width: w, height: h,
            message: `La medida exacta de ${w}x${h}m requiere fabricación especial. Te comunico con un especialista para cotizarte.`
          };
        }

        // Find the rounded size in our products
        const sizeKey = `${Math.min(rw, rh)}x${Math.max(rw, rh)}m`;
        const altKey = `${Math.max(rw, rh)}x${Math.min(rw, rh)}m`;
        const match = products.find(p => p.size === sizeKey || p.size === altKey);

        if (match) {
          const explanation = dims.convertedFromFeet
            ? `Tu medida de ${dims.originalFeetStr} equivale a aproximadamente ${w}x${h} metros.\n\nLa medida más cercana que manejamos es ${rw}x${rh}m:`
            : `La medida más cercana que manejamos es ${rw}x${rh}m:`;
          return {
            type: 'dimension_match',
            exact: false,
            fractionalKey,
            explanation,
            products: [match],
            convertedFromFeet: dims.convertedFromFeet || false
          };
        }

        // No rounded match found — check other flows' product families
        if (manifests && manifests.length > 0) {
          const rsizeKey = `${Math.min(rw, rh)}x${Math.max(rw, rh)}m`;
          const raltKey = `${Math.max(rw, rh)}x${Math.min(rw, rh)}m`;
          for (const m of manifests) {
            if (!m.products?.length) continue;
            const otherProducts = await loadProducts(m.products);
            const found = otherProducts.find(p => p.size === rsizeKey || p.size === raltKey);
            if (found) {
              console.log(`🏛️ [product] Rounded size ${rw}x${rh}m found in ${m.name} (${found.name})`);
              return { type: 'flow_switch', action: 'product_redirect', targetFlowName: m.name };
            }
          }
        }

        return {
          type: 'dimension_handoff',
          reason: 'size_not_found',
          width: w, height: h,
          message: `La medida ${w}x${h}m no la tenemos en catálogo estándar. Te comunico con un especialista para cotizarte.`
        };
      }

      // ── INTEGER DIMENSION LOOKUP ──
      const sizeKey = `${w}x${h}m`;
      const altKey = `${h}x${w}m`;
      const match = products.find(p => p.size === sizeKey || p.size === altKey);

      if (match) {
        const sizeText = dims.convertedFromFeet
          ? `Tu medida de ${dims.originalFeetStr} equivale a ${w}x${h} metros.\n\n`
          : null;
        return {
          type: 'dimension_match',
          exact: true,
          sizeText,
          products: [match],
          convertedFromFeet: dims.convertedFromFeet || false
        };
      }

      // Exact size not in THIS flow's catalog — check other flows' product families
      if (manifests && manifests.length > 0) {
        const sizeKey = `${w}x${h}m`;
        const altKey = `${h}x${w}m`;
        for (const m of manifests) {
          if (!m.products?.length) continue;
          const otherProducts = await loadProducts(m.products);
          const found = otherProducts.find(p => p.size === sizeKey || p.size === altKey);
          if (found) {
            console.log(`🏛️ [product] Size ${w}x${h}m found in ${m.name} (${found.name})`);
            return { type: 'flow_switch', action: 'product_redirect', targetFlowName: m.name };
          }
        }
      }

      return {
        type: 'dimension_handoff',
        reason: 'size_not_found',
        width: w, height: h,
        message: `La medida de ${w}x${h}m no la tenemos en catálogo estándar. Te comunico con un especialista para cotizarte.`
      };
    }
  }

  // ── FIND MATCHING PRODUCT (with conversation context) ──
  const conversationContext = {
    basket,
    lastBotResponse: convo?.lastBotResponse || null,
    customerName: convo?.userName || null,
    lastQuotedProducts,
    conversationHistory
  };
  const search = await findProduct(userMessage, products, conversationContext);

  // ── OUT OF REALM — check other manifests ──
  if (search.outsideRealm) {
    console.log('🏛️ [product] Product outside realm — checking other flows');
    const otherFlow = await findFlowForProduct(userMessage, manifests);
    if (otherFlow) {
      return { type: 'flow_switch', action: 'product_redirect', targetFlowName: otherFlow.flowName };
    }
    // No other flow handles it either
    return {
      type: 'not_offered',
      text: 'Disculpa, ese producto no lo manejamos por el momento.'
    };
  }

  // ── MATCHED PRODUCTS ──
  // Product flow only returns product data. Wholesale/retail intent detection
  // is the duty of retail_flow and wholesale_flow, not product_flow.
  if (search.matches && search.matches.length > 0) {
    console.log(`🏛️ [product] Found ${search.matches.length} product(s)`);
    return {
      type: 'products_found',
      products: search.matches,
      confidence: search.confidence
    };
  }

  // ── NO MATCH ──
  return null;
}

module.exports = {
  handle,
  loadProducts,
  loadAllSalableProducts,
  findProduct,
  findFlowForProduct,
  checkWholesaleThreshold
};
