/**
 * Guard middleware: phoneCapture
 *
 * Detects when the user shares a phone number (classified as phone_shared).
 * Captures the number as lead data, flags the conversation for human handoff,
 * and responds with a confirmation message.  Short-circuits the pipeline.
 */

module.exports = async function phoneCapture(ctx, next) {
  const { classification } = ctx;

  // Bail if classification is missing – nothing to inspect
  if (!classification) return await next();

  if (classification.intent === "phone_shared" && classification.entities?.phone) {
    const phone = classification.entities.phone;
    console.log(`📱 HOT LEAD! Phone number captured: ${phone}`);

    await ctx.updateConvo({
      "leadData.contact": phone,
      "leadData.contactType": "phone",
      "leadData.capturedAt": new Date(),
      handoffRequested: true,
      handoffReason: `Cliente compartió su teléfono: ${phone}`,
      handoffTimestamp: new Date(),
      state: "needs_human"
    });

    const VIDEO_LINK = "https://youtube.com/shorts/XLGydjdE7mY";
    ctx.response = {
      type: "text",
      text: `¡Perfecto! Anotado tu número. En un momento te contacta uno de nuestros asesores para atenderte personalmente.\n\n📽️ Mientras tanto, conoce más sobre nuestra malla sombra:\n${VIDEO_LINK}`
    };
    ctx.handledBy = "phone_captured";
    return;
  }

  await next();
};
