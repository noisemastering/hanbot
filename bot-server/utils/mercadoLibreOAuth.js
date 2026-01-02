// utils/mercadoLibreOAuth.js
const axios = require("axios");
const crypto = require("crypto");
const OAuthState = require("../models/OAuthState");
const MercadoLibreAuth = require("../models/MercadoLibreAuth");

// Constants - MEXICO URLs
const ML_AUTH_URL = "https://auth.mercadolibre.com.mx/authorization";
const ML_TOKEN_URL = "https://api.mercadolibre.com/oauth/token";
const ML_USER_INFO_URL = "https://api.mercadolibre.com/users/me";
const STATE_EXPIRY_MINUTES = 10;

// ============================================
// PKCE (Proof Key for Code Exchange) HELPERS
// ============================================

/**
 * Generate a cryptographically secure code_verifier (43-128 chars, URL-safe)
 * @returns {string} code_verifier
 */
function generateCodeVerifier() {
  // Generate 32 random bytes = 64 hex chars, then base64url encode
  // Result will be ~43 chars (URL-safe)
  return base64URLEncode(crypto.randomBytes(32));
}

/**
 * Generate code_challenge from code_verifier using S256 method
 * code_challenge = base64url(sha256(code_verifier))
 * @param {string} codeVerifier
 * @returns {string} code_challenge
 */
function generateCodeChallenge(codeVerifier) {
  return base64URLEncode(crypto.createHash('sha256').update(codeVerifier).digest());
}

/**
 * Base64 URL encoding (RFC 4648 §5)
 * @param {Buffer} buffer
 * @returns {string}
 */
