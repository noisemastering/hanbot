/**
 * Import Mexican postal codes from SEPOMEX database
 * Usage: node scripts/importZipCodes.js /path/to/CPdescarga.txt
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const fs = require('fs');
const iconv = require('iconv-lite');
const readline = require('readline');

const ZipCode = require('../models/ZipCode');

// Shipping zones by state
const METRO_STATES = ['Ciudad de México', 'Distrito Federal'];
const NEAR_STATES = ['Estado de México', 'México', 'Querétaro', 'Hidalgo', 'Morelos', 'Tlaxcala', 'Puebla'];
const REMOTE_STATES = ['Baja California Sur', 'Quintana Roo', 'Yucatán', 'Campeche', 'Chiapas', 'Oaxaca'];

function getShippingZone(state, zone) {
  // Remote rural areas get extra time
  if (zone === 'Rural' && REMOTE_STATES.some(s => state.includes(s))) {
    return 'remote';
  }

  if (METRO_STATES.some(s => state.includes(s))) {
    return 'metro';
  }

  if (NEAR_STATES.some(s => state.includes(s))) {
    return 'near';
  }

  if (REMOTE_STATES.some(s => state.includes(s))) {
    return 'remote';
  }

  return 'far';
}

async function importZipCodes(filePath) {
  // Connect to MongoDB
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB');

  // Read file with ISO-8859-1 encoding
  const fileBuffer = fs.readFileSync(filePath);
  const fileContent = iconv.decode(fileBuffer, 'ISO-8859-1');
  const lines = fileContent.split(/\r?\n/);

  console.log(`📄 Read ${lines.length} lines from file`);

  // Skip header lines (first 2 lines)
  const dataLines = lines.slice(2);

  // Group by zipcode (take first occurrence for each)
  const zipCodes = new Map();

  for (const line of dataLines) {
    if (!line.trim()) continue;

    const parts = line.split('|');
    if (parts.length < 6) continue;

    const [code, , , municipality, state, city, , stateCode, , , , , , zone] = parts;

    // Only store first occurrence per zipcode
    if (!zipCodes.has(code)) {
      zipCodes.set(code, {
        code: code.padStart(5, '0'),
        state: state.trim(),
        stateCode: stateCode?.trim() || '',
        municipality: municipality.trim(),
        city: city?.trim() || municipality.trim(),
        zone: zone?.trim() || 'Urbano',
        shippingZone: getShippingZone(state.trim(), zone?.trim())
      });
    }
  }

  console.log(`📍 Found ${zipCodes.size} unique postal codes`);

  // Clear existing data
  await ZipCode.deleteMany({});
  console.log('🗑️  Cleared existing zip codes');

  // Insert in batches
  const batchSize = 1000;
  const zipArray = Array.from(zipCodes.values());
  let inserted = 0;

  for (let i = 0; i < zipArray.length; i += batchSize) {
    const batch = zipArray.slice(i, i + batchSize);
    await ZipCode.insertMany(batch, { ordered: false });
    inserted += batch.length;
    process.stdout.write(`\r⏳ Imported ${inserted}/${zipArray.length} zip codes...`);
  }

  console.log('\n✅ Import complete!');

  // Show some stats
  const stats = await ZipCode.aggregate([
    { $group: { _id: '$shippingZone', count: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]);

  console.log('\n📊 Shipping zones breakdown:');
  stats.forEach(s => console.log(`   ${s._id}: ${s.count}`));

  await mongoose.disconnect();
}

// Run import
const filePath = process.argv[2] || '/Users/serch/Downloads/CPdescarga.txt';

if (!fs.existsSync(filePath)) {
  console.error(`❌ File not found: ${filePath}`);
  process.exit(1);
}

importZipCodes(filePath)
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Import failed:', err);
    process.exit(1);
  });
