// scripts/importMicrosipClients.js
// One-shot import: loads Microsip client records into the CRM (Conversation model)
// as manual: entries with crmName, crmPhone, crmEmail, and tags.
//
// Usage:
//   node scripts/importMicrosipClients.js --dry-run
//   node scripts/importMicrosipClients.js

require('dotenv').config();
const mongoose = require('mongoose');
const XLSX = require('xlsx');
const { randomUUID } = require('crypto');
const Conversation = require('../models/Conversation');

const DRY_RUN = process.argv.includes('--dry-run');
const FILE = '/Users/serch/Downloads/Clientes microsip.xlsx';

function cleanPhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d]/g, '');
  return digits.length >= 7 ? digits : null;
}

function cleanStr(raw) {
  if (!raw) return null;
  const s = String(raw).trim().replace(/\s+/g, ' ');
  return s || null;
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Importing Microsip clients...\n`);

  const wb = XLSX.readFile(FILE);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws);
  console.log(`Total rows in spreadsheet: ${rows.length}`);

  // Pre-load existing phones and emails for dedup
  console.log('Loading existing CRM data for dedup...');
  const existingPhones = new Set();
  const existingEmails = new Set();
  const cursor = Conversation.find({
    $or: [
      { crmPhone: { $exists: true, $ne: null } },
      { crmEmail: { $exists: true, $ne: null } }
    ]
  }).select('crmPhone crmEmail').lean().cursor();

  for await (const doc of cursor) {
    if (doc.crmPhone) existingPhones.add(doc.crmPhone);
    if (doc.crmEmail) existingEmails.add(doc.crmEmail.toLowerCase());
  }
  console.log(`Existing: ${existingPhones.size} phones, ${existingEmails.size} emails\n`);

  let imported = 0, skipped = 0, dupePhone = 0, dupeEmail = 0;
  const batch = [];

  for (const row of rows) {
    const name = cleanStr(row['Nombre']);
    const phone1 = cleanPhone(row['Teléfono 1']);
    const phone2 = cleanPhone(row['Teléfono 2']);
    const email = cleanStr(row['E-mail']);
    const vendedor = cleanStr(row['Vendedor']);
    const rfc = cleanStr(row['RFC']);
    const contacto1 = cleanStr(row['Contacto 1']);
    const contacto2 = cleanStr(row['Contacto 2']);

    if (!name && !phone1 && !email) {
      skipped++;
      continue;
    }

    // Dedup by phone
    if (phone1 && existingPhones.has(phone1)) {
      dupePhone++;
      continue;
    }
    // Dedup by email (only if no phone to dedup by)
    if (!phone1 && email && existingEmails.has(email.toLowerCase())) {
      dupeEmail++;
      continue;
    }

    // Track for intra-batch dedup
    if (phone1) existingPhones.add(phone1);
    if (email) existingEmails.add(email.toLowerCase());

    const phoneField = phone2 ? `${phone1 || ''} / ${phone2}`.trim().replace(/^\/\s*/, '') : phone1;

    const noteParts = [];
    if (vendedor) noteParts.push(`Vendedor: ${vendedor}`);
    if (rfc) noteParts.push(`RFC: ${rfc}`);
    if (contacto1) noteParts.push(`Contacto 1: ${contacto1}`);
    if (contacto2) noteParts.push(`Contacto 2: ${contacto2}`);

    const doc = {
      psid: `manual:${randomUUID().slice(0, 12)}`,
      state: 'active',
      crmName: name,
      crmPhone: phoneField || null,
      crmEmail: email || null,
      tags: ['microsip'],
      lastMessageAt: new Date()
    };

    if (noteParts.length > 0) {
      doc.notes = [{
        text: noteParts.join('\n'),
        author: 'Microsip Import',
        createdAt: new Date()
      }];
    }

    batch.push(doc);
    imported++;
  }

  console.log(`To import: ${imported}`);
  console.log(`Skipped (no data): ${skipped}`);
  console.log(`Skipped (dupe phone): ${dupePhone}`);
  console.log(`Skipped (dupe email): ${dupeEmail}`);

  if (!DRY_RUN && batch.length > 0) {
    // Insert in chunks of 500
    const CHUNK = 500;
    for (let i = 0; i < batch.length; i += CHUNK) {
      const chunk = batch.slice(i, i + CHUNK);
      await Conversation.insertMany(chunk, { ordered: false });
      console.log(`  Inserted ${Math.min(i + CHUNK, batch.length)}/${batch.length}`);
    }
    console.log(`\n✅ Imported ${batch.length} records.`);
  } else if (DRY_RUN) {
    console.log('\n[DRY RUN] No data written.');
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
