// ai.js
require("dotenv").config();
const { getConversation, updateConversation } = require("./conversationManager");
const { OpenAI } = require("openai");
const { getBusinessInfo } = require("./businessInfoManager");

const openai = new OpenAI({
  apiKey: process.env.AI_API_KEY,
});

const botNames = ["Paula", "Sofía", "Camila", "Valeria", "Daniela"];
const BOT_PERSONA_NAME = botNames[Math.floor(Math.random() * botNames.length)];
console.log(`🤖 Asistente asignada para esta sesión: ${BOT_PERSONA_NAME}`);

async function generateReply(userMessage, psid) {
  try {
    const cleanMsg = userMessage.toLowerCase().trim();
    const convo = await getConversation(psid);

    console.log("🧩 Conversación actual:", convo);

    // 🗣️ 1️⃣ SALUDO (solo una vez)
    if (/^(hola|buenas|buenos días|buenas tardes|buenas noches|qué tal|hey|hi|hello)\b/.test(cleanMsg)) {
      const now = Date.now();
      const lastGreetTime = convo.lastGreetTime || 0;
      const oneHour = 60 * 60 * 1000;
      const alreadyGreetedRecently = convo.greeted && (now - lastGreetTime) < oneHour;

      if (alreadyGreetedRecently) {
        return { type: "text", text: `¡Hola de nuevo! 🌷 Soy ${BOT_PERSONA_NAME}. ¿Qué estás buscando esta vez?` };
      }

      await updateConversation(psid, {
        greeted: true,
        state: "active",
        lastIntent: "greeting",
        lastGreetTime: now,
        unknownCount: 0
      });

      const greetings = [
        `¡Hola! 👋 Soy ${BOT_PERSONA_NAME}, tu asesora virtual en Hanlob. ¿Qué tipo de producto te interesa ver?`,
        `¡Qué gusto saludarte! 🌿 Soy ${BOT_PERSONA_NAME} del equipo de Hanlob.`,
        `¡Hola! 🙌 Soy ${BOT_PERSONA_NAME}, asesora de Hanlob. Cuéntame, ¿qué producto te interesa?`,
      ];
      return { type: "text", text: greetings[Math.floor(Math.random() * greetings.length)] };
    }

    // 💬 2️⃣ Agradecimientos o cierre
    if (/\b(gracias|perfecto|excelente|muy amable|adiós|bye|nos vemos)\b/i.test(cleanMsg)) {
      await updateConversation(psid, { state: "closed", unknownCount: 0 });
      return { type: "text", text: `¡Gracias a ti! 🌷 Soy ${BOT_PERSONA_NAME} y fue un gusto ayudarte. ¡Que tengas un excelente día! ☀️` };
    }

    // 🤖 3️⃣ Fallback IA (cuando no tiene información)
    const response = await openai.chat.completions.create({
      model: process.env.AI_MODEL || "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `
Eres ${BOT_PERSONA_NAME}, asesora de ventas de Hanlob.
Responde con tono humano, empático y breve.
Si no tienes información sobre algo, discúlpate de forma amable (sin usar emojis de risa) y di que no tienes información sobre eso.
`
        },
        { role: "user", content: userMessage }
      ],
      temperature: 0.8
    });

    const aiReply = response.choices?.[0]?.message?.content || `Lo siento 😔 no tengo información sobre eso.`;

    // 🔢 Control de respuestas sin información
    const newUnknownCount = (convo.unknownCount || 0) + 1;
    await updateConversation(psid, { lastIntent: "fallback", unknownCount: newUnknownCount });

    console.log(`🤔 Respuestas sin información: ${newUnknownCount}`);

    if (newUnknownCount >= 2) {
      const info = await getBusinessInfo();
      await updateConversation(psid, { unknownCount: 0 }); // 🔁 reinicia contador

      if (!info) {
        console.warn("⚠️ No se encontró información de negocio en la base de datos.");
        return {
          type: "text",
          text: `Lo siento 😔, por ahora no tengo información disponible sobre eso. Si deseas hablar con un asesor, puedo darte los teléfonos de contacto.`
        };
      }

      return {
        type: "text",
        text:
          `Lo siento 😔, por el momento no tengo información disponible sobre eso.\n` +
          `Si deseas hablar directamente con alguien de nuestro equipo, puedes comunicarte 📞:\n\n` +
          `${info.phones.join(" / ")}\n` +
          `🕓 Horarios de atención: ${info.hours}\n` +
          `📍 ${info.address}`
      };
    }

    return { type: "text", text: aiReply };

  } catch (error) {
    console.error("❌ Error en generateReply:", error);
    return { type: "text", text: "Lo siento 😔 hubo un problema al generar la respuesta." };
  }
}

module.exports = { generateReply };
