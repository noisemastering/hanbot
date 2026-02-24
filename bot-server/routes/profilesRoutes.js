// routes/profilesRoutes.js
const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const Profile = require("../models/Profile");
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

// Authorization middleware - super_admin and admin can manage profiles
const requireAdmin = (req, res, next) => {
  if (req.user.role !== "super_admin" && req.user.role !== "admin") {
    return res.status(403).json({
      success: false,
      error: "Only Super Admin or Admin can manage profiles"
    });
  }
  next();
};

// Apply authentication to all routes
router.use(authenticate);
router.use(requireAdmin);

// GET /profiles - Get all profiles
router.get("/", async (req, res) => {
  try {
    const profiles = await Profile.find()
      .populate("role", "name label")
      .populate("createdBy", "username firstName lastName")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: profiles
    });
  } catch (error) {
    console.error("Error fetching profiles:", error);
    res.status(500).json({
      success: false,
      error: "Error fetching profiles"
    });
  }
});

// GET /profiles/by-role/:roleId - Get profiles for a specific role
router.get("/by-role/:roleId", async (req, res) => {
  try {
    const { roleId } = req.params;

    const profiles = await Profile.find({ role: roleId, active: true })
      .populate("role", "name label")
      .sort({ label: 1 });

    res.json({
      success: true,
      profiles
    });
  } catch (error) {
    console.error("Error fetching profiles by role:", error);
    res.status(500).json({
      success: false,
      error: "Error fetching profiles"
    });
  }
});

// GET /profiles/:id - Get a single profile by ID
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const profile = await Profile.findById(id)
      .populate("role", "name label")
      .populate("createdBy", "username firstName lastName");

    if (!profile) {
      return res.status(404).json({
        success: false,
        error: "Profile not found"
      });
    }

    res.json({
      success: true,
      profile
    });
  } catch (error) {
    console.error("Error fetching profile:", error);
    res.status(500).json({
      success: false,
      error: "Error fetching profile"
    });
  }
});

// POST /profiles - Create a new profile
router.post("/", async (req, res) => {
  try {
    const { name, label, description, role, permissions, landingPage } = req.body;

    // Validate required fields
    if (!name || !label || !role) {
      return res.status(400).json({
        success: false,
        error: "Name, label, and role are required"
      });
    }

    // Check if profile with same name already exists
    const existing = await Profile.findOne({ name: name.toLowerCase() });
    if (existing) {
      return res.status(400).json({
        success: false,
        error: "Profile with this name already exists"
      });
    }

    // Verify role exists and allows profiles
    const roleDoc = await Role.findById(role);
    if (!roleDoc) {
      return res.status(400).json({
        success: false,
        error: "Role not found"
      });
    }

    if (!roleDoc.allowsProfiles) {
      return res.status(400).json({
        success: false,
        error: "This role does not allow profiles"
      });
    }

    // Create new profile
    const newProfile = new Profile({
      name: name.toLowerCase(),
      label,
      description: description || "",
      role,
      permissions: permissions || [],
      landingPage: landingPage || null,
      isSystem: false,
      createdBy: req.user._id
    });

    await newProfile.save();

    // Populate role before sending response
    await newProfile.populate("role", "name label");

    res.json({
      success: true,
      profile: newProfile
    });
  } catch (error) {
    console.error("Error creating profile:", error);
    res.status(500).json({
      success: false,
      error: "Error creating profile"
    });
  }
});

// PUT /profiles/:id - Update a profile
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { label, description, permissions, active, landingPage } = req.body;

    const profile = await Profile.findById(id).populate("role");
    if (!profile) {
      return res.status(404).json({
        success: false,
        error: "Profile not found"
      });
    }

    // Cannot modify system profile name or role (only if actually changed)
    if (profile.isSystem) {
      const nameChanged = req.body.name && req.body.name !== profile.name;
      const roleChanged = req.body.role && req.body.role !== profile.role._id.toString();

      if (nameChanged || roleChanged) {
        return res.status(403).json({
          success: false,
          error: "Cannot modify system profile name or role"
        });
      }
    }

    // Detect new permissions being added
    const oldPermissions = profile.permissions || [];
    const newPermissions = permissions || [];
    const addedPermissions = newPermissions.filter(p => !oldPermissions.includes(p) && p !== '*');

    // Update fields
    if (label) profile.label = label;
    if (description !== undefined) profile.description = description;
    if (permissions) profile.permissions = permissions;
    if (landingPage !== undefined) profile.landingPage = landingPage;
    if (typeof active === "boolean") profile.active = active;

    await profile.save();
    await profile.populate("role", "name label");

    // Propagate new permissions to higher-level roles
    if (addedPermissions.length > 0) {
      await propagatePermissionsToHigherRoles(profile.role.name, addedPermissions);
    }

    res.json({
      success: true,
      profile
    });
  } catch (error) {
    console.error("Error updating profile:", error);
    res.status(500).json({
      success: false,
      error: "Error updating profile"
    });
  }
});

// DELETE /profiles/:id - Delete a profile
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const profile = await Profile.findById(id);
    if (!profile) {
      return res.status(404).json({
        success: false,
        error: "Profile not found"
      });
    }

    // Cannot delete system profiles
    if (profile.isSystem) {
      return res.status(403).json({
        success: false,
        error: "Cannot delete system profile"
      });
    }

    // Check if any users have this profile
    const usersWithProfile = await DashboardUser.countDocuments({ profile: profile.name });
    if (usersWithProfile > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot delete profile. ${usersWithProfile} user(s) still have this profile.`
      });
    }

    await profile.deleteOne();

    res.json({
      success: true,
      message: "Profile deleted successfully"
    });
  } catch (error) {
    console.error("Error deleting profile:", error);
    res.status(500).json({
      success: false,
      error: "Error deleting profile"
    });
  }
});

// Helper function to propagate permissions to higher-level roles
async function propagatePermissionsToHigherRoles(currentRoleName, newPermissions) {
  try {
    // Define role hierarchy (lower to higher)
    const roleHierarchy = {
      'salesman': ['manager', 'admin', 'super_admin'],
      'manager': ['admin', 'super_admin'],
      'admin': ['super_admin'],
      'super_admin': []
    };

    const higherRoles = roleHierarchy[currentRoleName] || [];

    if (higherRoles.length === 0) {
      return; // No roles to propagate to
    }

    console.log(`📤 Propagating permissions [${newPermissions.join(', ')}] from role "${currentRoleName}" to higher roles: [${higherRoles.join(', ')}]`);

    // Add permissions to all higher-level roles
    for (const roleName of higherRoles) {
      const role = await Role.findOne({ name: roleName });
      if (role) {
        // Add new permissions that don't already exist
        const permissionsToAdd = newPermissions.filter(p => !role.permissions.includes(p));

        if (permissionsToAdd.length > 0) {
          role.permissions = [...role.permissions, ...permissionsToAdd];
          await role.save();
          console.log(`✅ Added permissions [${permissionsToAdd.join(', ')}] to role "${roleName}"`);
        }

        // Also propagate to all profiles under this role
        const profiles = await Profile.find({ role: role._id });
        for (const profile of profiles) {
          const profilePermissionsToAdd = newPermissions.filter(p => !profile.permissions.includes(p));

          if (profilePermissionsToAdd.length > 0) {
            profile.permissions = [...profile.permissions, ...profilePermissionsToAdd];
            await profile.save();
            console.log(`✅ Added permissions [${profilePermissionsToAdd.join(', ')}] to profile "${profile.name}"`);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error propagating permissions:', error);
  }
}

module.exports = router;
