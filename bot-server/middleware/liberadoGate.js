// middleware/liberadoGate.js
//
// Release gate. While Liberado is OFF (Spec Ops), the wrapped route is available
// ONLY to super_admin. Once Liberado is ON (released), the route falls through to
// its normal permissions for everyone. Mount AFTER the route's authenticate
// middleware (needs req.user). Fail-CLOSED: any read error keeps it restricted.
const { isLiberado } = require("../utils/systemState");

async function requireLiberadoOrSuperAdmin(req, res, next) {
  try {
    if (await isLiberado()) return next(); // released → normal permissions apply
  } catch (_) {
    /* fall through to the super_admin check (fail-closed) */
  }
  if (req.user && req.user.role === "super_admin") return next();
  return res.status(403).json({
    success: false,
    error: "Esta función está disponible solo para Super Admin hasta su liberación (Spec Ops · Liberado).",
    liberadoGated: true,
  });
}

module.exports = { requireLiberadoOrSuperAdmin };
