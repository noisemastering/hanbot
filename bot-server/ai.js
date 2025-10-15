// ai.js
require("dotenv").config();
const { getConversation, updateConversation } = require("./conversationManager");
const { OpenAI } = require("openai");
const { getProduct } = require("./hybridSearch");

const openai = new OpenAI({
  apiKey: process.env.AI_API_KEY,
});

async function generateReply(userMessage, psid) {
  try {
    const cleanMsg = userMessage.toLowerCase().trim();
    const convo = await getConversation(psid);

    // 🗣️ 1️⃣ SALUDO
    if (/^(hola|buenas|buenos días|buenas tardes|buenas noches|qué tal|hey|hi|hello)\b/.test(cleanMsg)) {
      if (!convo.greeted) {
        await updateConversation(psid, { greeted: true, state: "active", lastIntent: "greeting" });
        const greetings = [
          "¡Hola! 😊 Soy el asistente de Hanlob, ¿cómo estás hoy?",
          "¡Qué gusto saludarte! 👋 Soy el asesor virtual de Hanlob. ¿Buscas algo para tu jardín o invernadero?",
          "¡Hola! 🙌 Bienvenido a Hanlob. Cuéntame, ¿qué tipo de producto te interesa ver?",
        ];
        const randomGreeting = greetings[Math.floor(Math.random() * greetings.length)];
        return { type: "text", text: randomGreeting };
      }
      return { type: "text", text: "¡Hola de nuevo! 😄 Cuéntame, ¿qué estás buscando esta vez?" };
    }

    // 🧠 2️⃣ Preguntas generales sobre catálogo
    if (/\b(que|qué)\b.*\b(prod(uctos|utos)|vendes|tienes|cat[aá]logo|mostrar|ofreces)\b/i.test(cleanMsg)) {
      await updateConversation(psid, { lastIntent: "catalog", state: "active" });
      return {
        type: "text",
        text: `¡Hola! 🌿 En Hanlob contamos con malla sombra, lonas y accesorios para jardín e invernadero.\n¿Quieres que te envíe el catálogo completo para ver opciones?\n\n👉 [Ver catálogo completo](https://articulo.mercadolibre.com.mx/_CustId_374316327)`
      };
    }

    // 🌱 3️⃣ Descripciones de productos o tipos
    if (/\b(invernadero|tipos|opciones|manej(a|an)|productos|ofreces|usos|variedades|cultivos)\b/i.test(cleanMsg)) {
      await updateConversation(psid, { lastIntent: "catalog_info", state: "active" });
      return {
        type: "text",
        text: `Tenemos varias opciones para invernaderos 🌱:\n
- Malla sombra del 50% al 95% (beige, verde y negro)\n
- Malla monofilamento (negra, más resistente y duradera)\n
- Lonas y accesorios para estructura\n
¿Quieres que te envíe algunas imágenes o precios?`
      };
    }

    // 💬 4️⃣ Confirmación (sí, muéstrame, ok, etc.)
    if (/\b(s[ií]|mu[eé]strame|ens[eé]ñame|ver|claro|ok|por favor)\b/i.test(cleanMsg)) {
      if (convo.lastIntent === "catalog_info") {
        await updateConversation(psid, { lastIntent: "show_products", state: "active" });
        const related = await getProduct("malla sombra");
        if (related) {
          return {
            type: "image",
            text: `Perfecto 👌 Aquí tienes una opción popular: ${related.name}\n${related.permalink}`,
            imageUrl: related.imageUrl
          };
        }
        return { type: "text", text: "Por ahora no tengo imágenes disponibles, pero puedo enviarte precios y medidas si quieres 😊" };
      }
    }

    // 💬 5️⃣ Agradecimientos o cierre
    if (/\b(gracias|perfecto|excelente|muy amable|adiós|bye|nos vemos)\b/i.test(cleanMsg)) {
      await updateConversation(psid, { state: "closed" });
      return { type: "text", text: "¡Gracias a ti! 😊 Que tengas un excelente día 🌞" };
    }

    // 🛒 6️⃣ Búsqueda directa de productos
    const product = await getProduct(cleanMsg);
    if (product) {
      await updateConversation(psid, { lastIntent: "product_search", state: "active" });
      const text = `Tenemos "${product.name}" disponible por $${product.price || "Consultar precio"}.\nPuedes verlo aquí 👉 ${product.permalink}`;
      return {
        type: "image",
        text,
        imageUrl: product.imageUrl || "https://i.imgur.com/X3vYt8E.png",
      };
    }

    // 🤖 7️⃣ Fallback IA (respuesta empática si no se encontró nada)
    const response = await openai.chat.completions.create({
      model: process.env.AI_MODEL || "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `
Eres asesor de ventas de Hanlob, una empresa mexicana especializada en malla sombra, lonas y artículos para jardinería.
Tu tarea es responder de forma humana, empática y útil. 
Si el cliente pregunta por algo que no tenemos, díselo con tacto y ofrece alternativas.
No menciones inteligencia artificial ni digas “no tengo información”.
`
        },
        { role: "user", content: userMessage }
      ],
      temperature: 0.8
    });

    const aiReply = response.choices?.[0]?.message?.content || "Puedo ayudarte a encontrar lo que necesites 😊";
    await updateConversation(psid, { lastIntent: "fallback" });

    return { type: "text", text: aiReply };

  } catch (error) {
    console.error("❌ Error en generateReply:", error);
    return { type: "text", text: "Lo siento, hubo un problema al generar la respuesta." };
  }
}

module.exports = { generateReply };
