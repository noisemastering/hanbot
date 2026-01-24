// scripts/seedIntents.js
// Seeds the Intent collection with default intents from the existing classifier

const mongoose = require("mongoose");
require("dotenv").config();

const Intent = require("../models/Intent");

async function seedIntents() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB");

    console.log("\n🧠 Seeding Intents...\n");

    const intentsData = [
      // ========== GREETINGS & SOCIAL ==========
      {
        key: "greeting",
        name: "Saludo inicial",
        description: "Usuario saluda al bot (hola, buenos días, etc.)",
        category: "greeting",
        keywords: ["hola", "buenos días", "buenas tardes", "buenas noches", "hey", "hi", "qué tal", "buen día"],
        patterns: ["^hola[!\\s]*$", "^buenas?[!\\s]*$", "^buenos?\\s+d[ií]as?[!\\s]*$"],
        priority: 8,
        handlerType: "ai_generate",
        active: true
      },
      {
        key: "thanks",
        name: "Agradecimiento",
        description: "Usuario agradece al bot",
        category: "greeting",
        keywords: ["gracias", "muchas gracias", "thanks", "thx", "te agradezco"],
        patterns: ["^gracias[!\\s]*$", "^muchas\\s+gracias[!\\s]*$"],
        priority: 7,
        handlerType: "ai_generate",
        active: true
      },
      {
        key: "goodbye",
        name: "Despedida",
        description: "Usuario se despide",
        category: "greeting",
        keywords: ["adiós", "hasta luego", "bye", "nos vemos", "chao", "hasta pronto"],
        patterns: ["^adi[oó]s[!\\s]*$", "^bye[!\\s]*$"],
        priority: 7,
        handlerType: "ai_generate",
        active: true
      },

      // ========== PRODUCT QUERIES ==========
      {
        key: "price_query",
        name: "Consulta de precio",
        description: "Usuario pregunta por precios de productos",
        category: "product",
        keywords: ["precio", "precios", "cuánto cuesta", "cuánto vale", "costo", "costos", "cotización", "cotizar"],
        patterns: ["precio[s]?", "cu[aá]nto\\s+cuesta", "cu[aá]nto\\s+vale"],
        priority: 9,
        handlerType: "ai_generate",
        active: true
      },
      {
        key: "product_inquiry",
        name: "Consulta de producto",
        description: "Usuario pregunta sobre productos disponibles",
        category: "product",
        keywords: ["tienen", "manejan", "venden", "productos", "catálogo", "qué tienen", "malla", "borde"],
        patterns: ["tienen.*\\?", "manejan.*\\?", "qu[eé]\\s+productos"],
        priority: 8,
        handlerType: "ai_generate",
        active: true
      },
      {
        key: "availability_query",
        name: "Consulta de disponibilidad",
        description: "Usuario pregunta si hay stock disponible",
        category: "product",
        keywords: ["hay", "tienen disponible", "en stock", "disponibilidad", "existencia"],
        patterns: ["hay\\s+disponible", "tienen\\s+en\\s+stock"],
        priority: 8,
        handlerType: "ai_generate",
        active: true
      },

      // ========== SPECIFICATIONS (User providing info) ==========
      {
        key: "size_specification",
        name: "Especificación de tamaño",
        description: "Usuario proporciona dimensiones (4x5, 3 metros por 4, etc.)",
        category: "product",
        keywords: ["metros", "medida", "medidas", "dimensiones", "tamaño"],
        patterns: ["\\d+[xX×]\\d+", "\\d+\\s*metros?\\s*(por|x)\\s*\\d+"],
        priority: 9,
        handlerType: "ai_generate",
        active: true
      },
      {
        key: "percentage_specification",
        name: "Especificación de porcentaje",
        description: "Usuario especifica porcentaje de sombra",
        category: "product",
        keywords: ["porcentaje", "sombra", "por ciento", "%"],
        patterns: ["\\d+\\s*%", "al\\s+\\d+", "\\d+\\s+por\\s+ciento"],
        priority: 9,
        handlerType: "ai_generate",
        active: true
      },
      {
        key: "quantity_specification",
        name: "Especificación de cantidad",
        description: "Usuario indica cantidad que necesita",
        category: "product",
        keywords: ["quiero", "necesito", "piezas", "rollos", "unidades"],
        patterns: ["\\d+\\s*(piezas?|rollos?|unidades?)", "quiero\\s+\\d+", "necesito\\s+\\d+"],
        priority: 8,
        handlerType: "ai_generate",
        active: true
      },
      {
        key: "color_specification",
        name: "Especificación de color",
        description: "Usuario menciona color deseado",
        category: "product",
        keywords: ["negro", "verde", "beige", "blanco", "azul", "color"],
        patterns: ["color\\s+(negro|verde|beige|blanco|azul)", "en\\s+(negro|verde|beige|blanco|azul)"],
        priority: 7,
        handlerType: "ai_generate",
        active: true
      },
      {
        key: "length_specification",
        name: "Especificación de largo (borde)",
        description: "Usuario especifica largo para borde separador",
        category: "product",
        keywords: ["6 metros", "9 metros", "18 metros", "54 metros", "largo"],
        patterns: ["(6|9|18|54)\\s*m(etros)?"],
        priority: 8,
        handlerType: "ai_generate",
        active: true
      },

      // ========== LOGISTICS ==========
      {
        key: "shipping_query",
        name: "Consulta de envío",
        description: "Usuario pregunta sobre envíos y entregas",
        category: "service",
        keywords: ["envío", "envíos", "mandan", "entregan", "enviar", "paquetería", "hacen envíos"],
        patterns: ["hacen\\s+env[ií]os?", "env[ií]an\\s+a"],
        priority: 8,
        handlerType: "ai_generate",
        active: true
      },
      {
        key: "location_query",
        name: "Consulta de ubicación",
        description: "Usuario pregunta dónde están ubicados",
        category: "service",
        keywords: ["dónde están", "ubicación", "dirección", "tienda", "tienda física", "sucursal"],
        patterns: ["d[oó]nde\\s+est[aá]n", "tienen\\s+tienda"],
        priority: 7,
        handlerType: "ai_generate",
        active: true
      },
      {
        key: "payment_query",
        name: "Consulta de pago",
        description: "Usuario pregunta formas de pago",
        category: "purchase",
        keywords: ["pago", "pagar", "tarjeta", "transferencia", "efectivo", "formas de pago", "métodos de pago"],
        patterns: ["c[oó]mo\\s+pago", "aceptan\\s+tarjeta", "formas\\s+de\\s+pago"],
        priority: 7,
        handlerType: "ai_generate",
        active: true
      },
      {
        key: "delivery_time_query",
        name: "Consulta de tiempo de entrega",
        description: "Usuario pregunta cuándo llega su pedido",
        category: "service",
        keywords: ["cuándo llega", "tiempo de entrega", "cuánto tarda", "días de entrega"],
        patterns: ["cu[aá]ndo\\s+llega", "cu[aá]nto\\s+tarda", "tiempo\\s+de\\s+entrega"],
        priority: 7,
        handlerType: "ai_generate",
        active: true
      },

      // ========== SERVICE ==========
      {
        key: "installation_query",
        name: "Consulta de instalación",
        description: "Usuario pregunta si instalan",
        category: "service",
        keywords: ["instalan", "instalación", "colocan", "poner", "montar"],
        patterns: ["instalan\\s*\\?", "incluye\\s+instalaci[oó]n"],
        priority: 7,
        handlerType: "ai_generate",
        active: true
      },
      {
        key: "warranty_query",
        name: "Consulta de garantía",
        description: "Usuario pregunta sobre garantía",
        category: "service",
        keywords: ["garantía", "cuánto dura", "durabilidad", "vida útil"],
        patterns: ["tiene\\s+garant[ií]a", "cu[aá]nto\\s+dura"],
        priority: 6,
        handlerType: "ai_generate",
        active: true
      },
      {
        key: "custom_size_query",
        name: "Consulta de medidas personalizadas",
        description: "Usuario pregunta si hacen medidas especiales",
        category: "service",
        keywords: ["a medida", "personalizado", "medida especial", "tamaño personalizado", "hacen a la medida"],
        patterns: ["hacen\\s+a\\s+medida", "tama[ñn]o\\s+personalizado"],
        priority: 7,
        handlerType: "ai_generate",
        active: true
      },

      // ========== CONVERSATION FLOW ==========
      {
        key: "confirmation",
        name: "Confirmación",
        description: "Usuario confirma o acepta algo",
        category: "other",
        keywords: ["sí", "si", "ok", "okey", "vale", "claro", "perfecto", "exacto", "correcto", "esa", "ese", "eso"],
        patterns: ["^s[ií][!\\s]*$", "^ok[!\\s]*$", "^perfecto[!\\s]*$"],
        priority: 8,
        handlerType: "ai_generate",
        active: true
      },
      {
        key: "rejection",
        name: "Rechazo",
        description: "Usuario rechaza o niega algo",
        category: "other",
        keywords: ["no", "nop", "nope", "nel", "negativo", "otra", "diferente", "otro"],
        patterns: ["^no[!\\s]*$", "^nop[!\\s]*$"],
        priority: 8,
        handlerType: "ai_generate",
        active: true
      },
      {
        key: "clarification",
        name: "Clarificación",
        description: "Usuario pide o da aclaraciones",
        category: "other",
        keywords: ["a qué te refieres", "no entiendo", "explícame", "cómo es eso"],
        patterns: ["no\\s+entiendo", "a\\s+qu[eé]\\s+te\\s+refieres"],
        priority: 6,
        handlerType: "ai_generate",
        active: true
      },
      {
        key: "follow_up",
        name: "Seguimiento",
        description: "Usuario da seguimiento a tema anterior",
        category: "other",
        keywords: ["y", "también", "además", "otra cosa", "una cosa más"],
        patterns: [],
        priority: 5,
        handlerType: "ai_generate",
        active: true
      },

      // ========== HUMAN HANDOFF ==========
      {
        key: "human_request",
        name: "Solicitud de humano",
        description: "Usuario pide hablar con una persona real",
        category: "support",
        keywords: ["humano", "persona", "agente", "asesor", "especialista", "hablar con alguien", "representante", "ejecutivo"],
        patterns: ["hablar\\s+con\\s+(alguien|una?\\s+persona|agente)", "quiero\\s+un\\s+humano"],
        priority: 10,
        handlerType: "human_handoff",
        active: true
      },
      {
        key: "complaint",
        name: "Queja",
        description: "Usuario expresa frustración o queja",
        category: "support",
        keywords: ["queja", "reclamo", "molesto", "frustrado", "enojado", "no sirve", "mal servicio", "problema"],
        patterns: ["est[oá]s?\\s+(molesto|enojado|frustrado)", "mal\\s+servicio"],
        priority: 10,
        handlerType: "human_handoff",
        active: true
      },

      // ========== NEW INTENTS ==========
      {
        key: "distributor_inquiry",
        name: "Consulta de distribuidores",
        description: "Usuario quiere convertirse en distribuidor o pregunta por distribuidores",
        category: "purchase",
        keywords: ["distribuidor", "distribuir", "mayoreo", "mayorista", "ser distribuidor", "revender", "revendedor"],
        patterns: ["quiero\\s+ser\\s+distribuidor", "venden\\s+al\\s+por\\s+mayor", "precio\\s+mayoreo"],
        priority: 8,
        handlerType: "human_handoff",
        responseTemplate: "¡Gracias por tu interés en ser distribuidor! Para darte información detallada sobre nuestro programa de distribuidores, un especialista te contactará pronto.",
        active: true
      },
      {
        key: "company_info",
        name: "Información de la empresa",
        description: "Usuario pregunta sobre la empresa, quiénes son, qué hacen",
        category: "other",
        keywords: ["quiénes son", "qué hacen", "sobre ustedes", "empresa", "compañía", "historia"],
        patterns: ["qui[eé]nes\\s+son", "qu[eé]\\s+hacen", "sobre\\s+(ustedes|la\\s+empresa)"],
        priority: 6,
        handlerType: "ai_generate",
        active: true
      },

      // ========== OTHER ==========
      {
        key: "off_topic",
        name: "Fuera de tema",
        description: "Mensaje no relacionado con productos ni servicios",
        category: "other",
        keywords: [],
        patterns: [],
        priority: 1,
        handlerType: "ai_generate",
        active: true
      },
      {
        key: "unclear",
        name: "No claro",
        description: "No se puede determinar la intención del usuario",
        category: "other",
        keywords: [],
        patterns: [],
        priority: 1,
        handlerType: "ai_generate",
        active: true
      }
    ];

    let created = 0;
    let updated = 0;

    for (const intentData of intentsData) {
      let intent = await Intent.findOne({ key: intentData.key });

      if (intent) {
        console.log(`⚠️  Intent "${intentData.key}" already exists. Updating...`);
        Object.assign(intent, intentData);
        await intent.save();
        updated++;
      } else {
        console.log(`➕ Creating intent "${intentData.key}"...`);
        intent = new Intent(intentData);
        await intent.save();
        created++;
      }

      console.log(`   ✅ ${intent.name} (${intent.key}) - ${intent.category}`);
    }

    console.log("\n✅ Seeding complete!");
    console.log(`   Created: ${created}`);
    console.log(`   Updated: ${updated}`);
    console.log(`   Total: ${intentsData.length}\n`);

    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

seedIntents();
