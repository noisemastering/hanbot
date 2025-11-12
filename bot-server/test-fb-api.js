require('dotenv').config();
const axios = require('axios');

(async () => {
  const token = process.env.FB_PAGE_TOKEN;
  console.log('Token exists:', token ? 'YES' : 'NO');
  console.log('Token length:', token ? token.length : 0);

  // Test with known PSID that worked before
  const testPsid = '24608748058775748';
  console.log(`\nTesting with PSID: ${testPsid}`);

  try {
    const res = await axios.get(`https://graph.facebook.com/v18.0/${testPsid}`, {
      params: {
        fields: 'first_name,last_name,profile_pic',
        access_token: token
      }
    });
    console.log('\n✅ SUCCESS - Can fetch user data:');
    console.log(JSON.stringify(res.data, null, 2));
  } catch (err) {
    console.log('\n❌ FAILED - Cannot fetch user data:');
    console.log('Error:', err.response?.data || err.message);
  }

  // Test with one of the PSIDs from recent messages
  const recentPsid = '25998067309781441';
  console.log(`\n\nTesting with recent PSID: ${recentPsid}`);

  try {
    const res = await axios.get(`https://graph.facebook.com/v18.0/${recentPsid}`, {
      params: {
        fields: 'first_name,last_name,profile_pic',
        access_token: token
      }
    });
    console.log('\n✅ SUCCESS - Can fetch user data:');
    console.log(JSON.stringify(res.data, null, 2));
  } catch (err) {
    console.log('\n❌ FAILED - Cannot fetch user data:');
    console.log('Error:', err.response?.data || err.message);
  }
})();
