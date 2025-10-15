// Load environment variables from .env file
require('dotenv').config();
const Message = require('./models/Message');


const { generateReply } = require('./ai');
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;


const mongoose = require('mongoose');
const User = require("./models/User");


mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB Atlas'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

const productRoutes = require('./routes/productsRoutes');
app.use('/products', productRoutes);

// --- CORS CONFIG ---
const cors = require("cors");

app.use(
  cors({
    origin: [
      "http://localhost:3001", // tu dashboard local
      "https://emanational-leeanna-impressionable.ngrok-free.dev" // tu túnel ngrok actual
    ],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);

// Asegura respuesta correcta a preflight requests (CORS)
app.options(/.*/, cors());


// Middleware - Parse JSON payloads
app.use(bodyParser.json());

// ============================================
// Start the Express Server with Socket.IO
// ============================================
const http = require("http");
const { Server } = require("socket.io");

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:3001"],
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"]
  }
});

io.on("connection", (socket) => {
  console.log("⚡ Cliente conectado al WebSocket");
  socket.on("disconnect", () => console.log("🔌 Cliente desconectado"));
});

// Emitir evento cuando se guarda un nuevo mensaje
async function saveMessage(psid, text, senderType) {
  const msg = await Message.create({ psid, text, senderType });
  io.emit("new_message", msg); // <-- Notifica al dashboard
  return msg;
}

// ============================================
// Registrar usuario en base al PSID
// ============================================
async function registerUserIfNeeded(senderPsid) {
  const existing = await User.findOne({ psid: senderPsid });
  if (existing) return;

  try {
    const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN;
    const res = await axios.get(
      `https://graph.facebook.com/v18.0/${senderPsid}`,
      {
        params: {
          fields: "first_name,last_name,profile_pic,locale,timezone,gender",
          access_token: FB_PAGE_TOKEN
        }
      }
    );

    const userData = res.data;
    await User.create({
      psid: senderPsid,
      ...userData
    });

    console.log(`✅ Usuario registrado: ${userData.first_name} ${userData.last_name}`);
  } catch (err) {
    console.error("❌ Error al registrar usuario:", err.response?.data || err.message);
  }
}


// Reemplaza los lugares donde guardas mensajes:
async function callSendAPI(senderPsid, messageData) {
  const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN;

  try {
    const response = await axios.post(
      "https://graph.facebook.com/v18.0/me/messages",
      {
        recipient: { id: senderPsid },
        message: messageData,
      },
      {
        headers: {
          Authorization: `Bearer ${FB_PAGE_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✅ Mensaje enviado con éxito:", response.data);
  } catch (error) {
    console.error("❌ Error enviando mensaje:", error.response?.data || error.message);
  }
}

// ============================================
// Rutas adicionales
// ============================================

// Ruta para ver mensajes desde el dashboard
app.get("/messages", async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || auth.trim() !== "Bearer hanlob_admin_2025") {
    return res.status(403).json({ success: false, error: "Unauthorized" });
  }

  try {
    const messages = await Message.find().sort({ timestamp: -1 });
    res.json({ success: true, data: messages });
  } catch (err) {
    console.error("❌ Error retrieving messages:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// Ruta temporal para insertar mensaje de prueba
app.post("/test-message", async (req, res) => {
  try {
    const msg = await saveMessage("test_user_123", "Mensaje de prueba desde API local", "user");
    console.log("💾 Test message saved:", msg);
    res.status(201).json({ success: true, message: msg });
  } catch (err) {
    console.error("❌ Error saving test message:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/webhook", async (req, res) => {
  const body = req.body;
  if (body.object === "page") {
    for (const entry of body.entry) {
      const webhookEvent = entry.messaging[0];
      const senderPsid = webhookEvent.sender.id;

      if (webhookEvent.message) {
        const messageText = webhookEvent.message.text;
        console.log(`📨 Message received from ${senderPsid}: "${messageText}"`);

        await registerUserIfNeeded(senderPsid);
        await saveMessage(senderPsid, messageText, "user");

        (async () => {
          try {
            const reply = await generateReply(messageText, senderPsid);

            // 🧩 Nuevo control de seguridad: si no hay respuesta, salimos
            if (!reply) {
              console.log("⚠️ generateReply devolvió null, no se envía mensaje.");
              return;
            }

            // 🧩 Segundo filtro: si no hay texto ni imagen, no enviar nada
            const hasText = reply.text && reply.text.trim() !== "";
            const hasImage = reply.imageUrl && reply.imageUrl.trim() !== "";

            if (!hasText && !hasImage) {
              console.log("⚠️ Respuesta vacía o sin contenido válido, no se envía.");
              return;
            }

            // Enviar imagen si existe
            if (reply.type === "image" && hasImage) {
              await callSendAPI(senderPsid, {
                attachment: {
                  type: "image",
                  payload: { url: reply.imageUrl, is_reusable: true }
                }
              });
            }

            // Enviar texto si existe
            if (hasText) {
              await callSendAPI(senderPsid, { text: reply.text });
              await saveMessage(senderPsid, reply.text, "bot");
            }

          } catch (err) {
            console.error("❌ Error al responder con IA:", err);
          }
        })();
      }
    }
    res.status(200).send("EVENT_RECEIVED");
  } else {
    res.sendStatus(404);
  }
});

// ============================================
// 🔍 RUTAS DE DEPURACIÓN DE CONVERSACIONES
// ============================================
const { getConversation, updateConversation, resetConversation } = require("./conversationManager");

// Obtener una conversación específica
app.get("/conversations/:psid", async (req, res) => {
  try {
    const convo = await getConversation(req.params.psid);
    if (!convo) return res.status(404).json({ success: false, error: "Conversación no encontrada" });
    res.json({ success: true, data: convo });
  } catch (err) {
    console.error("❌ Error al obtener conversación:", err);
    res.status(500).json({ success: false, error: "Error del servidor" });
  }
});

// Actualizar estado manualmente (por ejemplo: active, closed)
app.patch("/conversations/:psid", async (req, res) => {
  try {
    const { state, greeted, lastIntent } = req.body;
    await updateConversation(req.params.psid, { state, greeted, lastIntent });
    res.json({ success: true, message: "Conversación actualizada correctamente" });
  } catch (err) {
    console.error("❌ Error al actualizar conversación:", err);
    res.status(500).json({ success: false, error: "Error del servidor" });
  }
});

// Reiniciar conversación (para pruebas o limpieza)
app.delete("/conversations/:psid", async (req, res) => {
  try {
    await resetConversation(req.params.psid);
    res.json({ success: true, message: "Conversación reiniciada correctamente" });
  } catch (err) {
    console.error("❌ Error al reiniciar conversación:", err);
    res.status(500).json({ success: false, error: "Error del servidor" });
  }
});


server.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
  console.log(`📡 Webhook endpoint: http://localhost:${PORT}/webhook`);
});
