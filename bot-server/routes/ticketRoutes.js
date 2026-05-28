const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const DashboardUser = require("../models/DashboardUser");
const Ticket = require("../models/Ticket");

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

// GET /tickets — list all tickets
router.get("/", authenticate, async (req, res) => {
  try {
    const tickets = await Ticket.find()
      .populate("createdBy", "firstName lastName username")
      .populate("assignedTo", "firstName lastName username")
      .populate("comments.author", "firstName lastName username")
      .sort({ createdAt: -1 });

    res.json({ success: true, data: tickets });
  } catch (error) {
    console.error("Error fetching tickets:", error);
    res.status(500).json({ success: false, error: "Failed to fetch tickets" });
  }
});

// POST /tickets — create a ticket
router.post("/", authenticate, async (req, res) => {
  try {
    const { title, description, priority } = req.body;

    if (!title || !description) {
      return res.status(400).json({ success: false, error: "Title and description are required" });
    }

    const ticket = new Ticket({
      title,
      description,
      priority: priority || "medium",
      createdBy: req.user._id
    });

    await ticket.save();

    const populated = await Ticket.findById(ticket._id)
      .populate("createdBy", "firstName lastName username")
      .populate("assignedTo", "firstName lastName username");

    // Push notification to all dashboard subscribers
    try {
      const webpush = require("web-push");
      const PushSubscription = require("../models/PushSubscription");
      if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
        const subs = await PushSubscription.find();
        const author = populated.createdBy
          ? `${populated.createdBy.firstName || ''} ${populated.createdBy.lastName || ''}`.trim() || populated.createdBy.username
          : 'Alguien';
        const payload = JSON.stringify({
          title: `🎫 Ticket nuevo: ${title}`,
          body: `${author} reportó: ${description.slice(0, 120)}${description.length > 120 ? '…' : ''}`,
          icon: '/logo192.png',
          badge: '/logo192.png',
          data: { url: '/tickets', ticketId: ticket._id.toString() }
        });
        await Promise.allSettled(subs.map(sub =>
          webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload)
            .catch(async (err) => {
              if (err.statusCode === 410 || err.statusCode === 404) {
                await PushSubscription.deleteOne({ endpoint: sub.endpoint });
              }
            })
        ));
        console.log(`📣 Ticket notification fanned out to ${subs.length} subscriber(s)`);
      }
    } catch (notifyErr) {
      console.error("⚠️ Ticket push notification failed:", notifyErr.message);
    }

    res.status(201).json({ success: true, data: populated });
  } catch (error) {
    console.error("Error creating ticket:", error);
    res.status(500).json({ success: false, error: "Failed to create ticket" });
  }
});

// PUT /tickets/:id — update a ticket
router.put("/:id", authenticate, async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) {
      return res.status(404).json({ success: false, error: "Ticket not found" });
    }

    const { title, description, status, priority, assignedTo } = req.body;

    // Admin+ can change status, priority, and assignment
    if (isAdmin(req.user)) {
      if (status) ticket.status = status;
      if (priority) ticket.priority = priority;
      if (assignedTo !== undefined) ticket.assignedTo = assignedTo || null;
      if (title) ticket.title = title;
      if (description) ticket.description = description;
    } else {
      // Non-admin can only edit title/description if they are the creator
      if (ticket.createdBy.toString() !== req.user._id.toString()) {
        return res.status(403).json({ success: false, error: "Not authorized to edit this ticket" });
      }
      if (title) ticket.title = title;
      if (description) ticket.description = description;
    }

    await ticket.save();

    const populated = await Ticket.findById(ticket._id)
      .populate("createdBy", "firstName lastName username")
      .populate("assignedTo", "firstName lastName username")
      .populate("comments.author", "firstName lastName username");

    res.json({ success: true, data: populated });
  } catch (error) {
    console.error("Error updating ticket:", error);
    res.status(500).json({ success: false, error: "Failed to update ticket" });
  }
});

// POST /tickets/:id/comments — add a comment
router.post("/:id/comments", authenticate, async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) {
      return res.status(404).json({ success: false, error: "Ticket not found" });
    }

    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ success: false, error: "Comment text is required" });
    }

    ticket.comments.push({
      text,
      author: req.user._id
    });

    await ticket.save();

    const populated = await Ticket.findById(ticket._id)
      .populate("createdBy", "firstName lastName username")
      .populate("assignedTo", "firstName lastName username")
      .populate("comments.author", "firstName lastName username");

    res.json({ success: true, data: populated });
  } catch (error) {
    console.error("Error adding comment:", error);
    res.status(500).json({ success: false, error: "Failed to add comment" });
  }
});

// DELETE /tickets/:id — delete a ticket (admin+ only)
router.delete("/:id", authenticate, async (req, res) => {
  try {
    if (!isAdmin(req.user)) {
      return res.status(403).json({ success: false, error: "Not authorized" });
    }

    const ticket = await Ticket.findByIdAndDelete(req.params.id);
    if (!ticket) {
      return res.status(404).json({ success: false, error: "Ticket not found" });
    }

    res.json({ success: true, message: "Ticket deleted" });
  } catch (error) {
    console.error("Error deleting ticket:", error);
    res.status(500).json({ success: false, error: "Failed to delete ticket" });
  }
});

module.exports = router;
