// ai.js
require("dotenv").config();
const { getConversation, updateConversation } = require("./conversationManager");
const { OpenAI } = require("openai");
const { getBusinessInfo } = require("./businessInfoManager");
const { findFamily } = require("./familySearch");
const { findProductFamily, getProduct } = require("./hybridSearch");
const {
  parseDimensions,
  getAvailableSizes,
  findClosestSizes,
  calculateRecommendedArea,
  isInstallationQuery,
  isColorQuery,
  isApproximateMeasure,
  generateSizeResponse,
  generateGenericSizeResponse
} = require("./measureHandler");

// Modelos para consultas ligeras en catálogo general / subfamilias
const ProductFamily = require("./models/ProductFamily");
const ProductSubfamily = require("./models/ProductSubfamily");
const Campaign = require("./models/Campaign");

const openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

const botNames = ["Paula", "Sofía", "Camila", "Valeria", "Daniela"];
const BOT_PERSONA_NAME = botNames[Math.floor(Math.random() * botNames.length)];
console.log(`🤖 Asistente asignada para esta sesión: ${BOT_PERSONA_NAME}`);

// —— Utilidades simples —— //
const confirmRegex = /\b(s[ií]|claro|ok|dale|va|sale|de acuerdo|sí por favor|mu[eé]strame|ens[eé]ñame|ver|sí,.*|por favor)\b/i;
const productKeywordRegex = /\b(malla|sombra|borde|rollo|beige|monofilamento|invernadero|negra|verde|blanca|azul|90%|70%)\b/i;

