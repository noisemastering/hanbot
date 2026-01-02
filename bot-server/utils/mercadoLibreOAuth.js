// utils/mercadoLibreOAuth.js
const axios = require("axios");
const crypto = require("crypto");
const OAuthState = require("../models/OAuthState");
const MercadoLibreAuth = require("../models/MercadoLibreAuth");

// Constants
const ML_AUTH_URL = process.env.ML_AUTH_URL || "https://auth.mercadolibre.com.ar/authorization";
const ML_TOKEN_URL = "https://api.mercadolibre.com/oauth/token";
const ML_USER_INFO_URL = "https://api.mercadolibre.com/users/me";
const STATE_EXPIRY_MINUTES = 10;

/**
 * Generate OAuth authorization URL with encoded state
 * @param {string} psid - Optional PSID from Meta for click tracking
 * @param {object} metadata - Optional metadata (ip, userAgent)
 * @returns {Promise<{url: string, state: string}>}
 */
async function generateAuthUrl(psid = null, metadata = {}) {
  try {
    // Validate environment variables
    if (!process.env.ML_CLIENT_ID || !process.env.ML_REDIRECT_URI) {
      throw new Error("Missing ML_CLIENT_ID or ML_REDIRECT_URI in environment variables");
    }

    // Generate cryptographically secure nonce
    const nonce = crypto.randomBytes(16).toString("hex");
    const timestamp = Date.now();

    // Create state payload
    const statePayload = {
      psid: psid || null,
      nonce,
      timestamp
    };

    // Encode state as base64
    const state = Buffer.from(JSON.stringify(statePayload)).toString("base64");

    // Store state in database with expiration
    const expiresAt = new Date(Date.now() + STATE_EXPIRY_MINUTES * 60 * 1000);
    await OAuthState.create({
      state,
      psid,
      nonce,
      expiresAt,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent
    });

    // Build OAuth URL
    const params = new URLSearchParams({
      response_type: "code",
      client_id: process.env.ML_CLIENT_ID,
      redirect_uri: process.env.ML_REDIRECT_URI,
      state,
      // Request offline_access for refresh tokens
      scope: "read write offline_access"
    });

    const url = `${ML_AUTH_URL}?${params.toString()}`;

    console.log(`🔐 Generated ML OAuth URL (PSID: ${psid || 'none'}, State: ${state.substring(0, 20)}...)`);

    return { url, state };
  } catch (error) {
    console.error("❌ Error generating auth URL:", error);
    throw error;
  }
}

/**
 * Validate state parameter from callback
 * @param {string} state - State parameter from OAuth callback
 * @returns {Promise<{valid: boolean, psid: string|null, stateDoc: object|null}>}
 */
async function validateState(state) {
  try {
    if (!state) {
      return { valid: false, psid: null, stateDoc: null };
    }

    // Find state in database
    const stateDoc = await OAuthState.findOne({ state });

    if (!stateDoc) {
      console.log(`⚠️ State not found in database: ${state.substring(0, 20)}...`);
      return { valid: false, psid: null, stateDoc: null };
    }

    // Check if already used
    if (stateDoc.used) {
      console.log(`⚠️ State already used: ${state.substring(0, 20)}...`);
      return { valid: false, psid: null, stateDoc: null };
    }

    // Check expiration (redundant with TTL, but good for clarity)
    if (stateDoc.expiresAt < new Date()) {
      console.log(`⚠️ State expired: ${state.substring(0, 20)}...`);
      return { valid: false, psid: null, stateDoc: null };
    }

    // Decode and validate structure
    try {
      const decoded = JSON.parse(Buffer.from(state, "base64").toString("utf-8"));
      if (!decoded.nonce || decoded.nonce !== stateDoc.nonce) {
        console.log(`⚠️ Nonce mismatch in state: ${state.substring(0, 20)}...`);
        return { valid: false, psid: null, stateDoc: null };
      }
    } catch (decodeError) {
      console.log(`⚠️ Invalid state encoding: ${state.substring(0, 20)}...`);
      return { valid: false, psid: null, stateDoc: null };
    }

    console.log(`✅ State validated successfully (PSID: ${stateDoc.psid || 'none'})`);
    return { valid: true, psid: stateDoc.psid, stateDoc };
  } catch (error) {
    console.error("❌ Error validating state:", error);
    return { valid: false, psid: null, stateDoc: null };
  }
}

/**
 * Exchange authorization code for tokens
 * @param {string} code - Authorization code from OAuth callback
 * @returns {Promise<{accessToken, refreshToken, expiresIn}>}
 */
