const mongoose = require('mongoose');
require('dotenv').config({ path: '/Users/serch/HanlobBot/bot-server/.env' });

mongoose.connect(process.env.MONGODB_URI);

const MercadoLibreAuth = require('/Users/serch/HanlobBot/bot-server/models/MercadoLibreAuth');

async function checkToken() {
  const auth = await MercadoLibreAuth.findOne({ sellerId: '482595248', active: true });

  if (!auth) {
    console.log('❌ No authorization found');
    process.exit(1);
  }

  console.log('🔍 Token Analysis:');
  console.log('   Access Token Length:', auth.accessToken.length, 'chars');
  console.log('   Access Token Preview:', auth.accessToken.substring(0, 50) + '...');
  console.log('   Refresh Token Length:', auth.refreshToken.length, 'chars');
  console.log('   Token Created:', auth.tokenCreatedAt);
  console.log('   Expires In:', auth.expiresIn + 's');

  // Check if token has unexpected whitespace
  const trimmedToken = auth.accessToken.trim();
  if (trimmedToken.length !== auth.accessToken.length) {
    console.log('   ⚠️ Token has whitespace! Original:', auth.accessToken.length, 'Trimmed:', trimmedToken.length);
  }

  // Check for newlines
  if (auth.accessToken.includes('\n') || auth.accessToken.includes('\r')) {
    console.log('   ⚠️ Token contains newline characters!');
  }

  mongoose.disconnect();
}

checkToken().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
