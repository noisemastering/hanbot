// routes/authRoutes.js
const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const DashboardUser = require("../models/DashboardUser");

const JWT_SECRET = process.env.JWT_SECRET || "your-super-secret-jwt-key-change-in-production";
const JWT_EXPIRES_IN = "7d"; // Token expires in 7 days

// POST /auth/login - Login
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    // Validate input
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: "Username and password are required"
      });
    }

    // Find user
    const user = await DashboardUser.findOne({ username });
    if (!user) {
      return res.status(401).json({
        success: false,
        error: "Invalid credentials"
      });
    }

    // Check if user is active
    if (!user.active) {
      return res.status(403).json({
        success: false,
        error: "Account is inactive. Please contact an administrator."
      });
    }

    // Verify password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: "Invalid credentials"
      });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate JWT token
    const token = jwt.sign(
      {
        id: user._id,
        username: user.username,
        role: user.role,
        profile: user.profile
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Send response
    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: user.fullName,
        role: user.role,
        roleLabel: await user.getRoleLabel(),
        profile: user.profile,
        profileLabel: await user.getProfileLabel()
      }
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      success: false,
      error: "Server error during login"
    });
  }
});

// GET /auth/me - Get current user (requires authentication)
router.get("/me", async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({
        success: false,
        error: "No token provided"
      });
    }

    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET);

    // Find user
    const user = await DashboardUser.findById(decoded.id).select("-password");
    if (!user || !user.active) {
      return res.status(401).json({
        success: false,
        error: "Invalid token or inactive user"
      });
    }

    // Send user data
    res.json({
      success: true,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: user.fullName,
        role: user.role,
        roleLabel: await user.getRoleLabel(),
        profile: user.profile,
        profileLabel: await user.getProfileLabel()
      }
    });
  } catch (error) {
    console.error("Auth verification error:", error);
    res.status(401).json({
      success: false,
      error: "Invalid or expired token"
    });
  }
});

// POST /auth/logout - Logout (client-side token removal)
router.post("/logout", (req, res) => {
  res.json({
    success: true,
    message: "Logged out successfully"
  });
});

module.exports = router;
