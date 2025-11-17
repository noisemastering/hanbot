// routes/rolesRoutes.js
const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const Role = require("../models/Role");
const DashboardUser = require("../models/DashboardUser");

const JWT_SECRET = process.env.JWT_SECRET || "your-super-secret-jwt-key-change-in-production";

// Authentication middleware
const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) {
      return res.status(401).json({ success: false, error: "No token provided" });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await DashboardUser.findById(decoded.id).select("-password");

    if (!user || !user.active) {
      return res.status(401).json({ success: false, error: "Invalid token or inactive user" });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, error: "Invalid or expired token" });
  }
};

// Authorization middleware - only super_admin can manage roles
const requireSuperAdmin = (req, res, next) => {
  if (req.user.role !== "super_admin") {
    return res.status(403).json({
      success: false,
      error: "Only Super Admin can manage roles"
    });
  }
  next();
};

// Apply authentication to all routes
router.use(authenticate);
router.use(requireSuperAdmin);

// GET /roles - Get all roles
router.get("/", async (req, res) => {
  try {
    const roles = await Role.find()
      .populate("createdBy", "username firstName lastName")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      roles
    });
  } catch (error) {
    console.error("Error fetching roles:", error);
    res.status(500).json({
      success: false,
      error: "Error fetching roles"
    });
  }
});

// POST /roles - Create a new role
router.post("/", async (req, res) => {
  try {
    const { name, label, description, permissions, allowsProfiles } = req.body;

    // Validate required fields
    if (!name || !label) {
      return res.status(400).json({
        success: false,
        error: "Name and label are required"
      });
    }

    // Check if role with same name already exists
    const existing = await Role.findOne({ name: name.toLowerCase() });
    if (existing) {
      return res.status(400).json({
        success: false,
        error: "Role with this name already exists"
      });
    }

    // Create new role
    const newRole = new Role({
      name: name.toLowerCase(),
      label,
      description: description || "",
      permissions: permissions || [],
      allowsProfiles: allowsProfiles || false,
      isSystem: false,
      createdBy: req.user._id
    });

    await newRole.save();

    res.json({
      success: true,
      role: newRole
    });
  } catch (error) {
    console.error("Error creating role:", error);
    res.status(500).json({
      success: false,
      error: "Error creating role"
    });
  }
});

// PUT /roles/:id - Update a role
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { label, description, permissions, allowsProfiles, active } = req.body;

    const role = await Role.findById(id);
    if (!role) {
      return res.status(404).json({
        success: false,
        error: "Role not found"
      });
    }

    // Cannot modify system role name
    if (role.isSystem && req.body.name) {
      return res.status(403).json({
        success: false,
        error: "Cannot modify system role name"
      });
    }

    // Update fields
    if (label) role.label = label;
    if (description !== undefined) role.description = description;
    if (permissions) role.permissions = permissions;
    if (typeof allowsProfiles === "boolean") role.allowsProfiles = allowsProfiles;
    if (typeof active === "boolean") role.active = active;

    await role.save();

    res.json({
      success: true,
      role
    });
  } catch (error) {
    console.error("Error updating role:", error);
    res.status(500).json({
      success: false,
      error: "Error updating role"
    });
  }
});

// DELETE /roles/:id - Delete a role
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const role = await Role.findById(id);
    if (!role) {
      return res.status(404).json({
        success: false,
        error: "Role not found"
      });
    }

    // Cannot delete system roles
    if (role.isSystem) {
      return res.status(403).json({
        success: false,
        error: "Cannot delete system role"
      });
    }

    // Check if any users have this role
    const usersWithRole = await DashboardUser.countDocuments({ role: role.name });
    if (usersWithRole > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot delete role. ${usersWithRole} user(s) still have this role.`
      });
    }

    await role.deleteOne();

    res.json({
      success: true,
      message: "Role deleted successfully"
    });
  } catch (error) {
    console.error("Error deleting role:", error);
    res.status(500).json({
      success: false,
      error: "Error deleting role"
    });
  }
});

module.exports = router;
