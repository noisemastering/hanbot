// routes/mercadoLibreAuthRoutes.js
const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const DashboardUser = require("../models/DashboardUser");
const MercadoLibreAuth = require("../models/MercadoLibreAuth");
const {
  generateAuthUrl,
  validateState,
  exchangeCodeForTokens,
  getSellerInfo,
  refreshTokens,
  getValidAccessToken
} = require("../utils/mercadoLibreOAuth");

const JWT_SECRET = process.env.JWT_SECRET || "your-super-secret-jwt-key-change-in-production";

// ============================================
// AUTHENTICATION MIDDLEWARE
// ============================================

const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) {
      return res.status(401).json({ success: false, error: "No token provided" });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await DashboardUser.findById(decoded.id).select("-password");

    if (!user || !user.active) {
      return res.status(401).json({ success: false, error: "Invalid token or inactive user" });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, error: "Invalid or expired token" });
  }
};

// ============================================
// PUBLIC ENDPOINTS (OAuth Flow)
// ============================================

// GET /ml/oauth/authorize - Generate OAuth URL
// Public endpoint (no auth) - can be called from bot with PSID
router.get("/oauth/authorize", async (req, res) => {
  try {
    const { psid } = req.query;

    // Optional: validate PSID format if provided
    if (psid && typeof psid !== "string") {
      return res.status(400).json({
        success: false,
        error: "Invalid PSID format"
      });
    }

    // Generate OAuth URL with state
    const { url, state } = await generateAuthUrl(psid, {
      ipAddress: req.ip,
      userAgent: req.get("user-agent")
    });

    console.log(`🔗 OAuth URL generated (PSID: ${psid || 'none'})`);

    res.json({
      success: true,
      authUrl: url,
      state  // Return state for debugging (optional)
    });
  } catch (error) {
    console.error("❌ Error generating OAuth URL:", error);
    res.status(500).json({
      success: false,
      error: "Failed to generate authorization URL"
    });
  }
});

