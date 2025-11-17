// routes/dashboardUsersRoutes.js
const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
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

// Apply authentication to all routes
router.use(authenticate);

// GET /dashboard-users - Get all dashboard users
router.get("/", async (req, res) => {
  try {
    const users = await DashboardUser.find()
      .select("-password")
      .populate("createdBy", "username firstName lastName")
      .sort({ createdAt: -1 });

    const usersWithLabels = await Promise.all(
      users.map(async (user) => ({
        ...user.toObject(),
        fullName: user.fullName,
        roleLabel: await user.getRoleLabel(),
        profileLabel: await user.getProfileLabel()
      }))
    );

    res.json({
      success: true,
      users: usersWithLabels
    });
  } catch (error) {
    console.error("Error fetching dashboard users:", error);
    res.status(500).json({
      success: false,
      error: "Error fetching users"
    });
  }
});

// POST /dashboard-users - Create a new dashboard user
router.post("/", async (req, res) => {
  try {
    const { username, email, password, firstName, lastName, role, profile, createdBy } = req.body;

    // Validate required fields
    if (!username || !email || !password || !firstName || !lastName || !role) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields"
      });
    }

    // Authorization check: Admins cannot create super_admin or admin roles
    if (req.user.role === "admin" && (role === "super_admin" || role === "admin")) {
      return res.status(403).json({
        success: false,
        error: "You do not have permission to create users with this role"
      });
    }

    // Check if username or email already exists
    const existing = await DashboardUser.findOne({
      $or: [{ username }, { email }]
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        error: existing.username === username
          ? "Username already exists"
          : "Email already exists"
      });
    }

    // Validate profile for 'user' and 'super_user' roles
    if ((role === "user" || role === "super_user") && !profile) {
      return res.status(400).json({
        success: false,
        error: "Profile is required for this role"
      });
    }

    // Create new user
    const newUser = new DashboardUser({
      username,
      email,
      password,
      firstName,
      lastName,
      role,
      profile: (role === "user" || role === "super_user") ? profile : null,
      createdBy
    });

    await newUser.save();

    // Remove password from response
    const userResponse = newUser.toObject();
    delete userResponse.password;

    res.json({
      success: true,
      user: {
        ...userResponse,
        fullName: newUser.fullName,
        roleLabel: await newUser.getRoleLabel(),
        profileLabel: await newUser.getProfileLabel()
      }
    });
  } catch (error) {
    console.error("Error creating dashboard user:", error);
    res.status(500).json({
      success: false,
      error: "Error creating user"
    });
  }
});

// PUT /dashboard-users/:id - Update a dashboard user
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { username, email, firstName, lastName, role, profile, active, password } = req.body;

    const user = await DashboardUser.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    // Authorization check: Admins cannot edit super_admin or admin users
    if (req.user.role === "admin" && (user.role === "super_admin" || user.role === "admin")) {
      return res.status(403).json({
        success: false,
        error: "You do not have permission to edit this user"
      });
    }

    // Authorization check: Admins cannot promote users to super_admin or admin
    if (req.user.role === "admin" && role && (role === "super_admin" || role === "admin")) {
      return res.status(403).json({
        success: false,
        error: "You do not have permission to assign this role"
      });
    }

    // Check for duplicate username/email (excluding current user)
    if (username && username !== user.username) {
      const existingUsername = await DashboardUser.findOne({ username });
      if (existingUsername) {
        return res.status(400).json({
          success: false,
          error: "Username already exists"
        });
      }
      user.username = username;
    }

    if (email && email !== user.email) {
      const existingEmail = await DashboardUser.findOne({ email });
      if (existingEmail) {
        return res.status(400).json({
          success: false,
          error: "Email already exists"
        });
      }
      user.email = email;
    }

    // Update fields
    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (role) user.role = role;

    // Update profile based on current or new role
    const finalRole = role || user.role;
    if (profile !== undefined) {
      if (finalRole === "user" || finalRole === "super_user") {
        user.profile = profile;
      } else {
        user.profile = null;
      }
    }

    if (typeof active === "boolean") user.active = active;

    // Update password if provided
    if (password) {
      user.password = password; // Will be hashed by pre-save hook
    }

    await user.save();

    // Remove password from response
    const userResponse = user.toObject();
    delete userResponse.password;

    res.json({
      success: true,
      user: {
        ...userResponse,
        fullName: user.fullName,
        roleLabel: await user.getRoleLabel(),
        profileLabel: await user.getProfileLabel()
      }
    });
  } catch (error) {
    console.error("Error updating dashboard user:", error);
    res.status(500).json({
      success: false,
      error: "Error updating user"
    });
  }
});

// DELETE /dashboard-users/:id - Delete a dashboard user
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const user = await DashboardUser.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    // Authorization check: Admins cannot delete super_admin or admin users
    if (req.user.role === "admin" && (user.role === "super_admin" || user.role === "admin")) {
      return res.status(403).json({
        success: false,
        error: "You do not have permission to delete this user"
      });
    }

    await user.deleteOne();

    res.json({
      success: true,
      message: "User deleted successfully"
    });
  } catch (error) {
    console.error("Error deleting dashboard user:", error);
    res.status(500).json({
      success: false,
      error: "Error deleting user"
    });
  }
});

module.exports = router;
