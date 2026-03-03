/**
 * Routing middleware: aiFallback
 *
 * Final catch-all in the pipeline. When no other middleware produced a
 * response, this middleware escalates to the AI-powered fallback handler
 * which uses OpenAI to generate a contextual answer. If even the AI
 * fallback fails, a static handoff to a human agent is triggered as a
 * last resort.
 */

const { OpenAI } = require("openai");
const { handleFallback } = require("../core/fallback");

const openai = new OpenAI({ apiKey: process.env.AI_API_KEY });
const botNames = ["Paula", "Sof\u00EDa", "Camila", "Valeria", "Daniela"];
const BOT_PERSONA_NAME = botNames[Math.floor(Math.random() * botNames.length)];

module.exports = async function aiFallback(ctx, next) {
  const { userMessage, psid, convo } = ctx;

  if (!ctx.response) {
    console.log(`\u{1F534} No handler matched, escalating to AI fallback: "${userMessage}"`);

    try {
      const fallbackResponse = await handleFallback(userMessage, psid, convo, openai, BOT_PERSONA_NAME);
      if (fallbackResponse) {
        ctx.response = fallbackResponse;
        ctx.handledBy = fallbackResponse.handledBy || "ai_fallback";
        return;
      }
    } catch (fbErr) {
      console.error(`\u274C handleFallback error:`, fbErr.message);
    }

    // Static handoff as absolute last resort
    const { executeHandoff } = require("../utils/executeHandoff");
    const handoffResponse = await executeHandoff(psid, convo, userMessage, {
      reason: "Static fallback handoff",
      responsePrefix: "D\u00E9jame comunicarte con un especialista que pueda ayudarte mejor.\n\n",
      lastIntent: "fallback_handoff"
    });

    if (handoffResponse) {
      ctx.response = handoffResponse;
      ctx.handledBy = handoffResponse.handledBy || "fallback_handoff";
      return;
    }
  }

  await next();
};
