// routes/mercadoLibreAuthRoutes.js
const express = require("express");
const router = express.Router();
const axios = require("axios");
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

// GET /ml/items - Fetch all items from ML seller account (or search)
router.get("/items", authenticate, async (req, res) => {
  try {
    const axios = require("axios");
    const { getValidMLToken } = require("../mlTokenManager");
    const { search } = req.query;

    const token = await getValidMLToken();

    // Get user ID
    const me = await axios.get("https://api.mercadolibre.com/users/me", {
      headers: { Authorization: `Bearer ${token}` }
    });
    const userId = me.data.id;

    // If search query is provided, check if it's a URL/ML item ID first
    if (search && search.length >= 3) {
      // Check if search contains an ML item ID (URL or direct ID)
      const { extractMLItemId } = require("../utils/mlPriceSync");
      const mlItemId = extractMLItemId(search) ||
        (search.match(/^MLM[-]?(\d{8,})$/i) ? `MLM${search.match(/\d+/)[0]}` : null);

      if (mlItemId) {
        console.log(`🔍 Detected ML item ID in search: ${mlItemId}`);
        try {
          const itemResponse = await axios.get(
            `https://api.mercadolibre.com/items/${mlItemId}`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                'Cache-Control': 'no-cache'
              }
            }
          );

          const item = itemResponse.data;
          return res.json({
            success: true,
            items: [{
              id: item.id,
              title: item.title,
              price: item.price,
              original_price: item.original_price,
              currency: item.currency_id,
              permalink: item.permalink,
              thumbnail: item.thumbnail,
              status: item.status,
              available_quantity: item.available_quantity
            }],
            total: 1
          });
        } catch (itemErr) {
          console.error(`❌ Error fetching ML item ${mlItemId}:`, itemErr.message);
          // Fall through to text search if item not found
        }
      }

      // Text search - use ML search API
      const searchResponse = await axios.get(
        `https://api.mercadolibre.com/users/${userId}/items/search`,
        {
          params: { q: search, limit: 50 },
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      const searchResults = searchResponse.data.results || [];
      if (searchResults.length === 0) {
        return res.json({ success: true, items: [], total: 0 });
      }

      // Fetch details for search results
      const items = [];
      for (let i = 0; i < searchResults.length; i += 20) {
        const batch = searchResults.slice(i, i + 20);
        try {
          const multiget = await axios.get(
            "https://api.mercadolibre.com/items",
            {
              params: { ids: batch.join(",") },
              headers: {
                Authorization: `Bearer ${token}`,
                'Cache-Control': 'no-cache'
              }
            }
          );
          for (const item of multiget.data) {
            if (item.code === 200 && item.body) {
              items.push({
                id: item.body.id,
                title: item.body.title,
                price: item.body.price,
                original_price: item.body.original_price,
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

      console.log(`✅ Found ${items.length} ML items matching "${search}"`);
      return res.json({ success: true, items, total: items.length });
    }

    // No search - fetch all items using scroll API
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
              headers: {
                Authorization: `Bearer ${token}`,
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
              }
            }
          );
          for (const item of multiget.data) {
            if (item.code === 200 && item.body) {
              items.push({
                id: item.body.id,
                title: item.body.title,
                price: item.body.price,
                original_price: item.body.original_price, // Price before discounts
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

// GET /ml/items/status - Get all ML item statuses (inactive, etc.)
router.get("/items/status", authenticate, async (req, res) => {
  try {
    const MLItemStatus = require("../models/MLItemStatus");
    const statuses = await MLItemStatus.find({}).lean();

    // Convert to a map for easy lookup
    const statusMap = {};
    for (const status of statuses) {
      statusMap[status.mlItemId] = status;
    }

    res.json({ success: true, statuses: statusMap });
  } catch (error) {
    console.error("❌ Error fetching ML item statuses:", error);
    res.status(500).json({ success: false, error: "Failed to fetch item statuses" });
  }
});

// PUT /ml/items/:itemId/status - Update ML item status (inactive, notes, etc.)
router.put("/items/:itemId/status", authenticate, async (req, res) => {
  try {
    const MLItemStatus = require("../models/MLItemStatus");
    const { itemId } = req.params;
    const { inactive, inactiveReason, notes, lastMLTitle, lastMLPrice } = req.body;

    const status = await MLItemStatus.findOneAndUpdate(
      { mlItemId: itemId },
      {
        inactive,
        inactiveReason: inactive ? inactiveReason : null,
        notes,
        lastMLTitle,
        lastMLPrice
      },
      { upsert: true, new: true }
    );

    console.log(`📝 ML item ${itemId} status updated: inactive=${inactive}`);

    res.json({ success: true, status });
  } catch (error) {
    console.error("❌ Error updating ML item status:", error);
    res.status(500).json({ success: false, error: "Failed to update item status" });
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

// ============================================
// ML PRICE SYNC ENDPOINTS
// ============================================

// POST /ml/sync-prices - Sync ML prices for all products with ML links
router.post("/sync-prices", authenticate, async (req, res) => {
  try {
    const { syncMLPrices } = require("../utils/mlPriceSync");

    console.log(`🔄 ML price sync triggered by user ${req.user.username}`);

    const results = await syncMLPrices();

    res.json({
      success: true,
      ...results
    });
  } catch (error) {
    console.error("❌ Error syncing ML prices:", error);
    res.status(500).json({
      success: false,
      error: "Failed to sync ML prices",
      details: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
});

// POST /ml/sync-prices/:productId - Sync ML price for a single product
router.post("/sync-prices/:productId", authenticate, async (req, res) => {
  try {
    const { syncSingleProductMLPrice } = require("../utils/mlPriceSync");
    const { productId } = req.params;

    const result = await syncSingleProductMLPrice(productId);

    if (!result) {
      return res.status(404).json({
        success: false,
        error: "Product not found or has no ML link"
      });
    }

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error("❌ Error syncing single product ML price:", error);
    res.status(500).json({
      success: false,
      error: "Failed to sync ML price",
      details: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
});

// GET /ml/price-status - Get products with price discrepancies
router.get("/price-status", authenticate, async (req, res) => {
  try {
    const ProductFamily = require("../models/ProductFamily");

    // Find sellable products with ML links that have mlPrice data
    const products = await ProductFamily.find({
      sellable: true,
      mlPrice: { $exists: true, $ne: null }
    }).select("_id name price mlPrice mlPriceUpdatedAt onlineStoreLinks");

    // Calculate discrepancies
    const productsWithStatus = products.map(p => {
      const discrepancy = p.price && p.mlPrice ? p.price - p.mlPrice : null;
      const discrepancyPercent = p.price && p.mlPrice
        ? Math.round((discrepancy / p.mlPrice) * 100)
        : null;

      return {
        _id: p._id,
        name: p.name,
        price: p.price,
        mlPrice: p.mlPrice,
        mlPriceUpdatedAt: p.mlPriceUpdatedAt,
        discrepancy,
        discrepancyPercent,
        hasDiscrepancy: discrepancy !== null && discrepancy !== 0
      };
    });

    // Sort by discrepancy (largest differences first)
    productsWithStatus.sort((a, b) => {
      const absA = Math.abs(a.discrepancy || 0);
      const absB = Math.abs(b.discrepancy || 0);
      return absB - absA;
    });

    res.json({
      success: true,
      total: productsWithStatus.length,
      withDiscrepancy: productsWithStatus.filter(p => p.hasDiscrepancy).length,
      products: productsWithStatus
    });
  } catch (error) {
    console.error("❌ Error fetching price status:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch price status"
    });
  }
});

// ============================================
// ML API PLAYGROUND ENDPOINTS
// ============================================

// GET /ml/playground/status - Check ML API connection and token status
router.get("/playground/status", authenticate, async (req, res) => {
  try {
    const auth = await MercadoLibreAuth.findOne({ active: true }).sort({ updatedAt: -1 });

    if (!auth) {
      return res.json({
        success: true,
        connected: false,
        message: "No active ML authorization found"
      });
    }

    // Try to get a valid token
    const token = await getValidAccessToken(auth.sellerId);

    if (!token) {
      return res.json({
        success: true,
        connected: false,
        sellerId: auth.sellerId,
        sellerNickname: auth.sellerNickname,
        message: "Token expired and could not be refreshed"
      });
    }

    // Test the token by fetching user info
    try {
      const userResponse = await axios.get("https://api.mercadolibre.com/users/me", {
        headers: { Authorization: `Bearer ${token}` }
      });

      return res.json({
        success: true,
        connected: true,
        sellerId: auth.sellerId,
        sellerNickname: auth.sellerNickname || userResponse.data.nickname,
        userId: userResponse.data.id,
        siteId: userResponse.data.site_id,
        tokenExpiresAt: auth.tokenExpiresAt,
        message: "Connected and authenticated"
      });
    } catch (apiError) {
      return res.json({
        success: true,
        connected: false,
        sellerId: auth.sellerId,
        error: apiError.response?.data?.message || apiError.message,
        message: "Token invalid or API error"
      });
    }
  } catch (error) {
    console.error("❌ Playground status error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /ml/playground/item/:itemId - Get full item details from ML
router.get("/playground/item/:itemId", authenticate, async (req, res) => {
  try {
    const { itemId } = req.params;
    const auth = await MercadoLibreAuth.findOne({ active: true }).sort({ updatedAt: -1 });

    if (!auth) {
      return res.status(400).json({ success: false, error: "No active ML authorization" });
    }

    const token = await getValidAccessToken(auth.sellerId);
    if (!token) {
      return res.status(401).json({ success: false, error: "Could not get valid token" });
    }

    // Fetch item details
    const itemResponse = await axios.get(
      `https://api.mercadolibre.com/items/${itemId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    // Also fetch price details (includes promotions)
    let priceDetails = null;
    try {
      const priceResponse = await axios.get(
        `https://api.mercadolibre.com/items/${itemId}/prices`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      priceDetails = priceResponse.data;
    } catch (e) {
      // Price endpoint might not be available for all items
      console.log(`Note: Could not fetch price details for ${itemId}`);
    }

    const item = itemResponse.data;

    res.json({
      success: true,
      item: {
        id: item.id,
        title: item.title,
        price: item.price,
        original_price: item.original_price,
        currency_id: item.currency_id,
        available_quantity: item.available_quantity,
        sold_quantity: item.sold_quantity,
        status: item.status,
        listing_type_id: item.listing_type_id,
        category_id: item.category_id,
        permalink: item.permalink,
        thumbnail: item.thumbnail,
        seller_custom_field: item.seller_custom_field, // SKU
        date_created: item.date_created,
        last_updated: item.last_updated,
        health: item.health,
        catalog_listing: item.catalog_listing
      },
      priceDetails,
      raw: item // Full response for debugging
    });
  } catch (error) {
    console.error("❌ Playground item fetch error:", error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      success: false,
      error: error.response?.data?.message || error.message,
      mlError: error.response?.data
    });
  }
});

// PUT /ml/playground/item/:itemId/price - Update item price on ML
router.put("/playground/item/:itemId/price", authenticate, async (req, res) => {
  try {
    const { itemId } = req.params;
    const { price } = req.body;

    if (!price || typeof price !== "number" || price <= 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid price. Must be a positive number."
      });
    }

    const auth = await MercadoLibreAuth.findOne({ active: true }).sort({ updatedAt: -1 });

    if (!auth) {
      return res.status(400).json({ success: false, error: "No active ML authorization" });
    }

    const token = await getValidAccessToken(auth.sellerId);
    if (!token) {
      return res.status(401).json({ success: false, error: "Could not get valid token" });
    }

    console.log(`🏷️ Playground: Updating price for ${itemId} to $${price}`);

    // Update the price on ML
    const updateResponse = await axios.put(
      `https://api.mercadolibre.com/items/${itemId}`,
      { price: price },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      }
    );

    console.log(`✅ Playground: Price updated for ${itemId}`);

    res.json({
      success: true,
      message: `Price updated to $${price}`,
      item: {
        id: updateResponse.data.id,
        title: updateResponse.data.title,
        price: updateResponse.data.price,
        original_price: updateResponse.data.original_price,
        status: updateResponse.data.status,
        last_updated: updateResponse.data.last_updated
      }
    });
  } catch (error) {
    console.error("❌ Playground price update error:", error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      success: false,
      error: error.response?.data?.message || error.message,
      mlError: error.response?.data,
      cause: error.response?.data?.cause
    });
  }
});

// GET /ml/playground/items - List seller's items for testing
router.get("/playground/items", authenticate, async (req, res) => {
  try {
    const { limit = 20, offset = 0, status = "active" } = req.query;

    const auth = await MercadoLibreAuth.findOne({ active: true }).sort({ updatedAt: -1 });

    if (!auth) {
      return res.status(400).json({ success: false, error: "No active ML authorization" });
    }

    const token = await getValidAccessToken(auth.sellerId);
    if (!token) {
      return res.status(401).json({ success: false, error: "Could not get valid token" });
    }

    // Search for seller's items
    const searchResponse = await axios.get(
      `https://api.mercadolibre.com/users/${auth.sellerId}/items/search`,
      {
        params: {
          status,
          limit: Math.min(parseInt(limit), 50),
          offset: parseInt(offset)
        },
        headers: { Authorization: `Bearer ${token}` }
      }
    );

    const itemIds = searchResponse.data.results || [];

    // Fetch details for each item (in batches of 20)
    let items = [];
    for (let i = 0; i < itemIds.length; i += 20) {
      const batch = itemIds.slice(i, i + 20);
      try {
        const multiResponse = await axios.get(
          "https://api.mercadolibre.com/items",
          {
            params: { ids: batch.join(",") },
            headers: { Authorization: `Bearer ${token}` }
          }
        );

        const batchItems = multiResponse.data
          .filter(r => r.code === 200)
          .map(r => ({
            id: r.body.id,
            title: r.body.title,
            price: r.body.price,
            original_price: r.body.original_price,
            currency: r.body.currency_id,
            status: r.body.status,
            available_quantity: r.body.available_quantity,
            sold_quantity: r.body.sold_quantity,
            thumbnail: r.body.thumbnail,
            permalink: r.body.permalink,
            sku: r.body.seller_custom_field
          }));

        items = items.concat(batchItems);
      } catch (e) {
        console.error("Error fetching batch:", e.message);
      }
    }

    res.json({
      success: true,
      total: searchResponse.data.paging?.total || items.length,
      limit: parseInt(limit),
      offset: parseInt(offset),
      items
    });
  } catch (error) {
    console.error("❌ Playground items list error:", error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      success: false,
      error: error.response?.data?.message || error.message
    });
  }
});

module.exports = router;