function base64URLEncode(buffer) {
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// ============================================
// OAUTH FLOW FUNCTIONS
// ============================================

/**
 * Generate OAuth authorization URL with PKCE
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

    // Generate PKCE values
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    console.log(`🔐 PKCE Generated:`);
    console.log(`   code_verifier: ${codeVerifier.substring(0, 20)}... (${codeVerifier.length} chars)`);
    console.log(`   code_challenge: ${codeChallenge.substring(0, 20)}...`);

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

    console.log(`🔐 State Generated: ${state.substring(0, 20)}...`);

    // Store state + code_verifier in database with expiration
    const expiresAt = new Date(Date.now() + STATE_EXPIRY_MINUTES * 60 * 1000);
    await OAuthState.create({
      state,
      psid,
      nonce,
      codeVerifier,  // Store PKCE verifier
      expiresAt,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent
    });

    // Build OAuth URL with PKCE
    const params = new URLSearchParams({
      response_type: "code",
      client_id: process.env.ML_CLIENT_ID,
      redirect_uri: process.env.ML_REDIRECT_URI,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      scope: "read write offline_access"
    });

    const url = `${ML_AUTH_URL}?${params.toString()}`;

    console.log(`✅ OAuth URL Generated (Mexico, PKCE S256)`);
    console.log(`   PSID: ${psid || 'none'}`);
    console.log(`   Redirect: ${process.env.ML_REDIRECT_URI}`);

    return { url, state };
  } catch (error) {
    console.error("❌ Error generating auth URL:", error);
    throw error;
  }
}

/**
 * Validate state parameter from callback and retrieve code_verifier
 * @param {string} state - State parameter from OAuth callback
 * @returns {Promise<{valid: boolean, psid: string|null, stateDoc: object|null, codeVerifier: string|null}>}
 */
async function validateState(state) {
  try {
    if (!state) {
      return { valid: false, psid: null, stateDoc: null, codeVerifier: null };
    }

    // Find state in database
    const stateDoc = await OAuthState.findOne({ state });

    if (!stateDoc) {
      console.log(`⚠️ State not found in database: ${state.substring(0, 20)}...`);
      return { valid: false, psid: null, stateDoc: null, codeVerifier: null };
    }

    // Check if already used
    if (stateDoc.used) {
      console.log(`⚠️ State already used (replay attack?): ${state.substring(0, 20)}...`);
      return { valid: false, psid: null, stateDoc: null, codeVerifier: null };
    }

    // Check expiration
    if (stateDoc.expiresAt < new Date()) {
      console.log(`⚠️ State expired: ${state.substring(0, 20)}...`);
      return { valid: false, psid: null, stateDoc: null, codeVerifier: null };
    }

    // Decode and validate structure
    try {
      const decoded = JSON.parse(Buffer.from(state, "base64").toString("utf-8"));
      if (!decoded.nonce || decoded.nonce !== stateDoc.nonce) {
        console.log(`⚠️ Nonce mismatch in state: ${state.substring(0, 20)}...`);
        return { valid: false, psid: null, stateDoc: null, codeVerifier: null };
      }
    } catch (decodeError) {
      console.log(`⚠️ Invalid state encoding: ${state.substring(0, 20)}...`);
      return { valid: false, psid: null, stateDoc: null, codeVerifier: null };
    }

    console.log(`✅ State validated successfully`);
    console.log(`   PSID: ${stateDoc.psid || 'none'}`);
    console.log(`   code_verifier: ${stateDoc.codeVerifier.substring(0, 20)}...`);

    return {
      valid: true,
      psid: stateDoc.psid,
      stateDoc,
      codeVerifier: stateDoc.codeVerifier  // Return PKCE verifier
    };
  } catch (error) {
    console.error("❌ Error validating state:", error);
    return { valid: false, psid: null, stateDoc: null, codeVerifier: null };
  }
}

/**
 * Exchange authorization code for tokens using PKCE
 * @param {string} code - Authorization code from OAuth callback
 * @param {string} codeVerifier - PKCE code_verifier
 * @returns {Promise<{accessToken, refreshToken, expiresIn}>}
 */
async function exchangeCodeForTokens(code, codeVerifier) {
  try {
    if (!process.env.ML_CLIENT_ID || !process.env.ML_CLIENT_SECRET || !process.env.ML_REDIRECT_URI) {
      throw new Error("Missing ML OAuth credentials in environment variables");
    }

    console.log(`🔄 Exchanging code for tokens (PKCE)...`);
    console.log(`   code: ${code.substring(0, 20)}...`);
    console.log(`   code_verifier: ${codeVerifier.substring(0, 20)}...`);
    console.log(`   redirect_uri: ${process.env.ML_REDIRECT_URI}`);

    const response = await axios.post(
      ML_TOKEN_URL,
      new URLSearchParams({
        grant_type: "authorization_code",
        client_id: process.env.ML_CLIENT_ID,
        client_secret: process.env.ML_CLIENT_SECRET,
        code,
        redirect_uri: process.env.ML_REDIRECT_URI,
        code_verifier: codeVerifier  // PKCE verifier
      }).toString(),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" }
      }
    );

    const { access_token, refresh_token, expires_in } = response.data;

    if (!access_token || !refresh_token) {
      throw new Error("Missing tokens in ML response");
    }

    console.log(`✅ Tokens obtained successfully`);
    console.log(`   access_token: ${access_token.substring(0, 20)}...`);
    console.log(`   refresh_token: ${refresh_token.substring(0, 20)}...`);
    console.log(`   expires_in: ${expires_in}s`);

    return {
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresIn: expires_in || 21600  // Default 6 hours
    };
  } catch (error) {
    console.error("❌ Error exchanging code for tokens:");
    console.error("   Status:", error.response?.status);
    console.error("   Error:", error.response?.data?.error);
    console.error("   Message:", error.response?.data?.message || error.message);
    console.error("   Full response:", JSON.stringify(error.response?.data, null, 2));
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

    console.log(`✅ Seller info obtained:`);
    console.log(`   seller_id: ${id}`);
    console.log(`   nickname: ${nickname}`);
    console.log(`   email: ${email}`);
    console.log(`   country: ${country_id}`);

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

    auth.accessToken = access_token;
    auth.refreshToken = refresh_token || auth.refreshToken;
    auth.expiresIn = expires_in || 21600;
    auth.tokenCreatedAt = new Date();
    auth.lastRefreshedAt = new Date();
    auth.lastError = undefined;

    await auth.save();

    console.log(`✅ Tokens refreshed successfully for seller ${sellerId}`);

    return auth;
  } catch (error) {
    console.error(`❌ Error refreshing tokens for seller ${sellerId}:`, error.response?.data || error.message);

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
