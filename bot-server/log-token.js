const mongoose = require("mongoose");
require("dotenv").config();
mongoose.connect(process.env.MONGODB_URI);
const MercadoLibreAuth = require("./models/MercadoLibreAuth");

async function logToken() {
  const auth = await MercadoLibreAuth.findOne({ sellerId: "482595248", active: true });

  if (!auth) {
    console.log("No authorization found");
    process.exit(1);
  }

  console.log("🔐 HANLOB (482595248) ACCESS TOKEN:");
  console.log("");
  console.log(auth.accessToken);
  console.log("");
  console.log("📋 Token Details:");
  console.log("   Length:", auth.accessToken.length, "characters");
  console.log("   Created:", auth.tokenCreatedAt);
  console.log("   Expires in:", auth.expiresIn, "seconds =", (auth.expiresIn / 3600).toFixed(1), "hours");
  console.log("   Refresh token:", auth.refreshToken);

  const now = Date.now();
  const expiryMs = auth.tokenCreatedAt.getTime() + (auth.expiresIn * 1000);
  const minutesUntilExpiry = Math.floor((expiryMs - now) / 60000);
  console.log("   Time until expiry:", minutesUntilExpiry, "minutes");
  console.log("   Is expired:", now >= expiryMs);

  mongoose.disconnect();
}

logToken();
