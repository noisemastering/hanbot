const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const DATA_FILE = path.join(__dirname, 'clicks.json');

// ensure file exists
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify([]));

function generateClickLink(psid, productUrl, productName) {
  const clickId = randomUUID().slice(0, 8);
  const entry = {
    id: clickId,
    psid,
    productUrl,
    productName,
    timestamp: new Date().toISOString()
  };

  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  data.push(entry);
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

  // Replace base URL later with your deployed server or ngrok URL
  return `https://YOUR_DOMAIN.ngrok-free.app/r/${clickId}`;
}

function getClickData(clickId) {
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  return data.find((c) => c.id === clickId);
}

module.exports = { generateClickLink, getClickData };
