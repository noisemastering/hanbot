// Load environment variables from .env file
require('dotenv').config();
const Message = require('./models/Message');


const { generateReply } = require('./ai/index');
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

// Track recently processed referrals to dedup Facebook's duplicate webhooks
const recentReferrals = new Map();
setInterval(() => {
  const cutoff = Date.now() - 60000;
  for (const [key, time] of recentReferrals) {
    if (time < cutoff) recentReferrals.delete(key);
  }
}, 60000);

const app = express();
const PORT = process.env.PORT || 3000;


const mongoose = require('mongoose');
const User = require("./models/User");


mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('✅ Connected to MongoDB Atlas');

    // Fix User index to be sparse (allows WhatsApp users without psid)
    try {
      const db = mongoose.connection.db;
      const indexes = await db.collection('users').indexes();
      const psidIndex = indexes.find(i => i.name === 'psid_1');

      if (psidIndex && !psidIndex.sparse) {
        console.log('🔧 Fixing non-sparse psid index...');
        await db.collection('users').dropIndex('psid_1');
        await db.collection('users').createIndex({ psid: 1 }, { unique: true, sparse: true });
        console.log('✅ Fixed psid index (now sparse)');
      }
    } catch (err) {
      // Index might not exist or already fixed
      console.log('ℹ️ Index check:', err.message);
    }
  })
  .catch(err => console.error('❌ MongoDB connection error:', err));

// --- CORS CONFIG (MUST BE BEFORE ROUTES) ---
const cors = require("cors");

// CORS configuration
const corsOptions = {
  origin: function(origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);

    const allowedOrigins = [
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:3002",
      "https://dashboard.hanlob.com.mx",
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
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  exposedHeaders: ["Content-Type", "Authorization"]
};

app.use(cors(corsOptions));

// Asegura respuesta correcta a preflight requests (CORS)
app.options(/.*/, cors(corsOptions));

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
const gruposRoutes = require('./routes/gruposRoutes');
const productFamilyRoutes = require('./routes/productFamilyRoutes');
const pointsOfSaleRoutes = require('./routes/pointsOfSaleRoutes');
const authRoutes = require('./routes/authRoutes');
const dashboardUsersRoutes = require('./routes/dashboardUsersRoutes');
const rolesRoutes = require('./routes/rolesRoutes');
const profilesRoutes = require('./routes/profilesRoutes');
const clickLogsRoutes = require('./routes/clickLogsRoutes');
const pushRoutes = require('./routes/pushRoutes');
const usersRoutes = require('./routes/usersRoutes');
const mercadoLibreAuthRoutes = require('./routes/mercadoLibreAuthRoutes');
const mercadoLibreOrdersRoutes = require('./routes/mercadoLibreOrdersRoutes');
const mercadoLibreNotificationsRoutes = require('./routes/mercadoLibreNotificationsRoutes');
const healthRoutes = require('./routes/healthRoutes');
const intentsRoutes = require('./routes/intentsRoutes');
const intentCategoriesRoutes = require('./routes/intentCategoriesRoutes');
const flowsRoutes = require('./routes/flowsRoutes');
const uploadsRoutes = require('./routes/uploadsRoutes');

// Auth routes (no prefix, will be /auth/login, /auth/me, etc.)
app.use('/auth', authRoutes);
app.use('/push', pushRoutes);
app.use('/dashboard-users', dashboardUsersRoutes);
app.use('/roles', rolesRoutes);
app.use('/profiles', profilesRoutes);
app.use('/click-logs', clickLogsRoutes);
app.use('/ml', mercadoLibreAuthRoutes);
app.use('/ml', mercadoLibreOrdersRoutes);
app.use('/ml', mercadoLibreNotificationsRoutes);
app.use('/health', healthRoutes);

app.use('/products', productRoutes);
app.use('/campaigns', campaignRoutes);
app.use('/campaign-products', campaignProductRoutes);
app.use('/adsets', adSetsRoutes);
app.use('/ads', adsRoutes);
app.use('/conversations', conversationsRoutes);
app.use('/users', usersRoutes);
app.use('/analytics', analyticsRoutes);
app.use('/master-catalog', masterCatalogRoutes);
app.use('/usos', usosRoutes);
app.use('/grupos', gruposRoutes);
app.use('/product-families', productFamilyRoutes);
app.use('/points-of-sale', pointsOfSaleRoutes);
app.use('/intents', intentsRoutes);
app.use('/intent-categories', intentCategoriesRoutes);
app.use('/flows', flowsRoutes);
app.use('/uploads', uploadsRoutes);

// ============================================
// Global Error Handler (returns JSON, not HTML)
// ============================================
const multer = require('multer');

app.use((err, req, res, next) => {
  console.error('❌ Global error handler:', err.message);

  // Handle multer errors (file upload issues)
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, error: 'File too large. Maximum size is 10MB.' });
    }
    return res.status(400).json({ success: false, error: `Upload error: ${err.message}` });
  }

  // Handle CORS errors
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ success: false, error: 'CORS not allowed for this origin' });
  }

  // Generic error
  res.status(500).json({ success: false, error: err.message || 'Internal server error' });
});

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


// Bot persona names for comment replies
const commentBotNames = ["Paula", "Sofía", "Camila", "Valeria", "Daniela"];

