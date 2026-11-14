// node scripts/uploadChecksTest.js — no DB/LLM/network (Cloudinary's uploader is stubbed).
process.env.CLOUDINARY_CLOUD_NAME = "ourcloud";
process.env.CLOUDINARY_API_KEY = "k"; process.env.CLOUDINARY_API_SECRET = "s";
const { fileKind, isImageKind } = require("../utils/fileKind");
const cfg = require("../config/cloudinary");
const { isOurCloudinaryUrl } = require("../routes/uploadsRoutes");
let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : (fail++, console.log("  ✗ " + n)); };
const B = (...parts) => Buffer.concat(parts.map((p) => (typeof p === "string" ? Buffer.from(p, "latin1") : Buffer.from(p))));
const pad = "x".repeat(32);

// ---- what a file IS ----
ok("pdf", fileKind(B("%PDF-1.7\n", pad)) === "pdf");
ok("pdf with a few leading bytes", fileKind(B("\n\n  %PDF-1.4", pad)) === "pdf");
ok("jpeg", fileKind(B([0xff, 0xd8, 0xff, 0xe0], pad)) === "jpeg");
ok("png", fileKind(B([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], pad)) === "png");
ok("webp", fileKind(B("RIFF", [1, 2, 3, 4], "WEBP", pad)) === "webp");
ok("gif", fileKind(B("GIF89a", pad)) === "gif");
ok("xlsx (zip container)", fileKind(B([0x50, 0x4b, 0x03, 0x04], pad)) === "zip");
ok("old illustrator (postscript)", fileKind(B("%!PS-Adobe-3.0", pad)) === "postscript");
// what must NOT pass, whatever it is named or labelled
ok("a Windows executable is nothing we accept", fileKind(B("MZ", [0x90, 0, 3, 0], pad)) === null);
ok("an HTML page is not a PDF", fileKind(B("<!DOCTYPE html><html><script>alert(1)</script>", pad)) === null);
ok("an SVG is not an image here", fileKind(B('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', pad)) === null);
ok("a shell script is nothing", fileKind(B("#!/bin/sh\nrm -rf /\n", pad)) === null);
ok("a RIFF that is not WEBP (wav/avi) is nothing", fileKind(B("RIFF", [1, 2, 3, 4], "WAVE", pad)) === null);
ok("%PDF far into the file does not count", fileKind(B("<html>" + "a".repeat(2000) + "%PDF-1.4")) === null);
ok("empty / tiny / non-buffer", fileKind(Buffer.alloc(0)) === null && fileKind(B("%PD")) === null && fileKind("%PDF-1.4 text") === null && fileKind(undefined) === null);
ok("image kinds", ["jpeg", "png", "webp", "gif"].every(isImageKind) && !isImageKind("pdf") && !isImageKind("zip") && !isImageKind(null));

// ---- "assign an existing catalog" accepts only our own storage ----
ok("our cloud passes", isOurCloudinaryUrl("https://res.cloudinary.com/ourcloud/raw/upload/v1/hanlob/catalogs/x.pdf"));
for (const u of [
  "https://res.cloudinary.com/someoneelse/raw/upload/v1/x.pdf",
  "http://res.cloudinary.com/ourcloud/raw/upload/v1/x.pdf",
  "https://res.cloudinary.com.example.com/ourcloud/x.pdf",
  "https://example.com/res.cloudinary.com/ourcloud/x.pdf",
  "https://example.com/x.pdf?u=https://res.cloudinary.com/ourcloud/",
  "https://res.cloudinary.com/ourcloudx/raw/upload/x.pdf",
  "https://user@evil.example/ourcloud/x.pdf",
  "javascript:alert(1)", "file:///etc/passwd", "//res.cloudinary.com/ourcloud/x.pdf", "", null, undefined, {}, 42,
]) ok("refused: " + String(u).slice(0, 52), !isOurCloudinaryUrl(u));

// ---- the catalog upload: content is checked BEFORE anything is stored ----
const stored = [];
cfg.cloudinary.uploader.upload_stream = (opts, cb) => ({ end: (buf) => { stored.push({ opts, size: buf.length }); cb(null, { secure_url: `https://res.cloudinary.com/ourcloud/raw/upload/v1/${opts.folder}/${opts.public_id}`, public_id: `${opts.folder}/${opts.public_id}` }); } });
const id = cfg.catalogPublicId("Catálogo Hanlob 2026 (final).pdf");
ok("public id is sanitised and keeps .pdf", /^[A-Za-z0-9_]+_\d+\.pdf$/.test(id));
ok("a hostile name cannot leave the folder", !/[\/\\]|\.\./.test(cfg.catalogPublicId("../../etc/passwd")) && !/[\/\\]/.test(cfg.catalogPublicId("a/b\\c.pdf")));
ok("an odd extension is stored as .pdf", cfg.catalogPublicId("x.exe").endsWith(".pdf") && cfg.catalogPublicId("x.AI").endsWith(".ai"));

// drive the real middleware with a hand-built multipart request
const http = require("http"), express = require("express");
const app = express();
app.post("/up", cfg.uploadCatalog.single("catalog"), (req, res) => res.json({ got: !!req.file, path: req.file && req.file.path, filename: req.file && req.file.filename, name: req.file && req.file.originalname, hasBuffer: !!(req.file && req.file.buffer) }));
app.use((err, req, res, next) => res.status(400).json({ error: err.code || err.message }));
const post = (port, filename, type, content) => new Promise((resolve) => {
  const bd = "----t" + Date.now();
  const body = content === null ? Buffer.from(`--${bd}--\r\n`) : Buffer.concat([Buffer.from(`--${bd}\r\nContent-Disposition: form-data; name="catalog"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`), content, Buffer.from(`\r\n--${bd}--\r\n`)]);
  const r = http.request({ port, path: "/up", method: "POST", headers: { "Content-Type": `multipart/form-data; boundary=${bd}`, "Content-Length": body.length } }, (x) => { let d = ""; x.on("data", (c) => (d += c)); x.on("end", () => resolve({ code: x.statusCode, json: JSON.parse(d || "{}") })); });
  r.end(body);
});
const srv = app.listen(0, async () => {
  const port = srv.address().port;
  let r = await post(port, "catalogo.pdf", "application/pdf", B("%PDF-1.4\n", pad));
  ok("a real PDF is stored and req.file keeps its shape", r.code === 200 && r.json.got && /^https:\/\/res\.cloudinary\.com\/ourcloud\//.test(r.json.path) && r.json.filename.startsWith("hanlob/catalogs/") && r.json.name === "catalogo.pdf" && !r.json.hasBuffer && stored.length === 1);
  ok("…as a raw file in the catalogs folder", stored[0].opts.resource_type === "raw" && stored[0].opts.folder === "hanlob/catalogs");
  r = await post(port, "catalogo.pdf", "application/pdf", B("MZ", [0x90, 0, 3, 0], pad));
  ok("an executable named .pdf and labelled PDF is refused", r.code === 400 && stored.length === 1);
  r = await post(port, "catalogo.pdf", "application/pdf", B("<html><script>alert(1)</script></html>", pad));
  ok("an HTML page named .pdf is refused, nothing stored", r.code === 400 && stored.length === 1);
  r = await post(port, "x.pdf", "application/pdf", null);
  ok("no file: the route still gets to answer", r.code === 200 && r.json.got === false);
  r = await post(port, "big.pdf", "application/pdf", B("%PDF-1.4\n", Buffer.alloc(11 * 1024 * 1024)));
  ok("over 10 MB is refused", r.code === 400 && stored.length === 1);
  srv.close();
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
});
