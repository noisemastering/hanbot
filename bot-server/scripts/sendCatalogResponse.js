// Script to send catalog response to a specific user
require('dotenv').config();
const axios = require('axios');

const PSID = process.argv[2] || '244235116506';
const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN;

const message = {
  text: `¡Hola! Disculpa la demora en responder.

En Hanlob manejamos malla sombra en diferentes medidas y presentaciones 🌿

Nuestros productos incluyen:
• Malla sombra confeccionada (lista para instalar) en múltiples medidas
• Malla sombra por rollo
• Diferentes porcentajes de sombra (50%, 70%, 90%)
• Color beige principalmente

¿Qué medida específica necesitas? Puedo ayudarte con precios y disponibilidad.

O también puedes ver nuestro catálogo completo aquí:
https://www.mercadolibre.com.mx/tienda/distribuidora-hanlob`
};

async function sendMessage() {
  try {
    console.log(`📤 Sending message to PSID: ${PSID}`);

    const response = await axios.post(
      "https://graph.facebook.com/v18.0/me/messages",
      {
        recipient: { id: PSID },
        message: message,
      },
      {
        headers: {
          Authorization: `Bearer ${FB_PAGE_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✅ Message sent successfully!");
    console.log("Response:", JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error("❌ Error sending message:");
    console.error(error.response?.data || error.message);

    if (error.response?.data?.error?.code === 551) {
      console.log("\n⚠️  Error 551: This user cannot receive messages.");
      console.log("Possible reasons:");
      console.log("- User blocked the page");
      console.log("- 24-hour messaging window expired");
      console.log("- Invalid PSID");
    }
  }
}

sendMessage();
