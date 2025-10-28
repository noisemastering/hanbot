// seedCampaigns.js
require("dotenv").config();
const mongoose = require("mongoose");
const Campaign = require("../models/Campaign");

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("✅ Conectado a MongoDB Atlas");

  const campaigns = [
    {
      ref: "hanlob_confeccionada_general_oct25",
      name: "Malla Sombra Confeccionada - Octubre 2025",
      description:
        "Campaña enfocada en el público residencial y de hogar, dirigida a personas de 25 a 60 años interesadas en mejoras exteriores, privacidad y sombra para patios, jardines o cocheras.",

      active: true,

      source: {
        campaign_id: "120226050770160686",
        adset_id: "120232182338610686",
        ad_id: "120232182338600686",
        medium: "facebook_ads"
      },

      productFocus: {
        family: "Malla sombra",
        variant: "Beige",
        type: "Confeccionada",
      },

      initialMessage:
        "👋 ¡Hola! Bienvenido a Hanlob 🌿. ¿Deseas ver precios o medidas de nuestra malla sombra beige confeccionada?",
      followupPrompts: [
        "precio",
        "medidas",
        "invernadero",
        "rollo",
        "cotización",
      ],

      defaultFlow: "malla_confeccionada",
      conversionGoal: "solicitar_cotizacion",
      metrics: {
        visits: 0,
        interactions: 0,
        leads: 0,
      },
    },
  ];

  await Campaign.deleteMany({}); // limpia campañas anteriores
  await Campaign.insertMany(campaigns);
  console.log("🌱 Campañas insertadas correctamente:");
  campaigns.forEach(c => console.log(`→ ${c.name}`));

  await mongoose.disconnect();
  console.log("🔌 Desconectado de MongoDB");
}

seed().catch((err) => {
  console.error("❌ Error al insertar campañas:", err);
  process.exit(1);
});
