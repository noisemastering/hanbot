const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const DashboardUser = require("../models/DashboardUser");
const CompanyInfo = require("../models/CompanyInfo");

const JWT_SECRET = process.env.JWT_SECRET || "your-super-secret-jwt-key-change-in-production";

const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ success: false, error: "No token provided" });
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await DashboardUser.findById(decoded.id).select("-password");
    if (!user || !user.active) return res.status(401).json({ success: false, error: "Invalid token" });
    req.user = user;
    next();
  } catch { return res.status(401).json({ success: false, error: "Invalid or expired token" }); }
};

const requireAdmin = (req, res, next) => {
  const role = req.user?.role;
  if (role !== 'super_admin' && role !== 'admin') {
    return res.status(403).json({ success: false, error: "Admin access required" });
  }
  next();
};

// GET /company-info — Get company info (everyone can read)
router.get("/", authenticate, async (req, res) => {
  try {
    let info = await CompanyInfo.findById('hanlob').lean();
    if (!info) {
      // Create default
      info = await CompanyInfo.create({
        _id: 'hanlob',
        name: 'Hanlob',
        tagline: 'Fabricante mexicano de malla sombra',
        phones: [
          { label: 'Ventas', number: '' },
          { label: 'WhatsApp', number: '' }
        ],
        emails: [{ label: 'General', email: '' }],
        schedule: [
          { day: 'Lunes', open: '08:00', close: '18:00', closed: false },
          { day: 'Martes', open: '08:00', close: '18:00', closed: false },
          { day: 'Miércoles', open: '08:00', close: '18:00', closed: false },
          { day: 'Jueves', open: '08:00', close: '18:00', closed: false },
          { day: 'Viernes', open: '08:00', close: '18:00', closed: false },
          { day: 'Sábado', open: '09:00', close: '14:00', closed: false },
          { day: 'Domingo', open: '', close: '', closed: true }
        ]
      });
      info = info.toObject();
    }
    res.json({ success: true, data: info });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /company-info — Update company info (admin+ only)
router.put("/", authenticate, requireAdmin, async (req, res) => {
  try {
    const update = { ...req.body, lastEditedBy: req.user._id, lastEditedAt: new Date() };
    delete update._id; // Don't allow changing the ID

    const info = await CompanyInfo.findByIdAndUpdate(
      'hanlob',
      { $set: update },
      { new: true, upsert: true, runValidators: true }
    ).lean();

    res.json({ success: true, data: info });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
