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
const adSetsRoutes = require('./routes/adSetsRoutes');
const adsRoutes = require('./routes/adsRoutes');
const conversationsRoutes = require('./routes/conversationsRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const masterCatalogRoutes = require('./routes/masterCatalogRoutes');
const usosRoutes = require('./routes/usosRoutes');
const productFamilyRoutes = require('./routes/productFamilyRoutes');
const authRoutes = require('./routes/authRoutes');
const dashboardUsersRoutes = require('./routes/dashboardUsersRoutes');

// Auth routes (no prefix, will be /auth/login, /auth/me, etc.)
app.use('/auth', authRoutes);
app.use('/dashboard-users', dashboardUsersRoutes);

app.use('/products', productRoutes);
app.use('/campaigns', campaignRoutes);
app.use('/campaign-products', campaignProductRoutes);
app.use('/adsets', adSetsRoutes);
app.use('/ads', adsRoutes);
app.use('/conversations', conversationsRoutes);
app.use('/analytics', analyticsRoutes);
app.use('/master-catalog', masterCatalogRoutes);
app.use('/usos', usosRoutes);
app.use('/product-families', productFamilyRoutes);

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
async function saveMessage(psid, text, senderType, messageId = null) {
  // User messages start as unanswered, bot/human messages don't need the answered field
  const answered = senderType === 'user' ? false : undefined;

  // Build message object, omitting messageId if null (for sparse unique index to work)
  const messageData = { psid, text, senderType };
  if (messageId !== null && messageId !== undefined) {
    messageData.messageId = messageId;
  }
  if (answered !== undefined) {
    messageData.answered = answered;
  }

  const msg = await Message.create(messageData);

  // When bot or human responds, mark the most recent unanswered user message as answered
  if (senderType === 'bot' || senderType === 'human') {
    await Message.findOneAndUpdate(
      { psid, senderType: 'user', answered: { $ne: true } }, // Match false, undefined, or non-existent
      { answered: true },
      { sort: { timestamp: -1 } } // Get most recent unanswered message
    );
  }

  io.emit("new_message", msg); // <-- Notifica al dashboard
  return msg;
}

// Check if a message has already been processed (deduplication)
async function isMessageProcessed(messageId) {
  if (!messageId) return false;
  const existing = await Message.findOne({ messageId });
  return !!existing;
}

// ============================================
// Registrar usuario en base al PSID
// ============================================
async function registerUserIfNeeded(senderPsid) {
  const existing = await User.findOne({ psid: senderPsid });
  if (existing) {
    console.log(`👤 User already registered: ${existing.first_name || existing.psid}`);
    return;
  }

  console.log(`🔄 Attempting to register new user: ${senderPsid}`);

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
      ...userData,
      last_interaction: new Date()
    });

    console.log(`✅ Usuario registrado exitosamente: ${userData.first_name} ${userData.last_name} (PSID: ${senderPsid})`);
  } catch (err) {
    const errorCode = err.response?.data?.error?.code;
    const errorSubcode = err.response?.data?.error?.subcode;
    const errorMessage = err.response?.data?.error?.message || err.message;

    console.error(`❌ Error al registrar usuario ${senderPsid}:`);
    console.error(`   Error Code: ${errorCode || 'N/A'}`);
    console.error(`   Error Subcode: ${errorSubcode || 'N/A'}`);
    console.error(`   Message: ${errorMessage}`);

    // Still create a basic user record with just the PSID so dashboard doesn't break
    try {
      await User.create({
        psid: senderPsid,
        first_name: '',
        last_name: '',
        profile_pic: '',
        last_interaction: new Date()
      });
      console.log(`⚠️  Created basic user record for PSID: ${senderPsid} (no profile data available)`);
    } catch (createErr) {
      console.error(`❌ Failed to create even basic user record: ${createErr.message}`);
    }
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

// Ruta para obtener todos los usuarios con sus nombres
app.get("/users", async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || auth.trim() !== "Bearer hanlob_admin_2025") {
    return res.status(403).json({ success: false, error: "Unauthorized" });
  }

  try {
    // Get all unique PSIDs from messages
    const uniquePsids = await Message.distinct('psid');
    console.log(`📊 Found ${uniquePsids.length} unique PSIDs in messages`);

    // Get existing users from database
    const existingUsers = await User.find({ psid: { $in: uniquePsids } });
    const existingPsidSet = new Set(existingUsers.map(u => u.psid));

    // Just return existing users quickly (don't fetch from Facebook)
    // Missing users will be created lazily when they send messages
    res.json({ success: true, data: existingUsers });
  } catch (err) {
    console.error("❌ Error retrieving users:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// Manual endpoint to force-sync all missing user profiles from Facebook
app.post("/sync-users", async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || auth.trim() !== "Bearer hanlob_admin_2025") {
    return res.status(403).json({ success: false, error: "Unauthorized" });
  }

  try {
    console.log("🔄 Starting manual user sync...");

    // Get all unique PSIDs from messages
    const uniquePsids = await Message.distinct('psid');
    console.log(`📊 Found ${uniquePsids.length} unique PSIDs in messages:`, uniquePsids);

    // Get existing users from database
    const existingUsers = await User.find({ psid: { $in: uniquePsids } });
    const existingPsidSet = new Set(existingUsers.map(u => u.psid));
    console.log(`✅ Already have ${existingUsers.length} users in database`);

    // Find PSIDs that don't have user records
    const missingPsids = uniquePsids.filter(psid => !existingPsidSet.has(psid));
    console.log(`🔍 Need to fetch ${missingPsids.length} missing user profiles:`, missingPsids);

    if (missingPsids.length === 0) {
      return res.json({
        success: true,
        message: "All users already synced",
        totalUsers: existingUsers.length,
        fetchedCount: 0
      });
    }

    // Fetch missing users from Facebook Graph API
    const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN;
    const newUsers = [];
    const errors = [];

    for (const psid of missingPsids) {
      try {
        console.log(`📞 Fetching profile for PSID: ${psid}...`);
        const response = await axios.get(
          `https://graph.facebook.com/v18.0/${psid}`,
          {
            params: {
              fields: "first_name,last_name,profile_pic",
              access_token: FB_PAGE_TOKEN
            }
          }
        );

        const userData = {
          psid: psid,
          first_name: response.data.first_name || '',
          last_name: response.data.last_name || '',
          profile_pic: response.data.profile_pic || '',
          last_interaction: new Date()
        };

        // Save to database
        await User.create(userData);
        newUsers.push(userData);
        console.log(`✅ Fetched and saved user: ${userData.first_name} ${userData.last_name} (${psid})`);
      } catch (err) {
        const errorMsg = err.response?.data?.error?.message || err.message;
        console.error(`❌ Error fetching user ${psid}:`, errorMsg);
        errors.push({ psid, error: errorMsg });
      }
    }

    console.log(`✅ Sync complete! Fetched ${newUsers.length} new users`);

    res.json({
      success: true,
      message: `Successfully synced ${newUsers.length} users`,
      totalUsers: existingUsers.length + newUsers.length,
      fetchedCount: newUsers.length,
      newUsers: newUsers,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (err) {
    console.error("❌ Error syncing users:", err);
    res.status(500).json({ success: false, error: "Server error", details: err.message });
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
      handoffRequested: convo?.handoffRequested || false,
      handoffReason: convo?.handoffReason || null,
      handoffTimestamp: convo?.handoffTimestamp || null,
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
        const messageId = webhookEvent.message.mid; // Facebook message ID
        const FB_PAGE_ID = process.env.FB_PAGE_ID;

        // 🔍 DEBUG: Log all webhook event details for debugging human agent detection
        console.log(`\n🔍 WEBHOOK DEBUG:`);
        console.log(`   senderPsid: ${senderPsid}`);
        console.log(`   messageId: ${messageId}`);
        console.log(`   FB_PAGE_ID: ${FB_PAGE_ID}`);
        console.log(`   recipientId: ${webhookEvent.recipient?.id}`);
        console.log(`   messageText: "${messageText}"`);
        console.log(`   Match? ${senderPsid === FB_PAGE_ID ? '✅ YES (HUMAN AGENT)' : '❌ NO (USER)'}\n`);

        // 🚫 DEDUPLICATION: Check if this message has already been processed
        if (await isMessageProcessed(messageId)) {
          console.log(`⚠️ Duplicate webhook detected for message ${messageId}, skipping processing`);
          res.sendStatus(200);
          return;
        }

        // 🧑‍💼 Detect if message is from Page (human agent) or from User
        const isFromPage = senderPsid === FB_PAGE_ID;
        const recipientPsid = isFromPage ? webhookEvent.recipient.id : senderPsid;

        if (isFromPage) {
          // Message from human agent - mark conversation as human_active and don't respond
          console.log(`👨‍💼 Human agent message detected for user ${recipientPsid}: "${messageText}"`);

          // Cancel any pending debounced messages for this user
          const { cancelDebounce } = require("./messageDebouncer");
          cancelDebounce(recipientPsid);

          await saveMessage(recipientPsid, messageText, "human", messageId);
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
            await saveMessage(senderPsid, messageText, "user", messageId);
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

          await saveMessage(senderPsid, messageText || "[image]", "user", messageId);
          res.sendStatus(200);
          return;
        }

        // 🎯 Check if the ad associated with this conversation is active
        const conversation = await getConversation(senderPsid);
        if (conversation && conversation.adId) {
          const Ad = require("./models/Ad");
          const ad = await Ad.findOne({ fbAdId: conversation.adId });

          if (ad) {
            if (ad.status !== "ACTIVE") {
              console.log(`🚫 Ad ${conversation.adId} is ${ad.status}. Bot will not respond to ${senderPsid}.`);
              await saveMessage(senderPsid, messageText || "[image]", "user", messageId);
              res.sendStatus(200);
              return;
            }
            console.log(`✅ Ad ${conversation.adId} is ACTIVE. Bot will respond.`);
          } else {
            console.log(`⚠️ Ad ID ${conversation.adId} found in conversation but not in database. Allowing bot response.`);
          }
        }

        // 📸 Check for attachments (images, stickers, etc.)
        const attachments = webhookEvent.message.attachments;
        if (attachments && attachments.length > 0) {
          // Check for stickers first (thumbs up, reactions, etc.)
          const stickerAttachment = attachments.find(att => att.type === "image" && att.payload?.sticker_id);

          if (stickerAttachment) {
            console.log(`👍 Sticker/reaction received (ID: ${stickerAttachment.payload.sticker_id})`);
            await registerUserIfNeeded(senderPsid);
            await saveMessage(senderPsid, "[Reacción enviada]", "user", messageId);

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
            await saveMessage(senderPsid, `[Imagen enviada: ${imageUrl}]`, "user", messageId);

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
        await saveMessage(senderPsid, messageText, "user", messageId);

        // Use message debouncer to wait for user to finish typing
        const { debounceMessage } = require("./messageDebouncer");

        debounceMessage(senderPsid, messageText, async (combinedMessage) => {
          try {
            console.log(`\n🔍 [DEBUG] Debounce callback fired for PSID: ${senderPsid}`);
            console.log(`🤖 Generating reply for combined message: "${combinedMessage}"`);
            const reply = await generateReply(combinedMessage, senderPsid);
            console.log(`🔍 [DEBUG] generateReply returned:`, reply ? `type=${reply.type}, hasText=${!!reply.text}, hasImage=${!!reply.imageUrl}` : 'NULL');

            // 🧩 Nuevo control de seguridad: si no hay respuesta, salimos
            if (!reply) {
              console.log("⚠️ generateReply devolvió null, no se envía mensaje.");
              return;
            }

            // 🧩 Segundo filtro: si no hay texto ni imagen, no enviar nada
            const hasText = reply.text && reply.text.trim() !== "";
            const hasImage = reply.imageUrl && reply.imageUrl.trim() !== "";
            console.log(`🔍 [DEBUG] hasText=${hasText}, hasImage=${hasImage}`);

            if (!hasText && !hasImage) {
              console.log("⚠️ Respuesta vacía o sin contenido válido, no se envía.");
              return;
            }

            // Enviar imagen si existe
            if (reply.type === "image" && hasImage) {
              console.log(`🔍 [DEBUG] Sending image to FB API...`);
              await callSendAPI(senderPsid, {
                attachment: {
                  type: "image",
                  payload: { url: reply.imageUrl, is_reusable: true }
                }
              });
              console.log(`✅ [DEBUG] Image sent successfully`);
            }

            // Enviar texto si existe
            if (hasText) {
              console.log(`🔍 [DEBUG] Sending text to FB API: "${reply.text.substring(0, 50)}..."`);
              await callSendAPI(senderPsid, { text: reply.text });
              console.log(`✅ [DEBUG] Text sent to FB successfully`);

              console.log(`🔍 [DEBUG] Calling saveMessage for bot response...`);
              const savedMsg = await saveMessage(senderPsid, reply.text, "bot");
              console.log(`✅ [DEBUG] Bot message saved! ID: ${savedMsg._id}`);
            }

          } catch (err) {
            console.error("❌ Error al responder con IA:", err);
            console.error("❌ Stack trace:", err.stack);
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

// Obtener una conversación específica (con todos los mensajes)
app.get("/conversations/:psid", async (req, res) => {
  try {
    const Message = require('./models/Message');
    const messages = await Message.find({ psid: req.params.psid })
      .sort({ timestamp: 1 })  // Ascending order (oldest first)
      .lean();

    if (!messages || messages.length === 0) {
      return res.status(404).json({ success: false, error: "No messages found for this conversation" });
    }

    res.json(messages);  // Return array directly (frontend expects this format)
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
