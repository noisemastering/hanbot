const mongoose = require("mongoose");

const flowStepSchema = new mongoose.Schema({
  stepId: { type: String, required: true },
  order: { type: Number, required: true },

  // What the bot says at this step
  message: { type: String, required: true },

  // Variable collection
  collectAs: { type: String },  // Save user response as this variable name

  // Input type affects how we process the response
  inputType: {
    type: String,
    enum: ['text', 'options', 'confirm', 'number', 'phone', 'email'],
    default: 'text'
  },

  // For 'options' inputType - predefined choices
  options: [{
    label: String,
    value: String,
    nextStep: String  // Optional: jump to specific step based on choice
  }],

  // Validation (optional)
  validation: {
    required: { type: Boolean, default: true },
    minLength: Number,
    maxLength: Number,
    pattern: String,  // Regex pattern
    errorMessage: String  // Custom error message
  },

  // Flow control
  nextStep: { type: String },  // Default next step (stepId)

  // Conditional branching (optional, advanced)
  conditions: [{
    variable: String,      // Variable to check
    operator: String,      // 'equals', 'contains', 'gt', 'lt'
    value: String,         // Value to compare
    nextStep: String       // Step to go to if condition matches
  }],

  // Skip this step if condition met
  skipIf: {
    variable: String,
    operator: String,
    value: String
  }
}, { _id: false });

const flowSchema = new mongoose.Schema({
  // Identity
  key: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  description: { type: String },

  // Trigger
  triggerIntent: { type: String },  // Intent key that triggers this flow

  // Steps
  steps: [flowStepSchema],

  // First step (defaults to first in array if not specified)
  startStep: { type: String },

  // What happens when flow completes
  onComplete: {
    action: {
      type: String,
      enum: ['handoff', 'message', 'intent', 'flow'],
      default: 'message'
    },
    message: { type: String },  // Final message to send

    // For 'handoff' action
    handoffReason: { type: String },
    includeVariables: [String],  // Which collected variables to include in handoff

    // For 'intent' action - trigger another intent
    triggerIntent: { type: String },

    // For 'flow' action - chain to another flow
    nextFlow: { type: String }
  },

  // What happens if user abandons or times out
  onAbandon: {
    message: { type: String },
    action: { type: String, enum: ['none', 'handoff', 'message'], default: 'none' }
  },

  // Settings
  active: { type: Boolean, default: true },
  timeout: { type: Number, default: 30 },  // Minutes before flow times out

  // Metrics
  startCount: { type: Number, default: 0 },
  completeCount: { type: Number, default: 0 },
  abandonCount: { type: Number, default: 0 }
}, { timestamps: true });

// Indexes
flowSchema.index({ key: 1 });
flowSchema.index({ triggerIntent: 1 });
flowSchema.index({ active: 1 });

/**
 * Get a step by its stepId
 */
flowSchema.methods.getStep = function(stepId) {
  return this.steps.find(s => s.stepId === stepId);
};

/**
 * Get the first step
 */
flowSchema.methods.getFirstStep = function() {
  if (this.startStep) {
    return this.getStep(this.startStep);
  }
  // Return step with lowest order
  return this.steps.sort((a, b) => a.order - b.order)[0];
};

/**
 * Get the next step after current
 */
flowSchema.methods.getNextStep = function(currentStepId, collectedData = {}) {
  const currentStep = this.getStep(currentStepId);
  if (!currentStep) return null;

  // Check conditions first
  if (currentStep.conditions && currentStep.conditions.length > 0) {
    for (const condition of currentStep.conditions) {
      const varValue = collectedData[condition.variable];
      let matches = false;

      switch (condition.operator) {
        case 'equals':
          matches = varValue === condition.value;
          break;
        case 'contains':
          matches = varValue && varValue.toLowerCase().includes(condition.value.toLowerCase());
          break;
        case 'gt':
          matches = Number(varValue) > Number(condition.value);
          break;
        case 'lt':
          matches = Number(varValue) < Number(condition.value);
          break;
      }

      if (matches && condition.nextStep) {
        return this.getStep(condition.nextStep);
      }
    }
  }

  // Use default nextStep
  if (currentStep.nextStep) {
    return this.getStep(currentStep.nextStep);
  }

  // No next step = flow complete
  return null;
};

/**
 * Check if a step should be skipped
 */
flowSchema.methods.shouldSkipStep = function(step, collectedData = {}) {
  if (!step.skipIf || !step.skipIf.variable) return false;

  const varValue = collectedData[step.skipIf.variable];

  switch (step.skipIf.operator) {
    case 'equals':
      return varValue === step.skipIf.value;
    case 'exists':
      return !!varValue;
    case 'notExists':
      return !varValue;
    default:
      return false;
  }
};

module.exports = mongoose.model("Flow", flowSchema);
