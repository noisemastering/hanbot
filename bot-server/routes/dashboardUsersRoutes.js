// routes/dashboardUsersRoutes.js
const express = require("express");
const router = express.Router();
const DashboardUser = require("../models/DashboardUser");

// GET /dashboard-users - Get all dashboard users
router.get("/", async (req, res) => {
  try {
    const users = await DashboardUser.find()
      .select("-password")
      .populate("createdBy", "username firstName lastName")
      .sort({ createdAt: -1 });

    const usersWithLabels = users.map(user => ({
      ...user.toObject(),
      fullName: user.fullName,
      roleLabel: user.getRoleLabel(),
      profileLabel: user.getProfileLabel()
    }));

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

    // Validate profile for 'user' role
    if (role === "user" && !profile) {
      return res.status(400).json({
        success: false,
        error: "Profile is required for user role"
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
      profile: role === "user" ? profile : null,
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
        roleLabel: newUser.getRoleLabel(),
        profileLabel: newUser.getProfileLabel()
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
    if (role === "user" && profile) user.profile = profile;
    if (role !== "user") user.profile = null;
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
        roleLabel: user.getRoleLabel(),
        profileLabel: user.getProfileLabel()
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

    const user = await DashboardUser.findByIdAndDelete(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

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
