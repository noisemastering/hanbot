// scripts/seedCampaignProduct.js
require("dotenv").config();
const mongoose = require("mongoose");
const CampaignProduct = require("../models/CampaignProduct");

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Conectado a MongoDB Atlas");

    // Eliminamos productos anteriores de la misma campaña (para evitar duplicados)
    await CampaignProduct.deleteMany({ campaignRef: "hanlob_confeccionada_general_oct25" });

    const product = {
      campaignRef: "hanlob_confeccionada_general_oct25",
      name: "Malla sombra confeccionada reforzada",
      shortName: "Malla sombra beige",
      shade: "90%",
      color: "Beige",

      descriptionVariants: [
        {
          title: "Clásica y duradera 🌿",
          body: "Malla sombra confeccionada al 90 % de cobertura, diseñada para larga duración. Reforzada en las esquinas y con sujetadores a todo el borde para una instalación fácil y segura.",
          callToAction: "¿Quieres que te muestre medidas o precios disponibles?"
        },
        {
          title: "Preparada para resistir ☀️",
          body: "Malla de larga duración reforzada con argollas metálicas. Ideal para sombra permanente en patios, cocheras o jardines.",
          callToAction: "¿Te gustaría saber cuál se ajusta mejor a tu espacio?"
        }
      ],

      features: [
        "Reforzada en las esquinas",
        "Argollas en todo el borde",
        "Fabricación de larga duración",
        "Lista para instalar"
      ],

      variants: [
        {
          size: "2x4m reforzada",
          price: 515.57,
          permalink: "https://articulo.mercadolibre.com.mx/MLM-1984371701-malla-90-de-sombra-lista-para-instalar-beige-de-2m-x-4m-_JM",
          source: "mercadolibre",
          imageUrl: "https://http2.mlstatic.com/D_NQ_NP_2X_941537-MLM47570879060_092021-F.webp"
        },
        {
          size: "2x5m reforzada",
          price: 0, // no hay precio exacto pero tiene link, puedes actualizarlo luego
          permalink: "https://articulo.mercadolibre.com.mx/MLM-793419350-malla-90-de-sombra-lista-para-instalar-beige-de-2m-x-5m-_JM",
          source: "mercadolibre"
        },
        {
          size: "4x4m reforzada",
          price: 583.95,
          permalink: "https://articulo.mercadolibre.com.mx/MLM-801597999-malla-90-sombra-raschell-beige-de-4mx4m-lista-para-instalar-_JM",
          source: "mercadolibre"
        },
        {
          size: "4x5m reforzada",
          price: 596.7,
          permalink: "https://articulo.mercadolibre.com.mx/MLM-2007726491-malla-90-de-sombra-lista-para-instalar-beige-de-4m-x-5m-_JM",
          source: "mercadolibre"
        },
        {
          size: "5x2m reforzada",
          price: 458.49,
          permalink: "https://articulo.mercadolibre.com.mx/MLM-793415950-malla-90-de-sombra-lista-para-instalar-beige-de-5m-x-2m-_JM",
          source: "mercadolibre"
        },
        {
          size: "5x3m reforzada",
          price: 576.95,
          permalink: "https://articulo.mercadolibre.com.mx/MLM-793416169-malla-90-de-sombra-lista-para-instalar-beige-de-5m-x-3m-_JM",
          source: "mercadolibre"
        },
        {
          size: "5x4m reforzada",
          price: 643.44,
          permalink: "https://articulo.mercadolibre.com.mx/MLM-793419962-malla-90-de-sombra-lista-para-instalar-beige-de-5m-x-4m-_JM",
          source: "mercadolibre"
        },
        {
          size: "5x5m reforzada",
          price: 732.45,
          permalink: "https://articulo.mercadolibre.com.mx/MLM-793416433-malla-90-de-sombra-lista-para-instalar-beige-de-5m-x-5m-_JM",
          source: "mercadolibre"
        }
      ],

      suggestClosest: true,
      fallbackMessage:
        "Puedo ayudarte con precios, medidas o cotizaciones de la malla sombra confeccionada 🌿. ¿Qué te gustaría saber?",
      active: true
    };

    await CampaignProduct.create(product);
    console.log("✅ Producto de campaña insertado correctamente.");

    await mongoose.disconnect();
    console.log("🔒 Conexión cerrada.");
  } catch (err) {
    console.error("❌ Error al insertar producto:", err);
  }
})();
