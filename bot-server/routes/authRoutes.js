// routes/authRoutes.js
const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const DashboardUser = require("../models/DashboardUser");
const { sendPasswordResetEmail } = require("../utils/emailService");

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
      console.log(`❌ Login failed: User "${username}" not found`);
      return res.status(401).json({
        success: false,
        error: "Invalid credentials"
      });
    }

    console.log(`🔍 Login attempt for username: "${username}" (ID: ${user._id}, Email: ${user.email})`);

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

    // Get user permissions
    const permissions = await user.getAllPermissions();
    console.log(`✅ Login successful for username: "${user.username}" (ID: ${user._id}, Email: ${user.email})`);
    console.log(`👤 User info: ${user.fullName} - Role: ${user.role}, Profile: ${user.profile || 'none'}`);
    console.log(`📋 Permissions:`, permissions);

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
        profileLabel: await user.getProfileLabel(),
        permissions: permissions
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
    console.log(`🔍 Token verification - Decoded user ID: ${decoded.id}, username from token: ${decoded.username}`);

    // Find user
    const user = await DashboardUser.findById(decoded.id).select("-password");
    if (!user || !user.active) {
      console.log(`❌ Token verification failed: User ID ${decoded.id} not found or inactive`);
      return res.status(401).json({
        success: false,
        error: "Invalid token or inactive user"
      });
    }

    console.log(`✅ Token verified for username: "${user.username}" (ID: ${user._id}, Email: ${user.email})`);

    // Get user permissions
    const permissions = await user.getAllPermissions();

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
        profileLabel: await user.getProfileLabel(),
        permissions: permissions
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

// POST /auth/change-password - Change password (requires authentication)
router.post("/change-password", async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    const { currentPassword, newPassword } = req.body;

    // Validate token
    if (!token) {
      return res.status(401).json({
        success: false,
        error: "No token provided"
      });
    }

    // Validate input
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: "Current password and new password are required"
      });
    }

    // Validate new password strength
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: "New password must be at least 6 characters long"
      });
    }

    // Verify token and get user
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await DashboardUser.findById(decoded.id);

    if (!user || !user.active) {
      return res.status(401).json({
        success: false,
        error: "Invalid token or inactive user"
      });
    }

    // Verify current password
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: "Current password is incorrect"
      });
    }

    // Update password
    user.password = newPassword; // Will be hashed by pre-save hook
    await user.save();

    console.log(`✅ Password changed for user: ${user.username}`);

    res.json({
      success: true,
      message: "Password changed successfully"
    });
  } catch (error) {
    console.error("Change password error:", error);

    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        success: false,
        error: "Invalid or expired token"
      });
    }

    res.status(500).json({
      success: false,
      error: "Server error during password change"
    });
  }
});

// POST /auth/forgot-password - Request password reset
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required"
      });
    }

    // Find user by email
    const user = await DashboardUser.findOne({ email: email.toLowerCase().trim() });

    // Always return success to prevent email enumeration attacks
    if (!user || !user.active) {
      console.log(`⚠️ Password reset requested for non-existent/inactive email: ${email}`);
      return res.json({
        success: true,
        message: "If an account with that email exists, a password reset link has been sent."
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenHash = crypto.createHash("sha256").update(resetToken).digest("hex");

    // Save hashed token and expiry (1 hour)
    user.resetPasswordToken = resetTokenHash;
    user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await user.save();

    // Build reset URL
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3001";
    const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;

    // Send email
    try {
      await sendPasswordResetEmail(user.email, resetUrl, user.firstName);
      console.log(`✅ Password reset email sent to ${user.email} (User: ${user.username})`);
    } catch (emailError) {
      console.error(`❌ Failed to send reset email to ${user.email}:`, emailError.message);
      // Don't expose email failure to user
    }

    res.json({
      success: true,
      message: "If an account with that email exists, a password reset link has been sent."
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({
      success: false,
      error: "Server error processing request"
    });
  }
});

// POST /auth/reset-password - Reset password with token
router.post("/reset-password", async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        success: false,
        error: "Token and new password are required"
      });
    }

    // Validate password strength
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: "Password must be at least 6 characters long"
      });
    }

    // Hash the provided token to compare with stored hash
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    // Find user with valid token
    const user = await DashboardUser.findOne({
      resetPasswordToken: tokenHash,
      resetPasswordExpires: { $gt: new Date() },
      active: true
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        error: "Invalid or expired reset token"
      });
    }

    // Update password and clear reset token
    user.password = password; // Will be hashed by pre-save hook
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    console.log(`✅ Password reset successful for user: ${user.username}`);

    res.json({
      success: true,
      message: "Password has been reset successfully"
    });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({
      success: false,
      error: "Server error processing request"
    });
  }
});

// GET /auth/verify-reset-token - Verify if reset token is valid (for frontend validation)
router.get("/verify-reset-token", async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: "Token is required"
      });
    }

    // Hash the provided token
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    // Find user with valid token
    const user = await DashboardUser.findOne({
      resetPasswordToken: tokenHash,
      resetPasswordExpires: { $gt: new Date() },
      active: true
    }).select("email firstName");

    if (!user) {
      return res.status(400).json({
        success: false,
        error: "Invalid or expired reset token"
      });
    }

    res.json({
      success: true,
      email: user.email,
      firstName: user.firstName
    });
  } catch (error) {
    console.error("Verify reset token error:", error);
    res.status(500).json({
      success: false,
      error: "Server error processing request"
    });
  }
});

module.exports = router;
