/**
 * Enrichment middleware: productIdentifier
 *
 * Identifies products mentioned in the user's message and manages the
 * Product of Interest (POI) lock:
 *   1. Runs identifyAndSetProduct against the current message
 *   2. If a product is found and POI is not yet locked, locks it
 *   3. If POI is already locked, checks whether the user is asking about
 *      a product outside the current tree — and switches POI if so
 *
 * Sets ctx.identifiedProduct for downstream middleware.
 * Always calls next() — never sets ctx.response.
 */

const { identifyAndSetProduct } = require("../utils/productIdentifier");
const { lockPOI, checkVariantExists } = require("../utils/productTree");

module.exports = async function productIdentifier(ctx, next) {
  const { userMessage, psid, convo } = ctx;

  // ── Identify product from message ───────────────────────────────────
  const identifiedProduct = await identifyAndSetProduct(userMessage, psid, convo);

  if (identifiedProduct) {
    convo.productInterest = identifiedProduct.key;
    console.log(
      `🎯 Product context: ${identifiedProduct.displayName} (${identifiedProduct.key})`
    );

    // Lock POI with full tree context
    if (identifiedProduct.familyId && !convo.poiLocked) {
      const poiContext = await lockPOI(psid, identifiedProduct.familyId);
      if (poiContext) {
        convo.poiLocked = true;
        convo.poiRootId = poiContext.rootId?.toString();
        convo.poiRootName = poiContext.rootName;
        console.log(
          `🔒 POI locked: ${poiContext.name} (root: ${poiContext.rootName})`
        );
      }
    }
  }

  ctx.identifiedProduct = identifiedProduct || null;

  // ── POI switching: detect out-of-tree product mentions ──────────────
  if (convo.poiLocked && convo.poiRootId) {
    const otherProduct = await identifyAndSetProduct(userMessage, psid, {});

    if (otherProduct && otherProduct.familyId) {
      const variantCheck = await checkVariantExists(
        convo.poiRootId,
        otherProduct.name
      );

      if (!variantCheck.exists && variantCheck.reason === "not_in_tree") {
        const newPOI = await lockPOI(psid, otherProduct.familyId);
        if (newPOI) {
          convo.productInterest = otherProduct.key;
          convo.poiRootId = newPOI.rootId?.toString();
          convo.poiRootName = newPOI.rootName;
          console.log(`🔄 POI switched: ${newPOI.rootName}`);
        }
      }
    }
  }

  await next();
};
