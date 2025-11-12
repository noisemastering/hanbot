require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');

// Import models
const User = require('./models/User');

// Test PSID that worked in our previous test
const TEST_PSID_WORKS = '24608748058775748'; // Sergio Patiño - should work
const TEST_PSID_FAILS = '25998067309781441'; // Should fail with error 100/33

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

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB\n');

    // Clean up test users first
    await User.deleteMany({ psid: { $in: [TEST_PSID_WORKS, TEST_PSID_FAILS] } });
    console.log('Cleaned up test users\n');

    console.log('=== TEST 1: PSID that should work ===');
    await registerUserIfNeeded(TEST_PSID_WORKS);

    console.log('\n=== TEST 2: PSID that should fail ===');
    await registerUserIfNeeded(TEST_PSID_FAILS);

    console.log('\n=== Checking database ===');
    const users = await User.find({ psid: { $in: [TEST_PSID_WORKS, TEST_PSID_FAILS] } });
    console.log(`Found ${users.length} users in database:`);
    users.forEach(u => {
      console.log(`- PSID: ${u.psid}, Name: "${u.first_name} ${u.last_name}"`);
    });

    await mongoose.disconnect();
    console.log('\nDone!');
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