// KILLSWITCH: Set FB_COMMENT_AUTO_REPLY=true in env to enable comment auto-replies
function isCommentAutoReplyEnabled() {
  const setting = process.env.FB_COMMENT_AUTO_REPLY;
  // DISABLED by default, set to 'true' to enable
  return setting === 'true' || setting === '1';
}

// KILLSWITCH: Set FB_SHIPPING_AUTO_REPLY=false to disable shipping-specific replies only
// When disabled, shipping questions still get the general reply
function isShippingAutoReplyEnabled() {
  const setting = process.env.FB_SHIPPING_AUTO_REPLY;
  // Enabled by default, set to 'false' to disable
  return setting !== 'false' && setting !== '0';
}

// Detect if a comment is specifically about SHIPPING (high confidence only)
function isShippingQuestion(text) {
  if (!text) return false;
  const lowerText = text.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Remove accents for matching
    .trim();

  // High-confidence shipping patterns
  const shippingPatterns = [
    /\benvios?\b/,                    // envío, envíos, envio, envios
    /\benvian\b/,                     // envían, envian
    /\bmandan\b/,                     // mandan
    /\bflete\b/,                      // flete
    /\bpaqueteria\b/,                 // paquetería
    /\ba domicilio\b/,                // a domicilio
    /\bhacen envio/,                  // hacen envío
    /\bllega a\b/,                    // llega a [location]
    /\bllegan a\b/,                   // llegan a [location]
    /\bentregan\b/,                   // entregan
    /\bcosto.{0,5}envio/,             // costo de envío, costo del envio
    /\benvio.{0,10}(gratis|incluido)/ // envío gratis, envío incluido
  ];

  for (const pattern of shippingPatterns) {
    if (pattern.test(lowerText)) return true;
  }

  return false;
}

// Detect if a comment is a general question (for non-shipping auto-reply)
function isQuestion(text) {
  if (!text) return false;
  const lowerText = text.toLowerCase().trim();

  // Contains question mark
  if (lowerText.includes('?')) return true;

  // Common Spanish question starters
  const questionWords = [
    'cuánto', 'cuanto', 'cómo', 'como', 'dónde', 'donde', 'cuál', 'cual',
    'qué', 'que', 'quién', 'quien', 'por qué', 'porqué', 'porque',
    'tienen', 'tienes', 'hay', 'puedo', 'pueden', 'puedes',
    'cuestan', 'cuesta', 'vale', 'valen', 'precio', 'precios',
    'hacen', 'haces', 'manejan', 'manejas', 'venden', 'vendes',
    'envían', 'envias', 'envian', 'mandan', 'llegan',
    'sirve', 'funciona', 'es para', 'son para'
  ];

  for (const word of questionWords) {
    if (lowerText.includes(word)) return true;
  }

  return false;
}

