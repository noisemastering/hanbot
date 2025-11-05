// scripts/removeEmojis.js
// Remove emojis from response strings

const fs = require('fs');
const path = require('path');

const files = [
  'ai/global/intents.js',
  'ai/core/greetings.js',
  'measureHandler.js'
];

const emojiReplacements = [
  // Common emojis in responses
  [/📍\s*/g, ''],
  [/🚚\s*/g, ''],
  [/🏡\s*/g, ''],
  [/😊\s*/g, ''],
  [/🌿\s*/g, ''],
  [/👉\s*/g, ''],
  [/📱\s*/g, ''],
  [/💰\s*/g, ''],
  [/🎉\s*/g, ''],
  [/📞\s*/g, ''],
  [/🏪\s*/g, ''],
  [/✨\s*/g, ''],
  [/👋\s*/g, ''],
  [/🙌\s*/g, ''],
  [/🌷\s*/g, ''],
  [/☀️\s*/g, ''],
  [/📏\s*/g, ''],
  [/👍\s*/g, ''],
  [/📐\s*/g, ''],
  // Clean up extra spaces left behind
  [/\s{2,}/g, ' ']
];

files.forEach(file => {
  const filePath = path.join(__dirname, '..', file);

  if (!fs.existsSync(filePath)) {
    console.log(`⚠️  Skipping ${file} (not found)`);
    return;
  }

  let content = fs.readFileSync(filePath, 'utf8');
  const original = content;

  // Apply all replacements
  emojiReplacements.forEach(([pattern, replacement]) => {
    content = content.replace(pattern, replacement);
  });

  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`✅ Cleaned emojis from ${file}`);
  } else {
    console.log(`✓ No emojis found in ${file}`);
  }
});

console.log('\n✅ Done!');
