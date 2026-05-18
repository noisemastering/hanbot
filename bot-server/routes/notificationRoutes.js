const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const DashboardUser = require("../models/DashboardUser");
const Notification = require("../models/Notification");

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

// Helper: check if user is admin+
const isAdmin = (user) => ["super_admin", "admin"].includes(user.role);

// GET /notifications — list notifications for current user
router.get("/", authenticate, async (req, res) => {
  try {
    const userId = req.user._id;

    // Show global notifications + individual ones targeting this user
    const notifications = await Notification.find({
      $or: [
        { type: "global" },
        { type: "individual", targetUserId: userId }
      ]
    })
      .populate("createdBy", "firstName lastName username")
      .populate("targetUserId", "firstName lastName username")
      .sort({ createdAt: -1 });

    // Add isRead flag for the current user
    const data = notifications.map((n) => ({
      ...n.toObject(),
      isRead: n.readBy.some((id) => id.toString() === userId.toString())
    }));

    res.json({ success: true, data });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({ success: false, error: "Failed to fetch notifications" });
  }
});

// GET /notifications/unread-count — count unread for current user
router.get("/unread-count", authenticate, async (req, res) => {
  try {
    const userId = req.user._id;

    const count = await Notification.countDocuments({
      $or: [
        { type: "global" },
        { type: "individual", targetUserId: userId }
      ],
      readBy: { $ne: userId }
    });

    res.json({ success: true, count });
  } catch (error) {
    console.error("Error counting unread notifications:", error);
    res.status(500).json({ success: false, error: "Failed to count notifications" });
  }
});

// POST /notifications — create (admin+ only)
router.post("/", authenticate, async (req, res) => {
  try {
    if (!isAdmin(req.user)) {
      return res.status(403).json({ success: false, error: "Not authorized" });
    }

    const { title, message, type, targetUserId } = req.body;

    if (!title || !message) {
      return res.status(400).json({ success: false, error: "Title and message are required" });
    }

    if (type === "individual" && !targetUserId) {
      return res.status(400).json({ success: false, error: "Target user is required for individual notifications" });
    }

    const notification = new Notification({
      title,
      message,
      type: type || "global",
      targetUserId: type === "individual" ? targetUserId : null,
      createdBy: req.user._id
    });

    await notification.save();

    const populated = await Notification.findById(notification._id)
      .populate("createdBy", "firstName lastName username")
      .populate("targetUserId", "firstName lastName username");

    res.status(201).json({ success: true, data: populated });
  } catch (error) {
    console.error("Error creating notification:", error);
    res.status(500).json({ success: false, error: "Failed to create notification" });
  }
});

// PUT /notifications/:id/read — mark as read by current user
router.put("/:id/read", authenticate, async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.id);
    if (!notification) {
      return res.status(404).json({ success: false, error: "Notification not found" });
    }

    const userId = req.user._id;
    if (!notification.readBy.some((id) => id.toString() === userId.toString())) {
      notification.readBy.push(userId);
      await notification.save();
    }

    res.json({ success: true, message: "Marked as read" });
  } catch (error) {
    console.error("Error marking notification as read:", error);
    res.status(500).json({ success: false, error: "Failed to mark as read" });
  }
});

// PUT /notifications/read-all — mark all as read for current user
router.put("/read-all", authenticate, async (req, res) => {
  try {
    const userId = req.user._id;

    await Notification.updateMany(
      {
        $or: [
          { type: "global" },
          { type: "individual", targetUserId: userId }
        ],
        readBy: { $ne: userId }
      },
      { $push: { readBy: userId } }
    );

    res.json({ success: true, message: "All notifications marked as read" });
  } catch (error) {
    console.error("Error marking all as read:", error);
    res.status(500).json({ success: false, error: "Failed to mark all as read" });
  }
});

module.exports = router;
