// scripts/fbConnect.js
//
// One-time "Connect Facebook" tool for the App Review screencast + to grant the
// comment permissions to the app. Runs an ISOLATED mini-server on :3005 (does NOT
// touch the production bot). Flow:
//   1. Open http://localhost:3005  → click "Connect Facebook"
//   2. Facebook popup → Allow (grants pages_read_engagement + pages_manage_engagement)
//   3. It reads your page's recent comments (proves READ works) and lets you REPLY
//      to one (proves WRITE works) — that whole flow IS the screencast.
//
// PREREQ (Meta app settings, one time):
//   Facebook app → "Facebook Login for Business" product must be ADDED, and under its
//   Settings, add this to "Valid OAuth Redirect URIs":  http://localhost:3005/callback
//
//   node scripts/fbConnect.js
require("dotenv").config();
const express = require("express");
const axios = require("axios");

const GV = "v18.0";
const APP_ID = process.env.FB_APP_ID || "1555790368916637";
const APP_SECRET = process.env.FB_APP_SECRET;
const PORT = 3005;
const REDIRECT = `http://localhost:${PORT}/callback`;
const PAGE_ID = process.env.FB_PAGE_ID || "107904754369892";
// The two permissions we're proving (+ the ones the app already uses).
const SCOPES = [
  "pages_show_list",
  "pages_read_engagement",   // READ comments
  "pages_manage_engagement", // REPLY to comments
  "pages_messaging",
  "pages_manage_metadata",
].join(",");

let PAGE = { token: null, id: PAGE_ID, name: null }; // filled after connect

const page = (title, body) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font-family:system-ui;max-width:680px;margin:40px auto;padding:0 16px;line-height:1.5;color:#111">` +
  `<h2>${title}</h2>${body}</body>`;
const btn = (href, label, color = "#1877f2") =>
  `<a href="${href}" style="display:inline-block;background:${color};color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;margin:6px 0">${label}</a>`;

const app = express();

// 1) Landing — the button you click (and film)
app.get("/", (req, res) => {
  res.send(page("Conectar Facebook — Hanlob", `
    <p>Este paso le da al bot permiso para <b>leer y responder comentarios</b> de tu página.</p>
    <p>${btn("/connect", "🔵 Conectar con Facebook")}</p>
    <p style="color:#666;font-size:14px">Se abrirá la ventana de permisos de Facebook. Dale <b>Aceptar / Continuar</b>.</p>`));
});

// 2) Kick off the OAuth grant (the permission popup)
app.get("/connect", (req, res) => {
  const url =
    `https://www.facebook.com/${GV}/dialog/oauth` +
    `?client_id=${APP_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT)}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&response_type=code`;
  res.redirect(url);
});

// 3) Facebook returns here with ?code — exchange it, grab the PAGE token, and show
//    the granted permissions + a READ test.
app.get("/callback", async (req, res) => {
  const { code, error, error_description } = req.query;
  if (error) return res.send(page("No se otorgó el permiso", `<p style="color:#c00">${error}: ${error_description || ""}</p>${btn("/", "Reintentar")}`));
  try {
    const tok = await axios.get(`https://graph.facebook.com/${GV}/oauth/access_token`, {
      params: { client_id: APP_ID, redirect_uri: REDIRECT, client_secret: APP_SECRET, code },
    });
    const userToken = tok.data.access_token;
    const perms = await axios.get(`https://graph.facebook.com/${GV}/me/permissions`, { params: { access_token: userToken } });
    const granted = (perms.data.data || []).filter((p) => p.status === "granted").map((p) => p.permission);
    const accts = await axios.get(`https://graph.facebook.com/${GV}/me/accounts`, { params: { access_token: userToken } });
    const acct = (accts.data.data || []).find((p) => p.id === PAGE_ID) || (accts.data.data || [])[0];
    if (!acct) return res.send(page("Sin página", `<p>La cuenta no administra ninguna página.</p>`));
    PAGE = { token: acct.access_token, id: acct.id, name: acct.name };

    const has = (p) => granted.includes(p);
    const chk = (p) => `${has(p) ? "✅" : "❌"} <code>${p}</code>`;
    res.send(page("¡Conectado! ✅", `
      <p>Página: <b>${PAGE.name}</b></p>
      <p><b>Permisos otorgados:</b><br>${chk("pages_read_engagement")} (leer comentarios)<br>${chk("pages_manage_engagement")} (responder comentarios)</p>
      <p>${btn("/comments", "📥 Leer los comentarios de la página")}</p>
      <p style="color:#666;font-size:13px">Si ves ✅ en los dos, el bloqueo (#200) quedó resuelto para tu cuenta y esto es lo que grabas para la revisión.</p>`));
  } catch (e) {
    res.send(page("Error al canjear el código", `<pre style="white-space:pre-wrap;color:#c00">${JSON.stringify(e.response?.data || e.message, null, 2)}</pre>`));
  }
});

// 4) READ test — list recent comments (proves pages_read_engagement) with a Reply button each
app.get("/comments", async (req, res) => {
  if (!PAGE.token) return res.send(page("Conecta primero", btn("/", "Conectar")));
  try {
    const feed = await axios.get(`https://graph.facebook.com/${GV}/${PAGE.id}/posts`, {
      params: { fields: "id,message,comments.limit(5){id,message,from,created_time}", limit: 8, access_token: PAGE.token },
    });
    const rows = [];
    for (const post of feed.data.data || []) {
      for (const c of (post.comments?.data || [])) {
        rows.push(`<li style="margin:10px 0"><b>${c.from?.name || "?"}</b>: "${(c.message || "").replace(/</g, "&lt;")}"<br>${btn(`/reply?id=${encodeURIComponent(c.id)}`, "↩︎ Responder (prueba)", "#42b72a")}</li>`);
      }
    }
    res.send(page(`✅ Leídos ${rows.length} comentarios`, rows.length
      ? `<p>Esto prueba <b>pages_read_engagement</b>. Elige uno y responde para probar <b>pages_manage_engagement</b>:</p><ul>${rows.join("")}</ul>`
      : `<p>No hay comentarios recientes para probar.</p>`));
  } catch (e) {
    res.send(page("Error leyendo comentarios", `<pre style="white-space:pre-wrap;color:#c00">${JSON.stringify(e.response?.data?.error || e.message, null, 2)}</pre>`));
  }
});

// 5) WRITE test — reply to the chosen comment (proves pages_manage_engagement)
app.get("/reply", async (req, res) => {
  if (!PAGE.token) return res.send(page("Conecta primero", btn("/", "Conectar")));
  const id = req.query.id;
  try {
    const r = await axios.post(`https://graph.facebook.com/${GV}/${id}/comments`,
      { message: "¡Hola! 😊 Con gusto te ayudamos con la información. — Malla Sombra Hanlob" },
      { params: { access_token: PAGE.token } });
    res.send(page("✅ ¡Respuesta publicada!", `<p>Se publicó la respuesta al comentario (id de respuesta: <code>${r.data.id}</code>).</p><p>Esto prueba <b>pages_manage_engagement</b>. Ya tienes tu grabación completa: conectar → leer → responder.</p>${btn("/comments", "Volver a comentarios")}`));
  } catch (e) {
    res.send(page("Error al responder", `<pre style="white-space:pre-wrap;color:#c00">${JSON.stringify(e.response?.data?.error || e.message, null, 2)}</pre>`));
  }
});

app.listen(PORT, () => {
  console.log(`\n🔵 FB connect tool → open http://localhost:${PORT}`);
  console.log(`   Redirect URI to register in the FB app: ${REDIRECT}\n`);
});
