/**
 * Routing middleware: pendingResponses
 *
 * Handles two pending-response scenarios:
 *  1. pendingLocationResponse — the bot previously asked "de que ciudad?" for
 *     location stats; this processes the user's answer.
 *  2. pendingShippingLocation — the bot previously asked for a zip/city for
 *     shipping; this parses the location and confirms shipping availability.
 */

const { handleLocationStatsResponse } = require("../utils/locationStats");
const { updateConversation } = require("../../conversationManager");

module.exports = async function pendingResponses(ctx, next) {
  const { userMessage, psid, convo } = ctx;

  // --- 1. Location stats response ---
  if (convo.pendingLocationResponse) {
    const locationResponse = await handleLocationStatsResponse(userMessage, psid, convo);
    if (locationResponse) {
      ctx.response = locationResponse;
      ctx.handledBy = locationResponse.handledBy || "pending_location_response";
      return;
    }
  }

  // --- 2. Shipping location response ---
  if (convo.pendingShippingLocation) {
    const { parseLocationResponse, syncLocationToUser } = require("../utils/locationStats");
    const { detectLocationEnhanced } = require("../../mexicanLocations");

    let location = parseLocationResponse(userMessage);

    if (!location) {
      const detected = await detectLocationEnhanced(userMessage);
      if (detected) {
        location = {
          city: detected.location || detected.normalized,
          state: detected.state,
          zipcode: detected.code || null
        };
      }
    }

    await updateConversation(psid, { pendingShippingLocation: false });

    if (location) {
      console.log("\u{1F4CD} Shipping location received:", location);
      const convoUpdate = { unknownCount: 0 };
      if (location.city) convoUpdate.city = location.city;
      if (location.state) convoUpdate.stateMx = location.state;
      if (location.zipcode) convoUpdate.zipcode = location.zipcode;
      await updateConversation(psid, convoUpdate);
      await syncLocationToUser(psid, location, "shipping_question");

      const locationStr = location.city || location.state || `CP ${location.zipcode}`;
      const isQueretaro =
        (location.state && /quer[eé]taro/i.test(location.state)) ||
        (location.city && /quer[eé]taro/i.test(location.city));

      let text = `Perfecto, enviamos a ${locationStr} a trav\u00E9s de Mercado Libre \u{1F4E6}`;
      if (isQueretaro) {
        text += `\n\nTambi\u00E9n puedes visitar nuestra tienda en el parque industrial Navex, Tlacote.`;
      }

      const hasSpecs = convo.productSpecs?.width || convo.productSpecs?.height || convo.productSpecs?.dimensions;
      if (!convo.lastSharedProductId && !hasSpecs) {
        text += `\n\n\u00BFQu\u00E9 medida de malla sombra necesitas?`;
      }

      ctx.response = { type: "text", text };
      ctx.handledBy = "pending_shipping_location";
      return;
    }
  }

  await next();
};
