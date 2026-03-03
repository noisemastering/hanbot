/**
 * Guard middleware: linkNotWorking
 *
 * Detects when the user reports that a previously shared link doesn't work
 * (e.g. "no abre", "link roto", "no puedo entrar").  If the conversation
 * has a stored product link, it re-shares the original URL directly and
 * short-circuits the pipeline.
 */

const linkNotWorkingPattern = /\b(no\s+(me\s+)?(abr[eé]|habre|carga|funciona|jala|sirve|deja|abre)|link.*(roto|malo|error)|no\s+puedo\s+(abrir|entrar|acceder|ver\s+el\s+link)|no\s+(entr[oa]|abr[oeéi])\s+(al|el|en)\s+(link|enlace))\b/i;

module.exports = async function linkNotWorking(ctx, next) {
  const { userMessage, convo } = ctx;

  if (linkNotWorkingPattern.test(userMessage) && (convo?.lastSharedProductLink || convo?.lastProductLink)) {
    console.log("🔗 Link not working detected, sharing original ML URL directly");

    const originalUrl = convo.lastSharedProductLink || convo.lastProductLink;

    await ctx.updateConvo({ lastIntent: "link_reshared", unknownCount: 0 });

    ctx.response = {
      type: "text",
      text: `¡Disculpa! Aquí te comparto el enlace directo:\n\n${originalUrl}`
    };
    ctx.handledBy = "link_not_working";
    return;
  }

  await next();
};
