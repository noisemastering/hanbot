// What a file IS, read from its first bytes — never from its name or the Content-Type
// the uploader chose to send. Both of those are typed by the caller: a script renamed
// "catalogo.pdf" and labelled application/pdf was accepted as a PDF, uploaded, and (for
// a conversation attachment) delivered to a customer as a document from Hanlob.
//
// Returns one of: "pdf" | "jpeg" | "png" | "webp" | "gif" | "zip" | "postscript" | null.
// SVG is deliberately NOT recognised as an image: it is a text document that can carry
// script, and `mimetype.startsWith("image/")` used to let it through.
function fileKind(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) return null;
  const starts = (...bytes) => bytes.every((b, i) => buf[i] === b);
  const ascii = (from, len) => buf.toString("latin1", from, from + len);
  // A PDF's "%PDF-" may sit after a few stray bytes; readers accept it in the first 1 KB.
  if (ascii(0, Math.min(buf.length, 1024)).includes("%PDF-")) return "pdf";
  if (starts(0xff, 0xd8, 0xff)) return "jpeg";
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
  if (ascii(0, 4) === "RIFF" && buf.length >= 12 && ascii(8, 4) === "WEBP") return "webp";
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return "gif";
  if (starts(0x50, 0x4b, 0x03, 0x04)) return "zip"; // .xlsx / .docx are zip containers
  if (ascii(0, 4) === "%!PS") return "postscript";  // older Illustrator .ai
  return null;
}

const IMAGE_KINDS = new Set(["jpeg", "png", "webp", "gif"]);
const isImageKind = (k) => IMAGE_KINDS.has(k);

module.exports = { fileKind, isImageKind };
