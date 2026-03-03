/**
 * Guard middleware: trustConcern
 *
 * Detects messages expressing distrust, scam fears or safety concerns
 * (e.g. "es seguro?", "es confiable?", "estafa").  Reassures the user
 * by explaining Mercado Libre's buyer protection program and the business's
 * track record, then short-circuits the pipeline.
 */

const { updateConversation } = require("../../conversationManager");

const trustConcernPattern = /\b(estaf\w*|me\s+robaron|fraude|timo|enga[ñn]\w*|desconfian\w*|no\s+conf[ií]\w*|conf[ií]ar|conf[ií]able|miedo|me\s+da\s+pendiente|es\s+segur[oa]|ser[áa]\s+segur[oa]|le\s+pienso|le\s+pienzo)\b/i;

module.exports = async function trustConcern(ctx, next) {
  const { userMessage, psid } = ctx;

  if (trustConcernPattern.test(userMessage)) {
    console.log("🛡️ Trust/scam concern detected, reassuring with ML buyer protection");

    // Prefer ctx.updateConvo shorthand; fall back to updateConversation
    const update = ctx.updateConvo || ((data) => updateConversation(psid, data));
    await update({ lastIntent: "trust_concern_addressed" });

    ctx.response = {
      type: "text",
      text: "Entiendo tu preocupación, y es muy válida. La compra se realiza por Mercado Libre, así que cuentas con su programa de *compra protegida*: si el producto no te llega, llega defectuoso o es diferente a lo que pediste, te devuelven tu dinero.\n\nAdemás somos fabricantes con más de 5 años vendiendo en Mercado Libre. ¿Te gustaría ver el producto?"
    };
    ctx.handledBy = "trust_concern";
    return;
  }

  await next();
};