// GET /ml/oauth/callback - Handle OAuth callback from Mercado Libre
router.get("/oauth/callback", async (req, res) => {
  try {
    const { code, state, error: oauthError } = req.query;

    // Handle OAuth errors (user denied, etc.)
    if (oauthError) {
      console.log(`⚠️ OAuth error from ML: ${oauthError}`);
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Authorization Failed</title>
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
            .error { color: #d32f2f; }
          </style>
        </head>
        <body>
          <h1 class="error">Authorization Failed</h1>
          <p>Error: ${oauthError}</p>
          <p>Please try again or contact support.</p>
        </body>
        </html>
      `);
    }

    // Validate required parameters
    if (!code) {
      return res.status(400).json({
        success: false,
        error: "Missing authorization code"
      });
    }

    if (!state) {
      return res.status(400).json({
        success: false,
        error: "Missing state parameter"
      });
    }

    // Validate state (CSRF protection) and retrieve PKCE code_verifier
    const { valid, psid, stateDoc, codeVerifier } = await validateState(state);

    if (!valid) {
      console.log(`🚫 Invalid or expired state parameter`);
      return res.status(403).json({
        success: false,
        error: "Invalid or expired state parameter. Please try again."
      });
    }

    if (!codeVerifier) {
      console.log(`🚫 Missing PKCE code_verifier`);
      return res.status(403).json({
        success: false,
        error: "Missing PKCE verifier. Please try again."
      });
    }

    // Mark state as used to prevent replay attacks
    await stateDoc.markAsUsed();

    // Exchange code for tokens using PKCE
    const { accessToken, refreshToken, expiresIn } = await exchangeCodeForTokens(code, codeVerifier);

    // Get seller information
    const sellerInfo = await getSellerInfo(accessToken);

    // Check if seller already exists
    let auth = await MercadoLibreAuth.findOne({ sellerId: sellerInfo.sellerId });

    if (auth) {
      // Update existing authorization
      console.log(`🔄 Updating existing authorization for seller ${sellerInfo.sellerId}`);
      auth.accessToken = accessToken;
      auth.refreshToken = refreshToken;
      auth.expiresIn = expiresIn;
      auth.tokenCreatedAt = new Date();
      auth.sellerInfo = {
        nickname: sellerInfo.nickname,
        email: sellerInfo.email,
        firstName: sellerInfo.firstName,
        lastName: sellerInfo.lastName,
        countryId: sellerInfo.countryId,
        siteId: sellerInfo.siteId
      };
      auth.psid = psid || auth.psid;  // Update PSID if provided
      auth.authorizedAt = new Date();
      auth.active = true;
      auth.lastError = undefined;
    } else {
      // Create new authorization
      console.log(`✨ Creating new authorization for seller ${sellerInfo.sellerId}`);
      auth = new MercadoLibreAuth({
        sellerId: sellerInfo.sellerId,
        accessToken,
        refreshToken,
        expiresIn,
        tokenCreatedAt: new Date(),
        sellerInfo: {
          nickname: sellerInfo.nickname,
          email: sellerInfo.email,
          firstName: sellerInfo.firstName,
          lastName: sellerInfo.lastName,
          countryId: sellerInfo.countryId,
          siteId: sellerInfo.siteId
        },
        psid,
        scope: ["read", "write", "offline_access"],
        authorizedAt: new Date(),
        active: true
      });
    }

    await auth.save();

    console.log(`✅ Authorization saved for seller ${sellerInfo.sellerId} (PSID: ${psid || 'none'})`);

    // Redirect to success page
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Account Connected</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            text-align: center;
            padding: 50px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
          }
          .success {
            background: white;
            color: #333;
            padding: 40px;
            border-radius: 10px;
            max-width: 500px;
            margin: 0 auto;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
          }
          h1 { color: #4caf50; margin-bottom: 20px; }
          p { font-size: 18px; line-height: 1.6; }
          .seller-info {
            background: #f5f5f5;
            padding: 15px;
            border-radius: 5px;
            margin-top: 20px;
          }
        </style>
      </head>
      <body>
        <div class="success">
          <h1>✅ Account Connected Successfully!</h1>
          <p>Your Mercado Libre account has been authorized.</p>
          <div class="seller-info">
            <strong>Seller:</strong> ${sellerInfo.nickname}<br>
            <strong>ID:</strong> ${sellerInfo.sellerId}
          </div>
          <p style="margin-top: 30px; color: #666;">You can close this window now.</p>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error("❌ Error in OAuth callback:", error.response?.data || error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Authorization Error</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
          .error { color: #d32f2f; }
        </style>
      </head>
      <body>
        <h1 class="error">Authorization Error</h1>
        <p>Failed to complete authorization. Please try again.</p>
        ${process.env.NODE_ENV === "development" ? `<pre>${error.message}</pre>` : ''}
      </body>
      </html>
    `);
  }
});

// ============================================
// AUTHENTICATED ENDPOINTS (Seller Management)
// ============================================

// POST /ml/refresh - Manually refresh tokens
router.post("/refresh", authenticate, async (req, res) => {
  try {
    const { sellerId } = req.body;

    if (!sellerId) {
      return res.status(400).json({
        success: false,
        error: "Seller ID is required"
      });
    }

    const auth = await refreshTokens(sellerId);

    res.json({
      success: true,
      auth: {
        sellerId: auth.sellerId,
        sellerNickname: auth.sellerInfo?.nickname,
        expiresIn: auth.expiresIn,
        tokenCreatedAt: auth.tokenCreatedAt,
        lastRefreshedAt: auth.lastRefreshedAt
      }
    });
  } catch (error) {
    console.error("❌ Error refreshing tokens:", error);

    if (error.message.includes("No active authorization")) {
      return res.status(404).json({
        success: false,
        error: "Seller not found or authorization inactive"
      });
    }

    res.status(500).json({
      success: false,
      error: "Failed to refresh tokens",
      details: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
});

// GET /ml/sellers - List all authorized sellers
router.get("/sellers", authenticate, async (req, res) => {
  try {
    const sellers = await MercadoLibreAuth.find({ active: true })
      .select("sellerId sellerInfo psid authorizedAt lastRefreshedAt createdAt")
      .sort({ authorizedAt: -1 });

    res.json({
      success: true,
      sellers: sellers.map(s => ({
        sellerId: s.sellerId,
        nickname: s.sellerInfo?.nickname,
        email: s.sellerInfo?.email,
        fullName: s.fullName,
        psid: s.psid,
        authorizedAt: s.authorizedAt,
        lastRefreshedAt: s.lastRefreshedAt,
        isExpired: s.isTokenExpired(),
        timeUntilExpiry: s.getTimeUntilExpiry()
      }))
    });
  } catch (error) {
    console.error("❌ Error listing sellers:", error);
    res.status(500).json({
      success: false,
      error: "Failed to retrieve sellers"
    });
  }
});

// GET /ml/sellers/:sellerId - Get specific seller info
router.get("/sellers/:sellerId", authenticate, async (req, res) => {
  try {
    const { sellerId } = req.params;

    const auth = await MercadoLibreAuth.findOne({ sellerId, active: true });

    if (!auth) {
      return res.status(404).json({
        success: false,
        error: "Seller not found"
      });
    }

    res.json({
      success: true,
      seller: {
        sellerId: auth.sellerId,
        nickname: auth.sellerInfo?.nickname,
        email: auth.sellerInfo?.email,
        fullName: auth.fullName,
        psid: auth.psid,
        authorizedAt: auth.authorizedAt,
        lastRefreshedAt: auth.lastRefreshedAt,
        isExpired: auth.isTokenExpired(),
        timeUntilExpiry: auth.getTimeUntilExpiry(),
        lastError: auth.lastError
      }
    });
  } catch (error) {
    console.error("❌ Error fetching seller:", error);
    res.status(500).json({
      success: false,
      error: "Failed to retrieve seller information"
    });
  }
});

// GET /ml/items - Fetch all items from ML seller account
router.get("/items", authenticate, async (req, res) => {
  try {
    const axios = require("axios");
    const { getValidMLToken } = require("../mlTokenManager");

    const token = await getValidMLToken();

    // Get user ID
    const me = await axios.get("https://api.mercadolibre.com/users/me", {
      headers: { Authorization: `Bearer ${token}` }
    });
    const userId = me.data.id;

    // Fetch items using scroll API
    const items = [];
    let scrollId = null;
    const limit = 50;

    // First request
    const firstResponse = await axios.get(
      `https://api.mercadolibre.com/users/${userId}/items/search`,
      {
        params: { limit, search_type: "scan" },
        headers: { Authorization: `Bearer ${token}` }
      }
    );

    const total = firstResponse.data.paging.total;
    scrollId = firstResponse.data.scroll_id;
    let results = firstResponse.data.results;

    while (results && results.length > 0) {
      // Fetch details for batch of items (max 20 per multiget)
      for (let i = 0; i < results.length; i += 20) {
        const batch = results.slice(i, i + 20);
        try {
          const multiget = await axios.get(
            "https://api.mercadolibre.com/items",
            {
              params: { ids: batch.join(",") },
              headers: { Authorization: `Bearer ${token}` }
            }
          );
          for (const item of multiget.data) {
            if (item.code === 200 && item.body) {
              items.push({
                id: item.body.id,
                title: item.body.title,
                price: item.body.price,
                currency: item.body.currency_id,
                permalink: item.body.permalink,
                thumbnail: item.body.thumbnail,
                status: item.body.status,
                available_quantity: item.body.available_quantity
              });
            }
          }
        } catch (err) {
          console.error("❌ Error fetching item batch:", err.message);
        }
      }

      // Get next page
      if (!scrollId) break;

      try {
        const nextResponse = await axios.get(
          `https://api.mercadolibre.com/users/${userId}/items/search`,
          {
            params: { limit, search_type: "scan", scroll_id: scrollId },
            headers: { Authorization: `Bearer ${token}` }
          }
        );
        results = nextResponse.data.results;
        scrollId = nextResponse.data.scroll_id;
      } catch (err) {
        console.error("❌ Error fetching next page:", err.message);
        break;
      }
    }

    console.log(`✅ Fetched ${items.length}/${total} ML items`);

    res.json({
      success: true,
      total,
      items
    });
  } catch (error) {
    console.error("❌ Error fetching ML items:", error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: "Failed to fetch ML items",
      details: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
});

// DELETE /ml/sellers/:sellerId - Revoke seller authorization
router.delete("/sellers/:sellerId", authenticate, async (req, res) => {
  try {
    const { sellerId } = req.params;

    const auth = await MercadoLibreAuth.findOne({ sellerId });

    if (!auth) {
      return res.status(404).json({
        success: false,
        error: "Seller not found"
      });
    }

    // Soft delete (set active = false)
    auth.active = false;
    await auth.save();

    console.log(`🗑️ Authorization revoked for seller ${sellerId} by user ${req.user.username}`);

    res.json({
      success: true,
      message: "Authorization revoked successfully"
    });
  } catch (error) {
    console.error("❌ Error revoking authorization:", error);
    res.status(500).json({
      success: false,
      error: "Failed to revoke authorization"
    });
  }
});

module.exports = router;
