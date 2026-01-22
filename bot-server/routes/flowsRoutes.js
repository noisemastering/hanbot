const express = require("express");
const router = express.Router();
const Flow = require("../models/Flow");

/**
 * GET /flows - List all flows
 */
router.get("/", async (req, res) => {
  try {
    const { active, triggerIntent } = req.query;
    const filter = {};

    if (active !== undefined) {
      filter.active = active === 'true';
    }
    if (triggerIntent) {
      filter.triggerIntent = triggerIntent;
    }

    const flows = await Flow.find(filter).sort({ name: 1 });
    res.json({ success: true, data: flows });
  } catch (error) {
    console.error("Error fetching flows:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /flows/:id - Get single flow
 */
router.get("/:id", async (req, res) => {
  try {
    const flow = await Flow.findById(req.params.id);
    if (!flow) {
      return res.status(404).json({ success: false, error: "Flow not found" });
    }
    res.json({ success: true, data: flow });
  } catch (error) {
    console.error("Error fetching flow:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /flows/key/:key - Get flow by key
 */
router.get("/key/:key", async (req, res) => {
  try {
    const flow = await Flow.findOne({ key: req.params.key });
    if (!flow) {
      return res.status(404).json({ success: false, error: "Flow not found" });
    }
    res.json({ success: true, data: flow });
  } catch (error) {
    console.error("Error fetching flow:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /flows/intent/:intentKey - Get flow by trigger intent
 */
router.get("/intent/:intentKey", async (req, res) => {
  try {
    const flow = await Flow.findOne({
      triggerIntent: req.params.intentKey,
      active: true
    });
    if (!flow) {
      return res.status(404).json({ success: false, error: "No flow for this intent" });
    }
    res.json({ success: true, data: flow });
  } catch (error) {
    console.error("Error fetching flow:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /flows - Create new flow
 */
router.post("/", async (req, res) => {
  try {
    const { key, name, description, triggerIntent, steps, startStep, onComplete, onAbandon, active, timeout } = req.body;

    // Validate required fields
    if (!key || !name) {
      return res.status(400).json({
        success: false,
        error: "Key and name are required"
      });
    }

    // Check for duplicate key
    const existing = await Flow.findOne({ key });
    if (existing) {
      return res.status(400).json({
        success: false,
        error: "A flow with this key already exists"
      });
    }

    // Validate steps have unique stepIds
    if (steps && steps.length > 0) {
      const stepIds = steps.map(s => s.stepId);
      const uniqueIds = new Set(stepIds);
      if (stepIds.length !== uniqueIds.size) {
        return res.status(400).json({
          success: false,
          error: "Step IDs must be unique within a flow"
        });
      }
    }

    const flow = new Flow({
      key,
      name,
      description,
      triggerIntent,
      steps: steps || [],
      startStep,
      onComplete: onComplete || { action: 'message', message: 'Gracias por la información.' },
      onAbandon,
      active: active !== undefined ? active : true,
      timeout: timeout || 30
    });

    await flow.save();
    res.status(201).json({ success: true, data: flow });
  } catch (error) {
    console.error("Error creating flow:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /flows/:id - Update flow
 */
router.put("/:id", async (req, res) => {
  try {
    const { key, name, description, triggerIntent, steps, startStep, onComplete, onAbandon, active, timeout } = req.body;

    const flow = await Flow.findById(req.params.id);
    if (!flow) {
      return res.status(404).json({ success: false, error: "Flow not found" });
    }

    // Don't allow changing key
    if (key && key !== flow.key) {
      return res.status(400).json({
        success: false,
        error: "Cannot change flow key"
      });
    }

    // Validate steps have unique stepIds
    if (steps && steps.length > 0) {
      const stepIds = steps.map(s => s.stepId);
      const uniqueIds = new Set(stepIds);
      if (stepIds.length !== uniqueIds.size) {
        return res.status(400).json({
          success: false,
          error: "Step IDs must be unique within a flow"
        });
      }
    }

    // Update fields
    if (name !== undefined) flow.name = name;
    if (description !== undefined) flow.description = description;
    if (triggerIntent !== undefined) flow.triggerIntent = triggerIntent;
    if (steps !== undefined) flow.steps = steps;
    if (startStep !== undefined) flow.startStep = startStep;
    if (onComplete !== undefined) flow.onComplete = onComplete;
    if (onAbandon !== undefined) flow.onAbandon = onAbandon;
    if (active !== undefined) flow.active = active;
    if (timeout !== undefined) flow.timeout = timeout;

    await flow.save();
    res.json({ success: true, data: flow });
  } catch (error) {
    console.error("Error updating flow:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /flows/:id - Delete flow
 */
router.delete("/:id", async (req, res) => {
  try {
    const flow = await Flow.findByIdAndDelete(req.params.id);
    if (!flow) {
      return res.status(404).json({ success: false, error: "Flow not found" });
    }
    res.json({ success: true, message: "Flow deleted", data: flow });
  } catch (error) {
    console.error("Error deleting flow:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /flows/:id/steps - Add step to flow
 */
router.post("/:id/steps", async (req, res) => {
  try {
    const flow = await Flow.findById(req.params.id);
    if (!flow) {
      return res.status(404).json({ success: false, error: "Flow not found" });
    }

    const { stepId, message, collectAs, inputType, options, validation, nextStep, conditions, skipIf } = req.body;

    if (!stepId || !message) {
      return res.status(400).json({
        success: false,
        error: "stepId and message are required"
      });
    }

    // Check for duplicate stepId
    if (flow.steps.some(s => s.stepId === stepId)) {
      return res.status(400).json({
        success: false,
        error: "A step with this ID already exists"
      });
    }

    // Calculate order (add to end)
    const maxOrder = flow.steps.reduce((max, s) => Math.max(max, s.order || 0), 0);

    flow.steps.push({
      stepId,
      order: maxOrder + 1,
      message,
      collectAs,
      inputType: inputType || 'text',
      options,
      validation,
      nextStep,
      conditions,
      skipIf
    });

    await flow.save();
    res.json({ success: true, data: flow });
  } catch (error) {
    console.error("Error adding step:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /flows/:id/steps/:stepId - Update step
 */
router.put("/:id/steps/:stepId", async (req, res) => {
  try {
    const flow = await Flow.findById(req.params.id);
    if (!flow) {
      return res.status(404).json({ success: false, error: "Flow not found" });
    }

    const stepIndex = flow.steps.findIndex(s => s.stepId === req.params.stepId);
    if (stepIndex === -1) {
      return res.status(404).json({ success: false, error: "Step not found" });
    }

    const { message, collectAs, inputType, options, validation, nextStep, conditions, skipIf, order } = req.body;

    // Update step fields
    if (message !== undefined) flow.steps[stepIndex].message = message;
    if (collectAs !== undefined) flow.steps[stepIndex].collectAs = collectAs;
    if (inputType !== undefined) flow.steps[stepIndex].inputType = inputType;
    if (options !== undefined) flow.steps[stepIndex].options = options;
    if (validation !== undefined) flow.steps[stepIndex].validation = validation;
    if (nextStep !== undefined) flow.steps[stepIndex].nextStep = nextStep;
    if (conditions !== undefined) flow.steps[stepIndex].conditions = conditions;
    if (skipIf !== undefined) flow.steps[stepIndex].skipIf = skipIf;
    if (order !== undefined) flow.steps[stepIndex].order = order;

    await flow.save();
    res.json({ success: true, data: flow });
  } catch (error) {
    console.error("Error updating step:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /flows/:id/steps/:stepId - Delete step
 */
router.delete("/:id/steps/:stepId", async (req, res) => {
  try {
    const flow = await Flow.findById(req.params.id);
    if (!flow) {
      return res.status(404).json({ success: false, error: "Flow not found" });
    }

    const stepIndex = flow.steps.findIndex(s => s.stepId === req.params.stepId);
    if (stepIndex === -1) {
      return res.status(404).json({ success: false, error: "Step not found" });
    }

    flow.steps.splice(stepIndex, 1);
    await flow.save();
    res.json({ success: true, data: flow });
  } catch (error) {
    console.error("Error deleting step:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /flows/:id/reorder-steps - Reorder steps
 */
router.post("/:id/reorder-steps", async (req, res) => {
  try {
    const flow = await Flow.findById(req.params.id);
    if (!flow) {
      return res.status(404).json({ success: false, error: "Flow not found" });
    }

    const { stepOrder } = req.body;  // Array of stepIds in new order

    if (!Array.isArray(stepOrder)) {
      return res.status(400).json({
        success: false,
        error: "stepOrder must be an array of stepIds"
      });
    }

    // Update order for each step
    stepOrder.forEach((stepId, index) => {
      const step = flow.steps.find(s => s.stepId === stepId);
      if (step) {
        step.order = index + 1;
      }
    });

    await flow.save();
    res.json({ success: true, data: flow });
  } catch (error) {
    console.error("Error reordering steps:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /flows/:id/duplicate - Duplicate a flow
 */
router.post("/:id/duplicate", async (req, res) => {
  try {
    const original = await Flow.findById(req.params.id);
    if (!original) {
      return res.status(404).json({ success: false, error: "Flow not found" });
    }

    const { newKey, newName } = req.body;

    if (!newKey) {
      return res.status(400).json({
        success: false,
        error: "newKey is required"
      });
    }

    // Check for duplicate key
    const existing = await Flow.findOne({ key: newKey });
    if (existing) {
      return res.status(400).json({
        success: false,
        error: "A flow with this key already exists"
      });
    }

    const duplicate = new Flow({
      key: newKey,
      name: newName || `${original.name} (copy)`,
      description: original.description,
      triggerIntent: null,  // Don't copy trigger
      steps: original.steps,
      startStep: original.startStep,
      onComplete: original.onComplete,
      onAbandon: original.onAbandon,
      active: false,  // Start inactive
      timeout: original.timeout
    });

    await duplicate.save();
    res.status(201).json({ success: true, data: duplicate });
  } catch (error) {
    console.error("Error duplicating flow:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /flows/:id/stats - Get flow statistics
 */
router.get("/:id/stats", async (req, res) => {
  try {
    const flow = await Flow.findById(req.params.id);
    if (!flow) {
      return res.status(404).json({ success: false, error: "Flow not found" });
    }

    const completionRate = flow.startCount > 0
      ? ((flow.completeCount / flow.startCount) * 100).toFixed(1)
      : 0;

    const abandonRate = flow.startCount > 0
      ? ((flow.abandonCount / flow.startCount) * 100).toFixed(1)
      : 0;

    res.json({
      success: true,
      data: {
        startCount: flow.startCount,
        completeCount: flow.completeCount,
        abandonCount: flow.abandonCount,
        completionRate: `${completionRate}%`,
        abandonRate: `${abandonRate}%`,
        stepCount: flow.steps.length
      }
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