// Reply to a Facebook comment
async function replyToComment(commentId, message) {
  const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN;

  try {
    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${commentId}/comments`,
      { message },
      {
        headers: {
          Authorization: `Bearer ${FB_PAGE_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log(`✅ Auto-replied to comment ${commentId}:`, response.data);
    return { success: true, data: response.data };
  } catch (error) {
    console.error(`❌ Error replying to comment ${commentId}:`, error.response?.data || error.message);
    return { success: false, error: error.response?.data || error.message };
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
              fields: "first_name,last_name,profile_pic,locale,timezone",
              access_token: FB_PAGE_TOKEN
            }
          }
        );

        const userData = {
          psid: psid,
          first_name: response.data.first_name || '',
          last_name: response.data.last_name || '',
          profile_pic: response.data.profile_pic || '',
          locale: response.data.locale || null,
          timezone: response.data.timezone || null,
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

// Helper function to validate authentication (supports both hardcoded token and JWT)
const validateAuth = async (auth) => {
  if (!auth) return false;

  // Check hardcoded token first (backward compatibility)
  if (auth.trim() === "Bearer hanlob_admin_2025") {
    return true;
  }

  // Check JWT token
  try {
    const token = auth.replace("Bearer ", "");
    const jwt = require("jsonwebtoken");
    const JWT_SECRET = process.env.JWT_SECRET || "your-super-secret-jwt-key-change-in-production";
    const decoded = jwt.verify(token, JWT_SECRET);

    // Optionally verify user exists and is active
    const DashboardUser = require("./models/DashboardUser");
    const user = await DashboardUser.findById(decoded.id);
    return user && user.active;
  } catch (err) {
    return false;
  }
};

// 👨‍💼 API: Manual human takeover
app.post("/api/conversation/:psid/takeover", async (req, res) => {
  // Authentication check
  const auth = req.headers.authorization;
  if (!await validateAuth(auth)) {
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
  if (!await validateAuth(auth)) {
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
  if (!await validateAuth(auth)) {
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
      purchaseIntent: convo?.purchaseIntent || null,
      timestamp: new Date()
    });
  } catch (error) {
    console.error("❌ Error checking conversation status:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /health - Simple health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: Date.now() });
});

// GET /r/:clickId - Click tracking redirect
app.get("/r/:clickId", async (req, res) => {
  try {
    const { clickId } = req.params;
    const { recordClick, getClickData } = require('./tracking');

    // Get click data
    const clickLog = await getClickData(clickId);

    if (!clickLog) {
      return res.status(404).send("Link not found");
    }

    // Filter out bot/crawler user agents (Facebook link preview, WhatsApp, etc.)
    const userAgent = req.get('user-agent') || '';
    const isCrawler = /facebookexternalhit|Facebot|facebookcatalog|WhatsApp|Twitterbot|Slackbot|LinkedInBot|Googlebot|bingbot|Pinterestbot/i.test(userAgent);

    if (isCrawler) {
      console.log(`🤖 Crawler detected for ${clickId}, skipping click record (UA: ${userAgent.slice(0, 50)})`);
    } else {
      // Record the click with metadata (real user only)
      await recordClick(clickId, {
        userAgent,
        ipAddress: req.ip || req.connection.remoteAddress,
        referrer: req.get('referrer')
      });
      console.log(`📊 Click tracked: ${clickId} -> ${clickLog.originalUrl}`);
    }

    // Always redirect regardless
    res.redirect(302, clickLog.originalUrl);
  } catch (error) {
    console.error("❌ Error processing click:", error);
    res.status(500).send("Error processing redirect");
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

  // 🔍 DEBUG: Log raw webhook payload to diagnose missing referrals
  console.log("📥 WEBHOOK RAW:", JSON.stringify(body, null, 2).slice(0, 1500));

  if (body.object === "page") {
    for (const entry of body.entry) {
      // Handle feed/changes (posts, comments) - separate from messaging
      if (entry.changes) {
        console.log("📰 PAGE FEED EVENT:", JSON.stringify(entry.changes, null, 2).slice(0, 1000));

        for (const change of entry.changes) {
          // Track comments on posts for context when user messages
          if (change.field === 'feed' && change.value?.item === 'comment') {
            const { from, post_id, message, comment_id } = change.value;

            if (from?.id && post_id) {
              console.log(`💬 COMMENT DETECTED:`);
              console.log(`   User: ${from.name} (${from.id})`);
              console.log(`   Post: ${post_id}`);
              console.log(`   Comment: ${message?.slice(0, 100) || 'N/A'}`);

              // Store in cache for later correlation with messaging
              // Key: Facebook user ID, Value: post context
              const CommentContext = require('./models/CommentContext');
              try {
                await CommentContext.findOneAndUpdate(
                  { fbUserId: from.id },
                  {
                    fbUserId: from.id,
                    fbUserName: from.name,
                    postId: post_id,
                    commentId: comment_id,
                    commentText: message,
                    createdAt: new Date()
                  },
                  { upsert: true, new: true }
                );
                console.log(`   ✅ Stored comment context for user ${from.id}`);

                // Auto-reply to comments (with killswitch)
                if (comment_id && isCommentAutoReplyEnabled()) {
                  const operatorName = commentBotNames[Math.floor(Math.random() * commentBotNames.length)];
                  const { generateBotResponse } = require('./ai/responseGenerator');
                  let replyMessage = null;
                  let replyType = null;

                  // Check for shipping question first (high confidence) - has its own killswitch
                  if (isShippingAutoReplyEnabled() && isShippingQuestion(message)) {
                    replyMessage = await generateBotResponse("comment_reply_shipping", {
                      operatorName,
                      userComment: message
                    });
                    replyType = 'shipping';
                    console.log(`   📦 Shipping question detected, auto-replying...`);
                  }
                  // Fall back to general question detection
                  else if (isQuestion(message)) {
                    replyMessage = await generateBotResponse("comment_reply_general", {
                      operatorName,
                      userComment: message
                    });
                    replyType = 'general';
                    console.log(`   💬 General question detected, auto-replying...`);
                  }

                  if (replyMessage) {
                    const replyResult = await replyToComment(comment_id, replyMessage);
                    if (replyResult.success) {
                      console.log(`   ✅ Auto-reply sent (${replyType})`);
                    }
                  }
                } else if (comment_id && !isCommentAutoReplyEnabled()) {
                  console.log(`   ⏸️ Auto-reply disabled (FB_COMMENT_AUTO_REPLY=false)`);
                }
              } catch (err) {
                console.error(`   ❌ Failed to store comment context:`, err.message);
              }
            }
          }
        }

        // Feed events don't have messaging - skip to next entry
        continue;
      }

      if (!entry.messaging || !entry.messaging[0]) {
        console.log("⚠️ No messaging array in entry:", JSON.stringify(entry, null, 2).slice(0, 500));
        continue;
      }

      const webhookEvent = entry.messaging[0];
      const senderPsid = webhookEvent.sender.id;

      // 🔍 DEBUG: Log referral detection
      if (webhookEvent.referral) {
        console.log("🎯 REFERRAL FOUND (direct):", JSON.stringify(webhookEvent.referral));
      }
      if (webhookEvent.postback?.referral) {
        console.log("🎯 REFERRAL FOUND (postback):", JSON.stringify(webhookEvent.postback.referral));
      }


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

      // 📢 MESSAGE ECHO: Page sent a message (through native inbox or API)
      // This detects when a human replies through Facebook's native Page Inbox
      if (webhookEvent.message?.is_echo) {
        const recipientPsid = webhookEvent.recipient.id;
        const messageText = webhookEvent.message.text || '[attachment]';
        const appId = webhookEvent.message.app_id;

        console.log(`📢 MESSAGE ECHO detected:`);
        console.log(`   Recipient: ${recipientPsid}`);
        console.log(`   Text: ${messageText.slice(0, 100)}`);
        console.log(`   App ID: ${appId || 'native inbox'}`);

        // If no app_id, it was sent through Facebook's native Page Inbox (human agent)
        // If app_id matches our bot, it's our own message (ignore)
        const isFromBot = appId === process.env.FB_APP_ID;

        if (!isFromBot) {
          console.log(`👨‍💼 Human agent message detected via echo - marking conversation as human_active`);

          // Save as human message
          const Message = require('./models/Message');
          await Message.create({
            psid: recipientPsid,
            text: messageText,
            senderType: 'human',
            timestamp: new Date()
          });

          // Update conversation state
          await updateConversation(recipientPsid, {
            state: 'human_active',
            agentTookOverAt: new Date(),
            lastMessageAt: new Date()
          });

          // Emit to dashboard
          io.emit("humanMessage", {
            psid: recipientPsid,
            text: messageText,
            timestamp: new Date()
          });
        }

        res.sendStatus(200);
        return;
      }

      // 🧩 BLOQUE NUEVO: detección de campañas o enlaces con ?ref=
      const referral = webhookEvent.referral || webhookEvent.postback?.referral;
      let adGreetingSent = false;
      if (referral) {
        // Dedup: skip if we already processed a referral for this user in the last 30s
        const referralKey = `${senderPsid}:${referral.ad_id || referral.ref || 'unknown'}`;
        const now = Date.now();
        const isDuplicateReferral = recentReferrals.has(referralKey) && (now - recentReferrals.get(referralKey)) < 30000;

        if (isDuplicateReferral) {
          console.log(`⚠️ Duplicate referral for ${senderPsid}, skipping`);
        } else {
          recentReferrals.set(referralKey, now);

        console.log("🧭 Usuario llegó desde una campaña o enlace promocional:");
        console.log("  Ref:", referral.ref);
        console.log("  Ad ID:", referral.ad_id);
        console.log("  Campaign ID:", referral.campaign_id);

        // Guardamos datos de campaña en la conversación (sin tocar tu modelo User)
        // Also reset state to active — user re-engaged by clicking an ad,
        // so any previous needs_human / human_active state is stale
        await updateConversation(senderPsid, {
          state: "active",
          lastIntent: "ad_entry",
          campaignRef: referral.ref || null,
          adId: referral.ad_id || null,
          campaignId: referral.campaign_id || null,
          agentTookOverAt: null,
          productSpecs: null,
        });

        // 🔍 Look up ad with inheritance (Campaign → AdSet → Ad)
        let adProductInterest = null;
        let adGreeting = null;

        if (referral.ad_id) {
          const { resolveByAdId } = require("./utils/campaignResolver");
          const { getProductInterest } = require("./ai/utils/productEnricher");
          const ProductFamily = require("./models/ProductFamily");

          // Use campaign resolver for proper inheritance
          const resolvedSettings = await resolveByAdId(referral.ad_id);

          // Dynamic borde greeting from DB
          const { getAvailableLengths: getBordeLengthsForGreeting, getBordeWidth: getBordeWidthForGreeting } = require("./ai/flows/bordeFlow");
          let bordeLengthGreeting;
          try {
            const bordeLens = await getBordeLengthsForGreeting({}, {});
            const bordeW = await getBordeWidthForGreeting();
            const lenList = bordeLens.map(l => `${l}m`).join(', ');
            bordeLengthGreeting = `🌱 ¡Hola! Te cuento sobre nuestros *bordes para jardín* (${bordeW}cm de ancho). Tenemos rollos de ${lenList}. ¿Qué largo necesitas?`;
          } catch (e) {
            bordeLengthGreeting = "🌱 ¡Hola! Te cuento sobre nuestros *bordes para jardín*. ¿Qué largo necesitas?";
          }

          // Set greeting based on product interest
          const greetings = {
            'borde_separador': bordeLengthGreeting,
            'cinta_rompevientos': "🌬️ ¡Hola! Veo que te interesa nuestra *cinta rompevientos*. ¿Te gustaría conocer medidas y precios?",
            'cinta_rigida': "🌿 ¡Hola! Te cuento sobre nuestra *cinta rígida para jardín*. ¿Qué medida necesitas?",
            'malla_sombra': "👋 ¡Hola! Soy Paula de Hanlob. Veo que te interesa la *malla sombra* 🌿 ¿Deseas ver precios o medidas?",
            'malla_sombra_raschel': "👋 ¡Hola! Soy Paula de Hanlob. Veo que te interesa la *malla sombra* 🌿 ¿Deseas ver precios o medidas?",
            'malla_sombra_raschel_agricola': "🌾 ¡Hola! Veo que te interesa nuestra *malla sombra agrícola*. ¿Qué porcentaje de sombra necesitas?",
            'ground_cover': "🌱 ¡Hola! Veo que te interesa nuestro *ground cover antimaleza*. ¿Te gustaría conocer medidas disponibles?",
            'monofilamento': "🎣 ¡Hola! Veo que te interesa nuestra *malla monofilamento*. ¿Te gustaría conocer precios y medidas?",
            'antigranizo': "🌨️ ¡Hola! Veo que te interesa nuestra *malla antigranizo*. ¿Qué medidas necesitas?",
            'antiafido': "🐛 ¡Hola! Veo que te interesa nuestra *malla antiáfido*. ¿Te gustaría conocer especificaciones?",
            'herrajes': "🔧 ¡Hola! Veo que te interesan nuestros *herrajes y kits de instalación*. ¿Qué necesitas?",
            'sujetadores': "📎 ¡Hola! Veo que te interesan nuestros *sujetadores plásticos*. ¿Cuántos necesitas?"
          };

          if (resolvedSettings && resolvedSettings.productIds && resolvedSettings.productIds.length > 0) {
            // Get product from inherited productIds (Campaign → AdSet → Ad)
            const productId = resolvedSettings.mainProductId || resolvedSettings.productIds[0];
            const product = await ProductFamily.findById(productId).lean();

            if (product) {
              adProductInterest = await getProductInterest(product);
              console.log(`📦 Ad ${referral.ad_id} - Resolved products from ${resolvedSettings.campaignName}`);
              console.log(`📦 Using: ${product.name} → productInterest: ${adProductInterest}`);
              adGreeting = greetings[adProductInterest] || "👋 ¡Hola! Gracias por contactarnos. ¿En qué producto te puedo ayudar?";
            }
          } else if (resolvedSettings) {
            // No products but we have settings - infer from campaign name
            const campaignName = (resolvedSettings.campaignName || '').toLowerCase();
            console.log(`🔍 Ad ${referral.ad_id} has no linked products, inferring from campaign: "${resolvedSettings.campaignName}"`);

            if (campaignName.includes('malla') || campaignName.includes('sombra') || campaignName.includes('confeccionada') || campaignName.includes('raschel')) {
              adProductInterest = 'malla_sombra';
              adGreeting = greetings['malla_sombra'];
              console.log(`📦 Inferred productInterest: malla_sombra from campaign name`);
            } else if (campaignName.includes('borde') || campaignName.includes('jardin') || campaignName.includes('jardín')) {
              adProductInterest = 'borde_separador';
              adGreeting = greetings['borde_separador'];
              console.log(`📦 Inferred productInterest: borde_separador from campaign name`);
            } else if (campaignName.includes('ground') || campaignName.includes('cover') || campaignName.includes('maleza')) {
              adProductInterest = 'ground_cover';
              adGreeting = greetings['ground_cover'];
              console.log(`📦 Inferred productInterest: ground_cover from campaign name`);
            }
          } else {
            console.log(`⚠️ Ad ${referral.ad_id} not found in database`);
          }
        }

        // Fallback to ref-based detection if no ad products found
        if (!adProductInterest && referral.ref) {
          const refLower = referral.ref.toLowerCase();
          if (refLower.includes('borde') || refLower.includes('separador') || refLower.includes('jardin')) {
            adProductInterest = 'borde_separador';
            adGreeting = bordeLengthGreeting;
          } else if (refLower.includes('malla') || refLower.includes('sombra')) {
            adProductInterest = 'malla_sombra';
            adGreeting = "👋 ¡Hola! Soy Camila de Hanlob. Veo que te interesa la *malla sombra beige* 🌿 ¿Deseas ver precios o medidas?";
          }
        }

        // Set product interest and send greeting
        if (adProductInterest) {
          await updateConversation(senderPsid, { productInterest: adProductInterest, currentFlow: adProductInterest, greeted: true, lastGreetTime: Date.now() });
          await callSendAPI(senderPsid, { text: adGreeting });
          adGreetingSent = true;
        } else if (referral.ad_id) {
          // Ad click but couldn't determine product - generic greeting
          console.log(`⚠️ Could not determine product for ad_id: ${referral.ad_id}`);
          await updateConversation(senderPsid, { greeted: true, lastGreetTime: Date.now() });
          await callSendAPI(senderPsid, {
            text: "👋 ¡Hola! Gracias por contactarnos. ¿En qué producto te puedo ayudar?",
          });
          adGreetingSent = true;
        }
        } // close isDuplicateReferral else
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

        // 💬 COMMENT CONTEXT: If no referral, check if user recently commented on a post
        if (conversation && !conversation.adId && !conversation.campaignRef && messageText) {
          try {
            const CommentContext = require('./models/CommentContext');

            // Try to match by comment text (first message often IS the comment)
            const commentContext = await CommentContext.findOne({
              commentText: { $regex: messageText.slice(0, 50).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' }
            }).sort({ createdAt: -1 }).lean();

            if (commentContext) {
              console.log(`💬 COMMENT MATCH FOUND!`);
              console.log(`   Post ID: ${commentContext.postId}`);
              console.log(`   Original comment: ${commentContext.commentText?.slice(0, 50)}`);

              // Infer product from post mapping or comment text
              const postId = commentContext.postId || '';
              let inferredProduct = null;

              // First, check if we have a post mapping
              const PostMapping = require('./models/PostMapping');
              const postMapping = await PostMapping.findOne({ postId }).lean();

              if (postMapping?.productInterest) {
                inferredProduct = postMapping.productInterest;
                console.log(`   📍 Found post mapping: ${inferredProduct}`);
              } else {
                // Fallback: infer from comment text keywords
                const commentLower = (commentContext.commentText || '').toLowerCase();
                if (/malla.*sombra|rollo|raschel|sombra|metro/i.test(commentLower)) {
                  inferredProduct = 'malla_sombra';
                } else if (/borde|jard[ií]n|separador/i.test(commentLower)) {
                  inferredProduct = 'borde_separador';
                } else if (/ground.*cover|antimaleza/i.test(commentLower)) {
                  inferredProduct = 'ground_cover';
                }
              }

              // Update conversation with inferred context
              await updateConversation(senderPsid, {
                productInterest: inferredProduct,
                source: {
                  type: 'comment',
                  postId: commentContext.postId,
                  commentId: commentContext.commentId
                }
              });

              // Link the PSID back to comment context for future reference
              await CommentContext.updateOne(
                { _id: commentContext._id },
                { linkedPsid: senderPsid }
              );

              console.log(`   ✅ Linked to PSID ${senderPsid}, inferred product: ${inferredProduct || 'unknown'}`);
            }
          } catch (err) {
            console.error(`❌ Comment context lookup failed:`, err.message);
          }
        }

        // 📊 Log campaign source for this message
        if (conversation) {
          const campaignInfo = [];
          if (conversation.campaignRef) campaignInfo.push(`ref=${conversation.campaignRef}`);
          if (conversation.campaignId) campaignInfo.push(`campaign=${conversation.campaignId}`);
          if (conversation.adId) campaignInfo.push(`ad=${conversation.adId}`);
          if (campaignInfo.length > 0) {
            console.log(`📊 Campaign source: ${campaignInfo.join(', ')}`);
          }
        }

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

                // Check if we need to hand off to human
                if (reply.needsHandoff) {
                  const convo = await Conversation.findOne({ psid: senderPsid });
                  await updateConversation(senderPsid, {
                    lastIntent: "human_handoff",
                    state: "needs_human"
                  });
                  sendHandoffNotification(senderPsid, convo, reply.handoffReason || "Imagen requiere atención humana").catch(err => {
                    console.error("❌ Failed to send push notification:", err);
                  });
                } else {
                  // Update conversation intent
                  await updateConversation(senderPsid, {
                    lastIntent: "image_received",
                    state: "active"
                  });
                }
              } catch (error) {
                console.error("❌ Error processing image:", error);

                // Check if we're in business hours
                const now = new Date();
                const mexicoTime = new Date(now.toLocaleString("en-US", { timeZone: "America/Mexico_City" }));
                const day = mexicoTime.getDay();
                const hour = mexicoTime.getHours();
                const isWeekday = day >= 1 && day <= 5;
                const isDuringHours = hour >= 9 && hour < 18;
                const inBusinessHours = isWeekday && isDuringHours;

                // Cancel any pending debounced messages
                const { cancelDebounce } = require("./messageDebouncer");
                cancelDebounce(senderPsid);

                if (inBusinessHours) {
                  // During business hours: silently hand over to human
                  await updateConversation(senderPsid, {
                    state: "human_active",
                    lastIntent: "image_handoff",
                    handoffRequested: true,
                    handoffReason: "Bot no pudo analizar imagen enviada por usuario",
                    handoffTimestamp: new Date()
                  });

                  // Send push notification to agents
                  const { sendHandoffNotification } = require("./services/pushNotifications");
                  const imgConvo = await Conversation.findOne({ psid: senderPsid });
                  await sendHandoffNotification(senderPsid, imgConvo, "Usuario envió imagen que requiere atención humana");

                  // Let user know an agent will help
                  const { getBusinessInfo } = require("./businessInfoManager");
                  const businessInfo = await getBusinessInfo();
                  await callSendAPI(senderPsid, {
                    text: `Gracias por tu imagen. Un especialista la revisará y te responderá en breve.\n\nSi es urgente, puedes contactarnos:\n📞 ${businessInfo.phones?.join(" / ") || "55 1234 5678"}\n🕓 ${businessInfo.hours || "Lun-Vie 9am-6pm"}`
                  });
                  await saveMessage(senderPsid, "[Imagen transferida a especialista humano]", "bot");
                } else {
                  // Outside business hours: let user know it will be addressed during business hours
                  const { getBusinessInfo } = require("./businessInfoManager");
                  const businessInfo = await getBusinessInfo();
                  await callSendAPI(senderPsid, {
                    text: `Gracias por tu imagen. En este momento estamos fuera de horario, pero un especialista la revisará y te contactará en horario de atención.\n\n🕓 ${businessInfo.hours || "Lun-Vie 9am-6pm"}\n📞 ${businessInfo.phones?.join(" / ") || "55 1234 5678"}`
                  });
                  await saveMessage(senderPsid, "[Imagen recibida fuera de horario - pendiente de revisión]", "bot");

                  // Mark for follow-up
                  await updateConversation(senderPsid, {
                    lastIntent: "image_pending_review",
                    handoffRequested: true,
                    handoffReason: "Imagen recibida fuera de horario laboral",
                    handoffTimestamp: new Date()
                  });
                }
              }
            })();

            res.sendStatus(200);
            return;
          }

          // 🎤 Check for audio/voice messages
          const audioAttachment = attachments.find(att => att.type === "audio");

          if (audioAttachment) {
            const audioUrl = audioAttachment.payload.url;
            console.log(`🎤 Audio message received from ${senderPsid}: ${audioUrl}`);

            await registerUserIfNeeded(senderPsid);

            (async () => {
              try {
                const { transcribeAudio } = require("./ai/core/audioTranscriber");
                const { OpenAI } = require("openai");
                const openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

                const result = await transcribeAudio(audioUrl, openai);

                if (!result.success || !result.transcription?.trim()) {
                  await saveMessage(senderPsid, "[Audio no reconocido]", "user", messageId);
                  await callSendAPI(senderPsid, { text: "No pude entender tu audio, ¿me lo podrías escribir por favor?" });
                  await saveMessage(senderPsid, "No pude entender tu audio, ¿me lo podrías escribir por favor?", "bot");
                  return;
                }

                const transcription = result.transcription.trim();
                console.log(`🎤 Transcription: "${transcription}"`);

                // Save transcribed text as user message
                await saveMessage(senderPsid, transcription, "user", messageId);

                // Process through normal pipeline (same as typed text)
                const { debounceMessage } = require("./messageDebouncer");
                debounceMessage(senderPsid, transcription, async (combinedMessage) => {
                  try {
                    const reply = await generateReply(combinedMessage, senderPsid);

                    if (!reply) return;
                    const hasText = reply.text && reply.text.trim() !== "";
                    const hasImage = reply.imageUrl && reply.imageUrl.trim() !== "";
                    if (!hasText && !hasImage) return;

                    if (reply.type === "image" && hasImage) {
                      await callSendAPI(senderPsid, {
                        attachment: { type: "image", payload: { url: reply.imageUrl, is_reusable: true } }
                      });
                    }
                    if (hasText) {
                      await callSendAPI(senderPsid, { text: reply.text });
                      await saveMessage(senderPsid, reply.text, "bot");
                    }
                    if (reply.followUp) {
                      await new Promise(resolve => setTimeout(resolve, 500));
                      await callSendAPI(senderPsid, { text: reply.followUp });
                      await saveMessage(senderPsid, reply.followUp, "bot");
                    }

                    const { scheduleFollowUpIfNeeded } = require('./jobs/silenceFollowUp');
                    const lastSentText = reply.followUp || reply.text;
                    scheduleFollowUpIfNeeded(senderPsid, lastSentText).catch(err =>
                      console.error("❌ Error scheduling silence follow-up:", err.message)
                    );
                  } catch (err) {
                    console.error("❌ Error responding to audio transcription:", err);
                  }
                });
              } catch (error) {
                console.error("❌ Error transcribing audio:", error);
                await saveMessage(senderPsid, "[Audio enviado]", "user", messageId);
                await callSendAPI(senderPsid, { text: "No pude procesar tu audio, ¿me lo podrías escribir?" });
                await saveMessage(senderPsid, "No pude procesar tu audio, ¿me lo podrías escribir?", "bot");
              }
            })();

            res.sendStatus(200);
            return;
          }

          // 🎬 Check for video attachments
          const videoAttachment = attachments.find(att => att.type === "video");

          if (videoAttachment) {
            console.log(`🎬 Video received from ${senderPsid}`);

            await registerUserIfNeeded(senderPsid);
            await saveMessage(senderPsid, "[Video enviado]", "user", messageId);

            // Respond friendly without analyzing - videos are usually just friendly shares
            const reply = "¡Gracias por compartir! 😊 ¿En qué puedo ayudarte con malla sombra?";
            await callSendAPI(senderPsid, { text: reply });
            await saveMessage(senderPsid, reply, "bot");

            await updateConversation(senderPsid, {
              lastIntent: "video_received",
              state: "active"
            });

            res.sendStatus(200);
            return;
          }

          // 🔗 Check for shared links/posts (ads, product links)
          const sharedAttachment = attachments.find(att =>
            att.type === "template" || att.type === "fallback"
          );

          if (sharedAttachment) {
            const sharedTitle =
              sharedAttachment.payload?.elements?.[0]?.title ||
              sharedAttachment.title ||
              null;
            const sharedUrl =
              sharedAttachment.payload?.elements?.[0]?.url ||
              sharedAttachment.payload?.url ||
              sharedAttachment.url ||
              null;

            console.log(`🔗 Shared link received from ${senderPsid}:`);
            console.log(`   Title: ${sharedTitle || 'N/A'}`);
            console.log(`   URL: ${sharedUrl || 'N/A'}`);

            const sharedContext = sharedTitle || sharedUrl || 'enlace compartido';
            const enrichedText = messageText
              ? `${messageText} [Compartió: ${sharedContext}]`
              : `[Compartió: ${sharedContext}]`;

            await registerUserIfNeeded(senderPsid);
            await saveMessage(senderPsid, enrichedText, "user", messageId);

            const { debounceMessage } = require("./messageDebouncer");
            debounceMessage(senderPsid, enrichedText, async (combinedMessage) => {
              try {
                const reply = await generateReply(combinedMessage, senderPsid);
                if (!reply || (!reply.text?.trim() && !reply.imageUrl?.trim())) return;

                if (reply.type === "image" && reply.imageUrl?.trim()) {
                  await callSendAPI(senderPsid, {
                    attachment: { type: "image", payload: { url: reply.imageUrl, is_reusable: true } }
                  });
                }
                if (reply.text?.trim()) {
                  await callSendAPI(senderPsid, { text: reply.text });
                  await saveMessage(senderPsid, reply.text, "bot");
                }
                if (reply.followUp) {
                  await new Promise(resolve => setTimeout(resolve, 500));
                  await callSendAPI(senderPsid, { text: reply.followUp });
                  await saveMessage(senderPsid, reply.followUp, "bot");
                }

                const { scheduleFollowUpIfNeeded } = require('./jobs/silenceFollowUp');
                const lastSentText = reply.followUp || reply.text;
                scheduleFollowUpIfNeeded(senderPsid, lastSentText).catch(err =>
                  console.error("❌ Error scheduling silence follow-up:", err.message)
                );
              } catch (err) {
                console.error("❌ Error responding to shared link:", err);
              }
            });

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

            // Send follow-up message if exists (e.g., video link as separate bubble)
            if (reply.followUp) {
              console.log(`🔍 [DEBUG] Sending follow-up message...`);
              await new Promise(resolve => setTimeout(resolve, 500)); // Small delay between messages
              await callSendAPI(senderPsid, { text: reply.followUp });
              await saveMessage(senderPsid, reply.followUp, "bot");
              console.log(`✅ [DEBUG] Follow-up message sent`);
            }

            // Schedule silence follow-up (store link after 10min of inactivity)
            const { scheduleFollowUpIfNeeded } = require('./jobs/silenceFollowUp');
            const lastSentText = reply.followUp || reply.text;
            scheduleFollowUpIfNeeded(senderPsid, lastSentText).catch(err =>
              console.error("❌ Error scheduling silence follow-up:", err.message)
            );

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
// 💬 WHATSAPP WEBHOOK ROUTES (NEW)
// ============================================
const { verifyWhatsAppWebhook, handleWhatsAppWebhook } = require('./channels/whatsapp/handler');

// GET /webhook/whatsapp - WhatsApp webhook verification
app.get("/webhook/whatsapp", verifyWhatsAppWebhook);

// POST /webhook/whatsapp - WhatsApp incoming messages
app.post("/webhook/whatsapp", (req, res) => {
  handleWhatsAppWebhook(req, res, io);
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

// ============================================
// STARTUP VALIDATION: Required Environment Variables
// ============================================
function validateRequiredEnvVars() {
  const required = [
    'ML_CLIENT_ID',
    'ML_CLIENT_SECRET',
    'ML_REDIRECT_URI'
  ];

  const missing = [];

  for (const varName of required) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }

  if (missing.length > 0) {
    console.error('❌ FATAL: Missing required Mercado Libre environment variables:');
    missing.forEach(v => console.error(`   - ${v}`));
    console.error('\nPlease add these to your .env file.');
    process.exit(1);
  }

  // Log configuration (without leaking secrets)
  console.log('✅ Mercado Libre OAuth Configuration:');
  console.log(`   ML_CLIENT_ID: ${process.env.ML_CLIENT_ID}`);
  console.log(`   ML_CLIENT_SECRET: ${process.env.ML_CLIENT_SECRET.length} chars`);
  console.log(`   ML_REDIRECT_URI: ${process.env.ML_REDIRECT_URI}`);
}

// Validate before starting server
validateRequiredEnvVars();

// ============================================
// BACKGROUND JOBS
// ============================================

// ML Price Sync - runs daily at 7pm Mexico City time
async function runMLPriceSync() {
  try {
    const { syncMLPrices } = require('./utils/mlPriceSync');
    console.log('🔄 [Scheduled] Starting ML price sync...');
    const results = await syncMLPrices();
    console.log(`✅ [Scheduled] ML price sync complete: ${results.synced} synced, ${results.errors} errors, ${results.skipped} skipped`);
  } catch (error) {
    console.error('❌ [Scheduled] ML price sync failed:', error.message);
  }
}

function scheduleMLPriceSync() {
  const now = new Date();
  // Get current time in Mexico City (America/Mexico_City)
  const mxTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
  const target = new Date(mxTime);
  target.setHours(19, 0, 0, 0); // 7:00 PM

  // If 7pm already passed today, schedule for tomorrow
  if (mxTime >= target) {
    target.setDate(target.getDate() + 1);
  }

  const msUntilTarget = target.getTime() - mxTime.getTime();
  const hoursUntil = (msUntilTarget / (1000 * 60 * 60)).toFixed(1);
  console.log(`⏰ ML price sync scheduled for 7:00 PM Mexico City (in ${hoursUntil}h)`);

  setTimeout(() => {
    runMLPriceSync();
    // After running, schedule next day (repeat daily)
    setInterval(runMLPriceSync, 24 * 60 * 60 * 1000);
  }, msUntilTarget);
}

// Start ML price sync scheduler after 1 minute (let server fully initialize)
setTimeout(scheduleMLPriceSync, 60000);

// Silence follow-up job - sends store link after 10min of customer inactivity
setTimeout(() => {
  const { runSilenceFollowUpJob } = require('./jobs/silenceFollowUp');
  console.log('⏰ Silence follow-up job scheduled (every 60s)');
  runSilenceFollowUpJob();
  setInterval(runSilenceFollowUpJob, 60 * 1000);
}, 90000);

// Health check - monitors tracking domain, emails alert on SSL/DNS/HTTP failure
setTimeout(() => {
  const { startHealthCheck } = require('./jobs/healthCheck');
  startHealthCheck();
}, 30000);

server.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
  console.log(`📡 Webhook endpoint: http://localhost:${PORT}/webhook`);
});
