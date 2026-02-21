// jobs/healthCheck.js
// Periodic health check for the tracking redirect domain
// Sends email alert when SSL, DNS, or HTTP issues are detected

const https = require('https');
const http = require('http');
const { sendAlertEmail } = require('../utils/emailService');

const ALERT_EMAIL = 'noisemastering@gmail.com';
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const COOLDOWN_MS = 30 * 60 * 1000; // Don't re-alert for 30 minutes after an alert

let lastAlertSentAt = 0;
let consecutiveFailures = 0;
let lastStatus = 'ok'; // 'ok' or 'down'

/**
 * Check if a URL is reachable (DNS resolves, SSL valid, HTTP 200/302)
 */
function checkUrl(url) {
  return new Promise((resolve) => {
    const protocol = url.startsWith('https') ? https : http;
    const req = protocol.get(url, { timeout: 10000 }, (res) => {
      resolve({
        ok: res.statusCode < 500,
        statusCode: res.statusCode,
        error: null
      });
      res.resume(); // Consume response to free memory
    });

    req.on('error', (err) => {
      let category = 'UNKNOWN';
      if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') {
        category = 'DNS';
      } else if (err.code === 'CERT_HAS_EXPIRED' || err.code === 'ERR_TLS_CERT_ALTNAME_INVALID' ||
                 err.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || err.message?.includes('SSL') ||
                 err.message?.includes('certificate')) {
        category = 'SSL';
      } else if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET') {
        category = 'CONNECTION';
      } else if (err.code === 'ETIMEDOUT' || err.code === 'ESOCKETTIMEDOUT') {
        category = 'TIMEOUT';
      }

      resolve({
        ok: false,
        statusCode: null,
        error: err.message,
        errorCode: err.code,
        category
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        ok: false,
        statusCode: null,
        error: 'Request timed out (10s)',
        errorCode: 'TIMEOUT',
        category: 'TIMEOUT'
      });
    });
  });
}

/**
 * Run one health check cycle
 */
async function runHealthCheck() {
  const baseUrl = process.env.BASE_URL;
  if (!baseUrl) {
    return; // No BASE_URL configured, skip
  }

  // Check the root domain (not a tracking link — just verify the server responds)
  const healthUrl = `${baseUrl}/health`;
  const result = await checkUrl(healthUrl);

  if (result.ok) {
    if (lastStatus === 'down') {
      console.log(`✅ Tracking domain recovered (was down for ${consecutiveFailures} checks)`);
      // Send recovery email
      const now = Date.now();
      if (now - lastAlertSentAt > COOLDOWN_MS) {
        sendAlertEmail(
          ALERT_EMAIL,
          '✅ Hanlob Bot — Tracking domain recovered',
          `The tracking domain (${baseUrl}) is back online.\n\n` +
          `It was down for ${consecutiveFailures} consecutive checks.\n` +
          `Time: ${new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}`
        ).catch(err => console.error('❌ Recovery email failed:', err.message));
        lastAlertSentAt = now;
      }
    }
    consecutiveFailures = 0;
    lastStatus = 'ok';
    return;
  }

  // Failed
  consecutiveFailures++;
  console.warn(`⚠️ Health check failed (${consecutiveFailures}x): ${result.category || 'ERROR'} — ${result.error}`);

  // Alert after 2 consecutive failures (avoid false positives from transient blips)
  if (consecutiveFailures >= 2 && lastStatus !== 'down') {
    lastStatus = 'down';
    const now = Date.now();

    if (now - lastAlertSentAt > COOLDOWN_MS) {
      lastAlertSentAt = now;

      const subject = `🚨 Hanlob Bot — Tracking domain DOWN (${result.category || 'ERROR'})`;
      const body =
        `The tracking redirect domain is not reachable.\n\n` +
        `Domain: ${baseUrl}\n` +
        `Error: ${result.error}\n` +
        `Error code: ${result.errorCode || 'N/A'}\n` +
        `Category: ${result.category || 'UNKNOWN'}\n` +
        `Consecutive failures: ${consecutiveFailures}\n` +
        `Time: ${new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}\n\n` +
        `This means tracked links (agente.hanlob.com.mx/r/...) sent to customers are NOT working.\n` +
        `Customers clicking these links will get an error.\n\n` +
        `Check:\n` +
        `- Railway deployment status\n` +
        `- SSL certificate on agente.hanlob.com.mx\n` +
        `- DNS records for agente.hanlob.com.mx`;

      sendAlertEmail(ALERT_EMAIL, subject, body).catch(err => {
        console.error('❌ Alert email failed:', err.message);
      });

      console.log(`📧 Alert email sent to ${ALERT_EMAIL}`);
    } else {
      console.log(`⏳ Alert suppressed (cooldown active, last sent ${Math.round((now - lastAlertSentAt) / 60000)}min ago)`);
    }
  }
}

/**
 * Start the periodic health check
 */
function startHealthCheck() {
  const baseUrl = process.env.BASE_URL;
  if (!baseUrl) {
    console.log('⏭️ Health check skipped — no BASE_URL configured');
    return;
  }

  console.log(`🏥 Health check started for ${baseUrl} (every ${CHECK_INTERVAL_MS / 60000}min)`);
  runHealthCheck(); // Run immediately
  setInterval(runHealthCheck, CHECK_INTERVAL_MS);
}

module.exports = { startHealthCheck, runHealthCheck };
