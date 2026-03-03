/**
 * Enrichment middleware: productResolver
 *
 * Self-healing mechanism that resolves a missing productInterest from
 * the conversation's adId or campaignRef. This ensures that even if the
 * initial referral handling failed, the product context is recovered
 * before downstream middleware needs it.
 *
 * Resolution strategies (in order):
 *   1. adId   -> resolveByAdId   -> ProductFamily lookup -> lockPOI
 *   2. campaignRef -> resolveByCampaignRef -> ProductFamily lookup -> lockPOI
 *   3. Campaign name inference (malla/borde/ground) -> root family lockPOI
 *
 * Always calls next() — never sets ctx.response.
 */

const { updateConversation } = require("../../conversationManager");
const { lockPOI } = require("../utils/productTree");

module.exports = async function productResolver(ctx, next) {
  const { psid, convo } = ctx;

  if (!convo?.productInterest && (convo?.adId || convo?.campaignRef)) {
    try {
      const { resolveByAdId, resolveByCampaignRef } = require("../../utils/campaignResolver");
      const { getProductInterest } = require("../utils/productEnricher");
      const ProductFamily = require("../../models/ProductFamily");

      let resolvedSettings = null;

      // Try adId first, then campaignRef
      if (convo.adId) {
        resolvedSettings = await resolveByAdId(convo.adId);
        console.log(`🔄 Self-healing: resolving productInterest from adId ${convo.adId}`);
      } else if (convo.campaignRef) {
        resolvedSettings = await resolveByCampaignRef(convo.campaignRef);
        console.log(`🔄 Self-healing: resolving productInterest from campaignRef ${convo.campaignRef}`);
      }

      if (resolvedSettings?.productIds?.length > 0) {
        const productId =
          resolvedSettings.mainProductId || resolvedSettings.productIds[0];
        const product = await ProductFamily.findById(productId).lean();

        if (product) {
          const productInterest = await getProductInterest(product);
          if (productInterest) {
            const poiContext = await lockPOI(psid, product._id);
            if (poiContext) {
              convo.productInterest = productInterest;
              convo.poiLocked = true;
              convo.poiRootId = poiContext.rootId?.toString();
              convo.poiRootName = poiContext.rootName;
              convo.productFamilyId = product._id.toString();
              console.log(
                `✅ Self-healing: POI locked to ${poiContext.rootName} (${productInterest})`
              );
            } else {
              await updateConversation(psid, { productInterest });
              convo.productInterest = productInterest;
              console.log(
                `✅ Self-healing: set productInterest to ${productInterest}`
              );
            }
          }
        }
      } else if (resolvedSettings?.campaignName) {
        // Fallback: infer from campaign name and try to lock to root family
        const campaignName = (resolvedSettings.campaignName || "").toLowerCase();
        let productInterest = null;
        let rootFamilyName = null;

        if (
          campaignName.includes("malla") ||
          campaignName.includes("sombra") ||
          campaignName.includes("confeccionada")
        ) {
          productInterest = "malla_sombra";
          rootFamilyName = "Malla Sombra";
        } else if (
          campaignName.includes("borde") ||
          campaignName.includes("jardin")
        ) {
          productInterest = "borde_separador";
          rootFamilyName = "Borde Separador";
        } else if (
          campaignName.includes("ground") ||
          campaignName.includes("cover")
        ) {
          productInterest = "ground_cover";
          rootFamilyName = "Ground Cover";
        }

        if (productInterest) {
          const ProductFamily = require("../../models/ProductFamily");
          const rootFamily = await ProductFamily.findOne({
            name: { $regex: rootFamilyName, $options: "i" },
            parentId: null,
            active: true,
          }).lean();

          if (rootFamily) {
            const poiContext = await lockPOI(psid, rootFamily._id);
            if (poiContext) {
              convo.productInterest = productInterest;
              convo.poiLocked = true;
              convo.poiRootId = poiContext.rootId?.toString();
              convo.poiRootName = poiContext.rootName;
              console.log(
                `✅ Self-healing: POI locked to ${poiContext.rootName} from campaign name`
              );
            }
          } else {
            await updateConversation(psid, { productInterest });
            convo.productInterest = productInterest;
            console.log(
              `✅ Self-healing: inferred productInterest ${productInterest} from campaign name`
            );
          }
        }
      }
    } catch (err) {
      console.error(
        `⚠️ Self-healing productInterest resolution failed:`,
        err.message
      );
    }
  }

  await next();
};
