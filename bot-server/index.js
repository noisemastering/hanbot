// Load environment variables from .env file
require('dotenv').config();
const Message = require('./models/Message');


const { generateReply } = require('./ai/index');
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

// --- CORS CONFIG (MUST BE BEFORE ROUTES) ---
const cors = require("cors");

app.use(
  cors({
    origin: function(origin, callback) {
      // Allow requests with no origin (mobile apps, Postman, etc.)
      if (!origin) return callback(null, true);

      const allowedOrigins = [
        "http://localhost:3001",
        "https://hanbot-nu.vercel.app",
        "https://emanational-leeanna-impressionable.ngrok-free.dev"
      ];

      // Allow all vercel.app subdomains
      if (origin.includes('.vercel.app') || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);

// Asegura respuesta correcta a preflight requests (CORS)
app.options(/.*/, cors());

// Middleware - Parse JSON payloads (MUST come before routes)
app.use(bodyParser.json());

// Register routes AFTER CORS and body-parser middleware
const productRoutes = require('./routes/productsRoutes');
const campaignRoutes = require('./routes/campaignsRoutes');
const campaignProductRoutes = require('./routes/campaignProductsRoutes');
const conversationsRoutes = require('./routes/conversationsRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');

app.use('/products', productRoutes);
app.use('/campaigns', campaignRoutes);
app.use('/campaign-products', campaignProductRoutes);
app.use('/conversations', conversationsRoutes);
app.use('/analytics', analyticsRoutes);

// ============================================
// Start the Express Server with Socket.IO
// ============================================
const http = require("http");
const { Server } = require("socket.io");

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:3001",
      "https://hanbot-nu.vercel.app"
    ],
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

// 👨‍💼 API: Manual human takeover
app.post("/api/conversation/:psid/takeover", async (req, res) => {
  // Authentication check
  const auth = req.headers.authorization;
  if (!auth || auth.trim() !== "Bearer hanlob_admin_2025") {
    return res.status(403).json({ success: false, error: "Unauthorized" });
  }

  try {
    const { psid } = req.params;
    const { agentName, reason } = req.body;

    console.log(`👨‍💼 API: Manual takeover requested for ${psid} by ${agentName || 'agent'}`);

    // Cancel any pending debounced messages
    const { cancelDebounce } = require("./messageDebouncer");
    cancelDebounce(psid);

    // Mark conversation as human_active
    await updateConversation(psid, {
      state: "human_active",
      lastIntent: "human_takeover",
      agentTookOverAt: new Date(),
      agentName: agentName || "Human Agent"
    });

    res.json({
      success: true,
      message: `Conversation with ${psid} is now handled by ${agentName || 'human agent'}`,
      psid,
      agentName: agentName || "Human Agent",
      timestamp: new Date()
    });
  } catch (error) {
    console.error("❌ Error in manual takeover:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 🤖 API: Release conversation back to bot
app.post("/api/conversation/:psid/release", async (req, res) => {
  // Authentication check
  const auth = req.headers.authorization;
  if (!auth || auth.trim() !== "Bearer hanlob_admin_2025") {
    return res.status(403).json({ success: false, error: "Unauthorized" });
  }

  try {
    const { psid } = req.params;

    console.log(`🤖 API: Releasing conversation ${psid} back to bot`);

    // Mark conversation as active (bot control)
    await updateConversation(psid, {
      state: "active",
      lastIntent: "bot_resumed"
    });

    res.json({
      success: true,
      message: `Conversation with ${psid} released back to bot`,
      psid,
      timestamp: new Date()
    });
  } catch (error) {
    console.error("❌ Error releasing conversation:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 🔍 API: Check conversation status
app.get("/api/conversation/:psid/status", async (req, res) => {
  // Authentication check
  const auth = req.headers.authorization;
  if (!auth || auth.trim() !== "Bearer hanlob_admin_2025") {
    return res.status(403).json({ success: false, error: "Unauthorized" });
  }

  try {
    const { psid } = req.params;
    const { getConversation, isHumanActive } = require("./conversationManager");

    const convo = await getConversation(psid);
    const humanActive = await isHumanActive(psid);

    res.json({
      psid,
      state: convo?.state || "unknown",
      humanActive,
      agentName: convo?.agentName || null,
      agentTookOverAt: convo?.agentTookOverAt || null,
      lastIntent: convo?.lastIntent || null,
      timestamp: new Date()
    });
  } catch (error) {
    console.error("❌ Error checking conversation status:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /webhook - Facebook webhook verification
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN || "hanlob_verify_token_2025";

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("✅ Webhook verificado correctamente");
      res.status(200).send(challenge);
    } else {
      console.log("❌ Token de verificación incorrecto");
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
});

app.post("/webhook", async (req, res) => {
  const body = req.body;
  if (body.object === "page") {
    for (const entry of body.entry) {
      const webhookEvent = entry.messaging[0];
      const senderPsid = webhookEvent.sender.id;


      // 🤝 HANDOVER PROTOCOL: Handle thread control events
      if (webhookEvent.pass_thread_control) {
        const targetPsid = senderPsid;
        console.log(`👨‍💼 HANDOVER: Human agent took control of conversation with ${targetPsid}`);
        console.log(`   New owner app ID: ${webhookEvent.pass_thread_control.new_owner_app_id}`);
        console.log(`   Metadata: ${webhookEvent.pass_thread_control.metadata || 'none'}`);

        await updateConversation(targetPsid, {
          state: "human_active",
          lastIntent: "human_takeover",
          agentTookOverAt: new Date()
        });

        res.sendStatus(200);
        return;
      }

      if (webhookEvent.take_thread_control) {
        const targetPsid = senderPsid;
        console.log(`🤖 HANDOVER: Bot regained control of conversation with ${targetPsid}`);
        console.log(`   Previous owner app ID: ${webhookEvent.take_thread_control.previous_owner_app_id}`);

        await updateConversation(targetPsid, {
          state: "active",
          lastIntent: "bot_resumed"
        });

        res.sendStatus(200);
        return;
      }

      // 🧩 BLOQUE NUEVO: detección de campañas o enlaces con ?ref=
      const referral = webhookEvent.referral || webhookEvent.postback?.referral;
      if (referral) {
        console.log("🧭 Usuario llegó desde una campaña o enlace promocional:");
        console.log("  Ref:", referral.ref);
        console.log("  Ad ID:", referral.ad_id);
        console.log("  Campaign ID:", referral.campaign_id);

        // Guardamos datos de campaña en la conversación (sin tocar tu modelo User)
        await updateConversation(senderPsid, {
          lastIntent: "ad_entry",
          campaignRef: referral.ref || null,
          adId: referral.ad_id || null,
          campaignId: referral.campaign_id || null,
        });

        // 💬 Mensaje inicial según la campaña
        if (referral.ref === "malla_beige") {
          await callSendAPI(senderPsid, {
            text: "👋 ¡Hola! Soy Camila de Hanlob. Veo que te interesa la *malla sombra beige* 🌿 ¿Deseas ver precios o medidas?",
          });
        } else if (referral.ref === "borde_jardin") {
          await callSendAPI(senderPsid, {
            text: "🌱 ¡Hola! Te cuento sobre nuestros *bordes para jardín*. ¿Buscas algo flexible o rígido?",
          });
        }
      }

      if (webhookEvent.message) {
        const messageText = webhookEvent.message.text;
        const FB_PAGE_ID = process.env.FB_PAGE_ID;

        // 🔍 DEBUG: Log all webhook event details for debugging human agent detection
        console.log(`\n🔍 WEBHOOK DEBUG:`);
        console.log(`   senderPsid: ${senderPsid}`);
        console.log(`   FB_PAGE_ID: ${FB_PAGE_ID}`);
        console.log(`   recipientId: ${webhookEvent.recipient?.id}`);
        console.log(`   messageText: "${messageText}"`);
        console.log(`   Match? ${senderPsid === FB_PAGE_ID ? '✅ YES (HUMAN AGENT)' : '❌ NO (USER)'}\n`);

        // 🧑‍💼 Detect if message is from Page (human agent) or from User
        const isFromPage = senderPsid === FB_PAGE_ID;
        const recipientPsid = isFromPage ? webhookEvent.recipient.id : senderPsid;

        if (isFromPage) {
          // Message from human agent - mark conversation as human_active and don't respond
          console.log(`👨‍💼 Human agent message detected for user ${recipientPsid}: "${messageText}"`);

          // Cancel any pending debounced messages for this user
          const { cancelDebounce } = require("./messageDebouncer");
          cancelDebounce(recipientPsid);

          await saveMessage(recipientPsid, messageText, "human");
          await updateConversation(recipientPsid, {
            state: "human_active",
            lastIntent: "human_takeover",
            agentTookOverAt: new Date()
          });
          // Don't generate bot response - acknowledge webhook and return
          res.sendStatus(200);
          return;
        }

        // 🤖 SKIP AUTOMATED FACEBOOK CTA RESPONSES
        // When users click CTA buttons like "Ver tienda en línea" from ads,
        // Facebook automatically sends a pre-formatted message on their behalf.
        // We detect these and don't respond to avoid duplicates.
        if (messageText) {
          const isFacebookAutoCTA =
            /^Ingresa al siguiente link:\s*https?:\/\//i.test(messageText) ||
            /^(Ver|See|View)\s+(tienda|shop|store|website)/i.test(messageText) ||
            /^(Haz|Hacer)\s+clic\s+aqu[íi]:/i.test(messageText) ||
            /^Shop\s+now:\s*https?:\/\//i.test(messageText);

          if (isFacebookAutoCTA) {
            console.log(`🤖 Facebook auto-CTA detected, skipping bot response: "${messageText}"`);
            await saveMessage(senderPsid, messageText, "user");
            res.sendStatus(200);
            return;
          }
        }

        // Message from user
        console.log(`📨 User message received from ${senderPsid}: "${messageText || '[image]'}"`);

        // Check if human agent is currently handling this conversation
        const { getConversation, isHumanActive } = require("./conversationManager");

        if (await isHumanActive(senderPsid)) {
          console.log(`⏸️ Conversation with ${senderPsid} is being handled by a human agent. Bot will not respond.`);

          // Cancel any pending debounced messages for this user
          const { cancelDebounce } = require("./messageDebouncer");
          cancelDebounce(senderPsid);

          await saveMessage(senderPsid, messageText || "[image]", "user");
          res.sendStatus(200);
          return;
        }

        // 📸 Check for attachments (images, stickers, etc.)
        const attachments = webhookEvent.message.attachments;
        if (attachments && attachments.length > 0) {
          // Check for stickers first (thumbs up, reactions, etc.)
          const stickerAttachment = attachments.find(att => att.type === "image" && att.payload?.sticker_id);

          if (stickerAttachment) {
            console.log(`👍 Sticker/reaction received (ID: ${stickerAttachment.payload.sticker_id})`);
            await registerUserIfNeeded(senderPsid);
            await saveMessage(senderPsid, "[Reacción enviada]", "user");

            // Don't respond to stickers/reactions - they're just acknowledgments
            res.sendStatus(200);
            return;
          }

          // Now check for actual images (photos)
          const imageAttachment = attachments.find(att => att.type === "image" && !att.payload?.sticker_id);

          if (imageAttachment) {
            const imageUrl = imageAttachment.payload.url;
            console.log(`📸 Image received: ${imageUrl}`);

            await registerUserIfNeeded(senderPsid);
            await saveMessage(senderPsid, `[Imagen enviada: ${imageUrl}]`, "user");

            // Analyze the image using GPT-4 Vision
            const { OpenAI } = require("openai");
            const { analyzeImage, generateImageResponse } = require("./ai/core/imageAnalyzer");
            const openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

            (async () => {
              try {
                const analysisResult = await analyzeImage(imageUrl, openai);
                const reply = generateImageResponse(analysisResult);

                await callSendAPI(senderPsid, { text: reply.text });
                await saveMessage(senderPsid, reply.text, "bot");

                // Update conversation intent
                const { updateConversation } = require("./conversationManager");
                await updateConversation(senderPsid, {
                  lastIntent: "image_received",
                  state: "active"
                });
              } catch (error) {
                console.error("❌ Error processing image:", error);
                await callSendAPI(senderPsid, {
                  text: "Recibí tu imagen, pero tuve problemas al analizarla. ¿Podrías describirme con palabras qué necesitas?"
                });
              }
            })();

            res.sendStatus(200);
            return;
          }
        }

        await registerUserIfNeeded(senderPsid);
        await saveMessage(senderPsid, messageText, "user");

        // Use message debouncer to wait for user to finish typing
        const { debounceMessage } = require("./messageDebouncer");

        debounceMessage(senderPsid, messageText, async (combinedMessage) => {
          try {
            console.log(`🤖 Generating reply for combined message: "${combinedMessage}"`);
            const reply = await generateReply(combinedMessage, senderPsid);

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
        });
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


// ============================================
// 🎯 Asignar campaña manualmente (para pruebas o dashboard)
// ============================================

// ============================================
// 📌 Asignar campaña manualmente a un usuario
// ============================================
const Campaign = require("./models/Campaign");

app.post("/assign-campaign/:psid", async (req, res) => {
  try {
    const { ref } = req.body;
    const psid = req.params.psid;

    const campaign = await Campaign.findOne({ ref });
    if (!campaign) {
      return res.status(404).json({ success: false, error: "Campaña no encontrada" });
    }

    // ✅ Asegura que la conversación existe
    let convo = await getConversation(psid);
    if (!convo) {
      convo = await updateConversation(psid, { psid, state: "active" });
    }

    // ✅ Vincula la campaña correctamente
    await updateConversation(psid, {
      campaignRef: ref,
      lastIntent: "campaign_entry",
      state: "active"
    });

    console.log(`✅ Campaña ${ref} asignada a ${psid}`);
    res.json({ success: true, message: `Campaña ${ref} asignada al usuario ${psid}` });
  } catch (err) {
    console.error("❌ Error al asignar campaña:", err);
    res.status(500).json({ success: false, error: "Error del servidor" });
  }
});

server.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
  console.log(`📡 Webhook endpoint: http://localhost:${PORT}/webhook`);
});
