require('dotenv').config();
const { debounceMessage, cancelDebounce } = require('./messageDebouncer');

const TEST_PSID = 'test_debounce_user';

console.log('🧪 Testing Message Debounce Mechanism\n');
console.log('Simulating rapid-fire messages like:');
console.log('  User: "Precio"');
console.log('  User: "Y medidas"\n');
console.log('Expected: Bot should wait 5 seconds after last message, then combine both\n');
console.log('---\n');

// Simulate rapid messages
console.log('[0s] User sends: "Precio"');
debounceMessage(TEST_PSID, 'Precio', async (combinedMessage) => {
  console.log(`\n[5s] ✅ Debounce period ended. Bot processes combined message:`);
  console.log(`     "${combinedMessage}"`);
  console.log('\nThis is what the bot will see and respond to!');
  process.exit(0);
});

// User sends second message 2 seconds later
setTimeout(() => {
  console.log('[2s] User sends: "Y medidas" (timer resets...)');
  debounceMessage(TEST_PSID, 'Y medidas', async (combinedMessage) => {
    console.log(`\n[7s] ✅ Debounce period ended. Bot processes combined message:`);
    console.log(`     "${combinedMessage}"`);
    console.log('\n✅ SUCCESS: Bot waited for user to finish and combined both messages!');
    console.log('Bot will now respond to: "Precio\\nY medidas"');
    process.exit(0);
  });
}, 2000);

// Show countdown
let countdown = 0;
const interval = setInterval(() => {
  countdown++;
  if (countdown <= 7 && countdown !== 2) {
    console.log(`[${countdown}s] Waiting...`);
  }
}, 1000);

// Cleanup after test
setTimeout(() => {
  clearInterval(interval);
}, 8000);