async function exchangeCodeForTokens(code) {
  try {
    if (!process.env.ML_CLIENT_ID || !process.env.ML_CLIENT_SECRET || !process.env.ML_REDIRECT_URI) {
      throw new Error("Missing ML OAuth credentials in environment variables");
    }

    console.log(`🔄 Exchanging code for tokens...`);

    const response = await axios.post(
      ML_TOKEN_URL,
      new URLSearchParams({
        grant_type: "authorization_code",
        client_id: process.env.ML_CLIENT_ID,
        client_secret: process.env.ML_CLIENT_SECRET,
        code,
        redirect_uri: process.env.ML_REDIRECT_URI
      }).toString(),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" }
      }
    );

    const { access_token, refresh_token, expires_in } = response.data;

    if (!access_token || !refresh_token) {
      throw new Error("Missing tokens in ML response");
    }

    console.log(`✅ Tokens obtained successfully (expires in ${expires_in}s)`);

    return {
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresIn: expires_in || 21600  // Default 6 hours
    };
  } catch (error) {
    console.error("❌ Error exchanging code for tokens:", error.response?.data || error.message);
    throw error;
  }
}

/**
 * Get seller information using access token
 * @param {string} accessToken - Valid ML access token
 * @returns {Promise<object>} Seller info from /users/me
 */
async function getSellerInfo(accessToken) {
  try {
    console.log(`🔍 Fetching seller info from ML...`);

    const response = await axios.get(ML_USER_INFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const { id, nickname, email, first_name, last_name, country_id, site_id } = response.data;

    console.log(`✅ Seller info obtained: ${nickname} (ID: ${id})`);

    return {
      sellerId: String(id),
      nickname,
      email,
      firstName: first_name,
      lastName: last_name,
      countryId: country_id,
      siteId: site_id
    };
  } catch (error) {
    console.error("❌ Error fetching seller info:", error.response?.data || error.message);
    throw error;
  }
}

/**
 * Refresh access token using refresh token
 * @param {string} sellerId - Seller ID to refresh
 * @returns {Promise<object>} Updated auth document
 */
async function refreshTokens(sellerId) {
  try {
    // Find existing auth
    const auth = await MercadoLibreAuth.findOne({ sellerId, active: true });

    if (!auth) {
      throw new Error(`No active authorization found for seller ${sellerId}`);
    }

    console.log(`🔄 Refreshing tokens for seller ${sellerId}...`);

    const response = await axios.post(
      ML_TOKEN_URL,
      new URLSearchParams({
        grant_type: "refresh_token",
        client_id: process.env.ML_CLIENT_ID,
        client_secret: process.env.ML_CLIENT_SECRET,
        refresh_token: auth.refreshToken
      }).toString(),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" }
      }
    );

    const { access_token, refresh_token, expires_in } = response.data;

    // Update auth document
    auth.accessToken = access_token;
    auth.refreshToken = refresh_token || auth.refreshToken;  // ML sometimes returns new refresh token
    auth.expiresIn = expires_in || 21600;
    auth.tokenCreatedAt = new Date();
    auth.lastRefreshedAt = new Date();
    auth.lastError = undefined;  // Clear any previous errors

    await auth.save();

    console.log(`✅ Tokens refreshed successfully for seller ${sellerId}`);

    return auth;
  } catch (error) {
    console.error(`❌ Error refreshing tokens for seller ${sellerId}:`, error.response?.data || error.message);

    // Log error to database
    const auth = await MercadoLibreAuth.findOne({ sellerId, active: true });
    if (auth) {
      auth.lastError = {
        message: error.response?.data?.message || error.message,
        code: error.response?.data?.error,
        timestamp: new Date()
      };
      await auth.save();
    }

    throw error;
  }
}

/**
 * Get valid access token for seller (auto-refresh if needed)
 * @param {string} sellerId - Seller ID
 * @returns {Promise<string>} Valid access token
 */
async function getValidAccessToken(sellerId) {
  try {
    const auth = await MercadoLibreAuth.findOne({ sellerId, active: true });

    if (!auth) {
      throw new Error(`No active authorization found for seller ${sellerId}`);
    }

    // Check if token is expired
    if (auth.isTokenExpired()) {
      console.log(`🔄 Token expired for seller ${sellerId}, refreshing...`);
      const refreshedAuth = await refreshTokens(sellerId);
      return refreshedAuth.accessToken;
    }

    return auth.accessToken;
  } catch (error) {
    console.error(`❌ Error getting valid access token for seller ${sellerId}:`, error);
    throw error;
  }
}

module.exports = {
  generateAuthUrl,
  validateState,
  exchangeCodeForTokens,
  getSellerInfo,
  refreshTokens,
  getValidAccessToken
};