async function generateReply(userMessage, psid) {
  try {
    const cleanMsg = userMessage.toLowerCase().trim();
    const convo = await getConversation(psid);
    console.log("🧩 Conversación actual:", convo);


    // 🚀 Detectar campaña (solo si aún no hay una asignada en la conversación)
    let campaign = null;
    if (!convo.campaignRef && referral?.ref) {
      campaign = await Campaign.findOne({ ref: referral.ref, active: true });
      if (campaign) {
        console.log(`🎯 Campaña detectada: ${campaign.name}`);
        await updateConversation(psid, {
          campaignRef: campaign.ref,
          lastIntent: "campaign_entry",
        });
      }
    } else if (convo.campaignRef) {
      campaign = await Campaign.findOne({ ref: convo.campaignRef });
    }

    // 💬 Si hay campaña activa, usar su flujo inicial
    if (campaign && campaign.productFocus?.variant === "Beige") {
      if (convo.lastIntent === "campaign_entry") {
        return {
          type: "text",
          text: campaign.initialMessage || `👋 ¡Hola! Bienvenido a Hanlob 🌿. ¿Deseas ver precios o medidas de nuestra malla beige?`
        };
      }

      // Ejemplo de respuestas dinámicas según etapa
      if (/precio|cuánto|vale|costo/.test(cleanMsg)) {
        return {
          type: "text",
          text: `La *malla sombra beige confeccionada* tiene un precio desde $450 según la medida 🌿.\n¿Quieres que te envíe las medidas disponibles?`
        };
      }

      if (/medidas|tamaño|dimensiones/.test(cleanMsg)) {
        return {
          type: "text",
          text: `Estas son algunas de nuestras medidas estándar para malla beige confeccionada:\n• 3x4m\n• 4x6m\n• 4.2x25m (rollo completo)\n\n¿Te gustaría que te ayude a elegir la adecuada para tu proyecto?`
        };
      }

      if (/invernadero|jard[ií]n|estacionamiento|sombra/.test(cleanMsg)) {
        return {
          type: "text",
          text: `Perfecto 🌞 la *malla sombra beige 90%* es ideal para ese tipo de proyectos.\n¿Deseas una cotización personalizada o prefieres ver las medidas disponibles?`
        };
      }
    }


    // 1) SALUDO (solo una vez / anti doble-saludo)
    if (/^(hola|buenas|buenos días|buenas tardes|buenas noches|qué tal|hey|hi|hello)\b/.test(cleanMsg)) {
      const now = Date.now();
      const lastGreetTime = convo.lastGreetTime || 0;
      const oneHour = 60 * 60 * 1000;
      const greetedRecently = convo.greeted && (now - lastGreetTime) < oneHour;

      if (greetedRecently) {
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

    // 2) Cierre / agradecimiento
    if (/\b(gracias|perfecto|excelente|muy amable|adiós|bye|nos vemos)\b/i.test(cleanMsg)) {
      await updateConversation(psid, { state: "closed", unknownCount: 0, lastIntent: "closed" });
      return { type: "text", text: `¡Gracias a ti! 🌷 Soy ${BOT_PERSONA_NAME} y fue un gusto ayudarte. ¡Que tengas un excelente día! ☀️` };
    }

    // 3) Consulta general de productos (antes de familia o producto)
    if (
      /\b(que|qué)\b.*\b(prod(uctos|utos)|vendes|manej(a|an)|tienes|ofreces|cat[aá]logo|disponibles|manej[aá]is)\b/i.test(cleanMsg)
      || /\b(cat[aá]logo|productos disponibles|qué vendes|qué manejas)\b/i.test(cleanMsg)
    ) {
      const families = await ProductFamily.find({ active: true }).lean();

      if (!families || families.length === 0) {
        await updateConversation(psid, { lastIntent: "catalog_overview" });
        return {
          type: "text",
          text: `En este momento no tengo productos registrados 😔, pero pronto actualizaremos nuestro catálogo.`
        };
      }

      const familyNames = families.map(f => f.name).join(" y ");

      const subfamilies = await ProductSubfamily.find({ available: true }).lean();
      const mallaFamily = families.find(f => f.name.toLowerCase().includes("malla sombra"));
      let mallaSubs = "";
      if (mallaFamily) {
        const relatedSubs = subfamilies.filter(s => s.familyId.toString() === mallaFamily._id.toString());
        mallaSubs = relatedSubs.map(s => s.name).join(" y ");
      }

      await updateConversation(psid, { lastIntent: "catalog_overview" });

      return {
        type: "text",
        text:
          `En Hanlob manejamos actualmente ${familyNames.toLowerCase()} 🌿.\n` +
          (mallaSubs ? `La malla sombra está disponible en versiones ${mallaSubs}.\n` : "") +
          `¿Quieres que te muestre algunas opciones o precios?`
      };
    }

    // 🧩 4️⃣ Detección de familia (malla sombra / borde)
    const familyDetected = await findFamily(cleanMsg);
    if (familyDetected) {
      // 👉 Evita repetir la descripción si ya fue mostrada recientemente
      if (convo.familyShown === familyDetected.name) {
        // Ya fue mostrada: pasa directo a opciones o preguntas más específicas
        await updateConversation(psid, { lastIntent: "family_repeat", unknownCount: 0 });
        return {
          type: "text",
          text: `Claro 😊, seguimos con ${familyDetected.name.toLowerCase()}. ¿Te interesa ver las opciones en beige confeccionada o en rollos monofilamento?`
        };
      }

      // Guarda esta familia como la última mostrada
      await updateConversation(psid, {
        familyShown: familyDetected.name,
        lastIntent: "family_info",
        unknownCount: 0
      });

      // —— Manejo de disponibilidad —— //
      if (!familyDetected.active) {
        return {
          type: "text",
          text: `Por ahora la familia ${familyDetected.name} no está disponible, pero pronto tendremos novedades. 🌱`
        };
      }

      if (!familyDetected.hasProducts) {
        return {
          type: "text",
          text: `Por ahora no tenemos productos disponibles en la familia ${familyDetected.name}, pero pronto los agregaremos. 😊`
        };
      }

      // —— Descripción extendida —— //
      const familyInfo = await findProductFamily(cleanMsg);
      if (familyInfo) {
        return {
          type: "image",
          text:
            `Sí, contamos con ${familyInfo.name.toLowerCase()} 🌿\n` +
            `${familyInfo.description}\n\n` +
            `Usos comunes:\n- ${familyInfo.commonUses?.join("\n- ") || "Jardines e invernaderos"}\n\n` +
            `¿Quieres ver opciones beige confeccionadas o en rollo monofilamento?`,
          imageUrl: familyInfo.imageUrl || "https://i.imgur.com/X3vYt8E.png"
        };
      }

      // —— Fallback sin descripción extendida —— //
      return {
        type: "text",
        text:
          `Sí, contamos con ${familyDetected.name.toLowerCase()}. ${familyDetected.description}\n` +
          `¿Buscas algún tipo en especial, como beige o monofilamento?`
      };
    }

    // 🧩 MEASURES INTENT - Handle size/dimension inquiries
    // Check for installation query first
    if (isInstallationQuery(cleanMsg)) {
      await updateConversation(psid, { lastIntent: "installation_query", unknownCount: 0 });
      const installationResponses = [
        `Por el momento no ofrecemos servicio de instalación 😊. Sin embargo, puedo ayudarte con las medidas y especificaciones para que puedas instalarla tú o contratar a alguien de confianza.`,
        `No contamos con servicio de instalación, pero te puedo asesorar con las medidas exactas que necesitas 🌿.`,
        `Nosotros no ofrecemos instalación, pero si me dices el área a cubrir, te ayudo a elegir la medida perfecta 😊.`
      ];
      return {
        type: "text",
        text: installationResponses[Math.floor(Math.random() * installationResponses.length)]
      };
    }

    // Check for color query
    if (isColorQuery(cleanMsg)) {
      await updateConversation(psid, { lastIntent: "color_query", unknownCount: 0 });
      const colorResponses = [
        `Por ahora solo manejamos malla sombra beige en versión confeccionada 🌿. ¿Te gustaría ver las medidas disponibles?`,
        `Actualmente tenemos disponible solo el color beige en malla confeccionada. ¿Quieres que te muestre los tamaños?`,
        `De momento contamos únicamente con beige, que es nuestro color más popular 😊. ¿Te interesa ver precios y medidas?`
      ];
      return {
        type: "text",
        text: colorResponses[Math.floor(Math.random() * colorResponses.length)]
      };
    }

    // Check for approximate measurement / need to measure properly
    if (isApproximateMeasure(cleanMsg)) {
      await updateConversation(psid, { lastIntent: "measurement_guidance", unknownCount: 0 });
      const guidanceResponses = [
        `¡Perfecto! 📏 Te recomiendo medir el área total y luego elegir una malla aproximadamente 1 metro cuadrado más pequeña que el espacio. Esto deja espacio para los tensores y asegura una instalación adecuada.\n\nCuando tengas la medida exacta, con gusto te ayudo a elegir el tamaño ideal 🌿`,
        `Muy bien pensado medir con precisión 👍. Un consejo: la malla debe ser cerca de 1m² más pequeña que el área total para dejar espacio a los tensores.\n\n¿Ya tienes una idea aproximada de las dimensiones?`,
        `Excelente idea medir bien 📐. Recuerda que la malla debe ser un poco más pequeña que el área (aproximadamente 1m² menos) para los tensores.\n\nCuando tengas las medidas, cuéntame y te sugiero la opción perfecta 🌿`
      ];
      return {
        type: "text",
        text: guidanceResponses[Math.floor(Math.random() * guidanceResponses.length)]
      };
    }

    // Parse specific dimensions from message
    const dimensions = parseDimensions(cleanMsg);

    // Generic measure/price inquiry (no specific dimensions mentioned)
    const isGenericMeasureQuery = /\b(medidas|tamaños?|dimensiones|cu[aá]nto|precio|cuestan)\b.*\b(medidas|disponibles|tienen|hay|manejan)\b/i.test(cleanMsg) && !dimensions;

    if (dimensions || isGenericMeasureQuery) {
      const campaignRef = convo.campaignRef || null;
      const availableSizes = await getAvailableSizes(campaignRef);

      if (dimensions) {
        // User specified exact dimensions
        const closest = findClosestSizes(dimensions, availableSizes);
        const businessInfo = await getBusinessInfo();

        await updateConversation(psid, {
          lastIntent: "specific_measure",
          unknownCount: 0,
          requestedSize: `${dimensions.width}x${dimensions.height}`
        });

        return {
          type: "text",
          text: generateSizeResponse({
            smaller: closest.smaller,
            bigger: closest.bigger,
            exact: closest.exact,
            requestedDim: dimensions,
            availableSizes,
            businessInfo
          }).text
        };
      } else {
        // Generic inquiry - show all available sizes
        await updateConversation(psid, { lastIntent: "generic_measures", unknownCount: 0 });

        return {
          type: "text",
          text: generateGenericSizeResponse(availableSizes)
        };
      }
    }

    // 5) Confirmaciones dependientes del contexto (sin disparar búsquedas a ciegas)
    if (confirmRegex.test(cleanMsg)) {
      const li = convo.lastIntent;

      // Después del catálogo general → ofrece caminos claros
      if (li === "catalog_overview") {
        await updateConversation(psid, { lastIntent: "family_malla_prompt" });
        // Mostrar que Borde existe pero sin productos, y empujar a Malla
        return {
          type: "text",
          text:
            `Perfecto. Por ahora Borde aún no tiene productos disponibles.\n` +
            `De malla sombra puedo mostrarte:\n` +
            `• Beige confeccionada (medidas listas con refuerzo y ojillos)\n` +
            `• Rollos (beige o monofilamento)\n\n` +
            `¿Cuál te interesa ver primero?`
        };
      }

      // Confirmación tras hablar de malla → empujar a sub-opciones
      if (li === "family_malla" || li === "family_malla_prompt") {
        await updateConversation(psid, { lastIntent: "awaiting_malla_choice" });
        return {
          type: "text",
          text:
            `¿Prefieres beige confeccionada (medidas) o rollos?\n` +
            `Si te interesan rollos, tengo beige y monofilamento (negra).`
        };
      }

      // Si no hay contexto útil, no dispares búsquedas ciegas
      await updateConversation(psid, { lastIntent: "confirm_noop" });
      return { type: "text", text: `¡Listo! Dime si quieres ver beige confeccionada o rollos y te paso opciones. 😊` };
    }

    // 6) Búsqueda de productos (solo si hay palabras clave reales)
    if (productKeywordRegex.test(cleanMsg)) {
      const product = await getProduct(cleanMsg);
      if (product) {
        await updateConversation(psid, { lastIntent: "product_search", state: "active", unknownCount: 0 });

        if (product.source === "ml") {
          return {
            type: "image",
            text: `Encontré "${product.name}" en nuestro catálogo de Mercado Libre 💚\nPuedes comprarlo directamente aquí 👉 ${product.permalink}`,
            imageUrl: product.imageUrl
          };
        }

        return {
          type: "image",
          text: `Tenemos "${product.name}" disponible por $${product.price}.\n¿Quieres que te envíe más detalles o medidas?`,
          imageUrl: product.imageUrl
        };
      }
    } else {
      console.log("🧠 Mensaje sin keywords útiles; no se llama getProduct().");
    }

    // 7) Fallback IA
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

    const newUnknownCount = (convo.unknownCount || 0) + 1;
    await updateConversation(psid, { lastIntent: "fallback", unknownCount: newUnknownCount });

    console.log(`🤔 Respuestas sin información: ${newUnknownCount}`);

    if (newUnknownCount >= 2) {
      const info = await getBusinessInfo();
      await updateConversation(psid, {
        unknownCount: 0,
        state: "needs_human",
        handoffRequested: true,
        handoffReason: "Bot unable to help after 2 unknown messages",
        handoffTimestamp: new Date()
      });

      const whatsappLink = "https://wa.me/524425957432";

      if (!info) {
        console.warn("⚠️ No se encontró información de negocio en la base de datos.");
        return {
          type: "text",
          text: `Déjame conectarte con un asesor que pueda ayudarte mejor 😊\n\n💬 WhatsApp: ${whatsappLink}`
        };
      }

      return {
        type: "text",
        text:
          `Déjame conectarte con un asesor que pueda ayudarte mejor 😊\n\n` +
          `💬 WhatsApp: ${whatsappLink}\n\n` +
          `📞 ${info.phones.join(" / ")}\n🕓 ${info.hours}`
      };
    }

    return { type: "text", text: aiReply };

  } catch (error) {
    console.error("❌ Error en generateReply:", error);
    return { type: "text", text: "Lo siento 😔 hubo un problema al generar la respuesta." };
  }
}

module.exports = { generateReply };
