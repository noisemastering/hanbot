const axios = require('axios');

async function testOrders() {
  try {
    // Login first
    console.log('🔐 Logging in...');
    const loginResponse = await axios.post('http://localhost:3000/auth/login', {
      username: 'admin',
      password: 'admin123'
    });

    const token = loginResponse.data.token;
    console.log('✅ Got token');

    // Fetch orders
    console.log('\n📦 Fetching orders for seller 482595248...');
    const ordersResponse = await axios.get(
      'http://localhost:3000/ml/orders/482595248?sort=date_desc&limit=3',
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    );

    const data = ordersResponse.data;

    if (data.success) {
      console.log('\n✅ SUCCESS!');
      console.log(`   Total orders in response: ${data.orders.length}`);
      console.log(`   Total in ML: ${data.paging?.total || 'N/A'}`);

      console.log('\n📋 First 3 orders:');
      data.orders.forEach((order, i) => {
        console.log(`\n   ${i + 1}. Order ID: ${order.id}`);
        console.log(`      Status: ${order.status}`);
        console.log(`      Buyer: ${order.buyer?.nickname || 'N/A'}`);
        console.log(`      Date: ${order.date_created}`);
        console.log(`      Total: $${order.total_amount} ${order.currency_id}`);
        console.log(`      Payment: ${order.payments?.[0]?.status || 'N/A'}`);
        if (order.order_items?.[0]) {
          console.log(`      Item: ${order.order_items[0].item?.title?.substring(0, 60)}...`);
          console.log(`      Quantity: ${order.order_items[0].quantity}`);
        }
      });
    } else {
      console.log('❌ FAILED:', data.error || data.message);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

testOrders();
