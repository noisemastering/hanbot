// test-webhook.js - Send a test message to the webhook endpoint
const http = require('http');

const testPayload = {
  object: 'page',
  entry: [{
    messaging: [{
      sender: { id: 'test_debug_12345' },
      recipient: { id: 'PAGE_ID' },
      timestamp: Date.now(),
      message: {
        mid: `test_mid_${Date.now()}`,
        text: 'hola cuanto cuesta una 10x5'
      }
    }]
  }]
};

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/webhook',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  }
};

const req = http.request(options, (res) => {
  console.log(`Status: ${res.statusCode}`);
  res.on('data', (d) => {
    process.stdout.write(d);
  });
});

req.on('error', (error) => {
  console.error('Error:', error);
});

req.write(JSON.stringify(testPayload));
req.end();
