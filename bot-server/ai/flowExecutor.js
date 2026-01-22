// ai/flowExecutor.js
// Executes database-driven conversation flows

const Flow = require("../models/Flow");
const { updateConversation } = require("../conversationManager");
const { sendHandoffNotification } = require("../services/pushNotifications");

/**
 * Check if user is currently in a flow
 */
function isInFlow(convo) {
  return convo?.activeFlow?.flowKey && convo?.activeFlow?.currentStep;
}

/**
 * Get the active flow state from conversation
 */
function getFlowState(convo) {
  return convo?.activeFlow || null;
}

/**
 * Start a flow for a user
 */
async function startFlow(flowKey, psid, convo) {
  try {
    const flow = await Flow.findOne({ key: flowKey, active: true });
    if (!flow) {
      console.log(`❌ Flow not found or inactive: ${flowKey}`);
      return null;
    }

    const firstStep = flow.getFirstStep();
    if (!firstStep) {
      console.log(`❌ Flow has no steps: ${flowKey}`);
      return null;
    }

    // Initialize flow state in conversation
    const flowState = {
      flowKey: flow.key,
      flowId: flow._id.toString(),
      currentStep: firstStep.stepId,
      collectedData: {},
      startedAt: new Date()
    };

    await updateConversation(psid, {
      activeFlow: flowState,
      lastIntent: `flow_${flow.key}_start`
    });

    // Increment start count
    await Flow.updateOne({ _id: flow._id }, { $inc: { startCount: 1 } });

    console.log(`🚀 Started flow: ${flow.name} (step: ${firstStep.stepId})`);

    // Return the first step's message
    return {
      type: "text",
      text: firstStep.message,
      handledBy: `flow_${flow.key}`,
      flowState: {
        ...flowState,
        stepType: firstStep.inputType,
        options: firstStep.options
      }
    };
  } catch (error) {
    console.error(`❌ Error starting flow:`, error);
    return null;
  }
}

/**
 * Process user response within a flow
 */
async function processFlowStep(userMessage, psid, convo) {
  try {
    const flowState = getFlowState(convo);
    if (!flowState) {
      console.log(`⚠️ No active flow state for ${psid}`);
      return null;
    }

    const flow = await Flow.findOne({ key: flowState.flowKey, active: true });
    if (!flow) {
      console.log(`❌ Active flow no longer exists: ${flowState.flowKey}`);
      await clearFlowState(psid);
      return null;
    }

    const currentStep = flow.getStep(flowState.currentStep);
    if (!currentStep) {
      console.log(`❌ Current step not found: ${flowState.currentStep}`);
      await clearFlowState(psid);
      return null;
    }

    console.log(`📝 Processing flow step: ${currentStep.stepId} in ${flow.name}`);

    // Validate user input if validation rules exist
    const validationResult = validateInput(userMessage, currentStep);
    if (!validationResult.valid) {
      console.log(`⚠️ Validation failed: ${validationResult.error}`);
      return {
        type: "text",
        text: validationResult.error,
        handledBy: `flow_${flow.key}_validation`,
        flowState: flowState
      };
    }

    // Process the response based on input type
    const processedValue = processInput(userMessage, currentStep);

    // Collect the variable if specified
    const updatedData = { ...flowState.collectedData };
    if (currentStep.collectAs) {
      updatedData[currentStep.collectAs] = processedValue;
      console.log(`📦 Collected: ${currentStep.collectAs} = "${processedValue}"`);
    }

    // Determine next step
    let nextStep = null;

    // Check if user selected an option with custom nextStep
    if (currentStep.inputType === 'options' && currentStep.options) {
      const selectedOption = currentStep.options.find(
        opt => opt.value.toLowerCase() === processedValue.toLowerCase() ||
               opt.label.toLowerCase() === processedValue.toLowerCase()
      );
      if (selectedOption?.nextStep) {
        nextStep = flow.getStep(selectedOption.nextStep);
      }
    }

    // If no option-specific nextStep, use the flow's logic
    if (!nextStep) {
      nextStep = flow.getNextStep(currentStep.stepId, updatedData);
    }

    // Skip steps if conditions are met
    while (nextStep && flow.shouldSkipStep(nextStep, updatedData)) {
      console.log(`⏭️ Skipping step: ${nextStep.stepId}`);
      nextStep = flow.getNextStep(nextStep.stepId, updatedData);
    }

    // Check if flow is complete
    if (!nextStep) {
      return await completeFlow(flow, updatedData, psid, convo);
    }

    // Update conversation with new step
    const newFlowState = {
      ...flowState,
      currentStep: nextStep.stepId,
      collectedData: updatedData
    };

    await updateConversation(psid, {
      activeFlow: newFlowState,
      lastIntent: `flow_${flow.key}_${nextStep.stepId}`
    });

    console.log(`➡️ Advanced to step: ${nextStep.stepId}`);

    // Return the next step's message
    return {
      type: "text",
      text: nextStep.message,
      handledBy: `flow_${flow.key}`,
      flowState: {
        ...newFlowState,
        stepType: nextStep.inputType,
        options: nextStep.options
      }
    };
  } catch (error) {
    console.error(`❌ Error processing flow step:`, error);
    return null;
  }
}

/**
 * Complete a flow and perform the onComplete action
 */
async function completeFlow(flow, collectedData, psid, convo) {
  console.log(`✅ Flow complete: ${flow.name}`);
  console.log(`📦 Collected data:`, collectedData);

  // Increment complete count
  await Flow.updateOne({ _id: flow._id }, { $inc: { completeCount: 1 } });

  const onComplete = flow.onComplete || { action: 'message', message: 'Gracias.' };

  // Clear flow state
  await clearFlowState(psid);

  switch (onComplete.action) {
    case 'handoff':
      // Prepare handoff data
      const handoffData = {};
      if (onComplete.includeVariables && onComplete.includeVariables.length > 0) {
        for (const varName of onComplete.includeVariables) {
          if (collectedData[varName] !== undefined) {
            handoffData[varName] = collectedData[varName];
          }
        }
      } else {
        // Include all collected data
        Object.assign(handoffData, collectedData);
      }

      // Format handoff notes
      const handoffNotes = Object.entries(handoffData)
        .map(([key, val]) => `${key}: ${val}`)
        .join('\n');

      await updateConversation(psid, {
        handoffRequested: true,
        handoffReason: onComplete.handoffReason || `Flow: ${flow.name}`,
        handoffTimestamp: new Date(),
        state: "needs_human",
        flowCollectedData: collectedData,
        handoffNotes: handoffNotes
      });

      // Send notification
      await sendHandoffNotification(psid, convo, `Flow completado: ${flow.name}\n${handoffNotes}`);

      return {
        type: "text",
        text: onComplete.message || "Un asesor te contactará pronto.",
        handledBy: `flow_${flow.key}_complete_handoff`
      };

    case 'flow':
      // Chain to another flow
      if (onComplete.nextFlow) {
        console.log(`🔗 Chaining to flow: ${onComplete.nextFlow}`);
        // First send the completion message, then start new flow
        const chainResponse = await startFlow(onComplete.nextFlow, psid, convo);
        if (chainResponse && onComplete.message) {
          // Prepend completion message
          chainResponse.text = `${onComplete.message}\n\n${chainResponse.text}`;
        }
        return chainResponse;
      }
      // Fall through to message if no nextFlow
      break;

    case 'intent':
      // This would trigger another intent - for now just store it
      if (onComplete.triggerIntent) {
        await updateConversation(psid, {
          lastIntent: onComplete.triggerIntent,
          flowCollectedData: collectedData
        });
      }
      return {
        type: "text",
        text: onComplete.message || "Gracias por la información.",
        handledBy: `flow_${flow.key}_complete_intent`,
        triggerIntent: onComplete.triggerIntent
      };

    case 'message':
    default:
      // Just send a message
      await updateConversation(psid, {
        flowCollectedData: collectedData
      });

      return {
        type: "text",
        text: onComplete.message || "Gracias por la información.",
        handledBy: `flow_${flow.key}_complete`
      };
  }
}

/**
 * Clear the flow state from conversation
 */
async function clearFlowState(psid) {
  await updateConversation(psid, {
    activeFlow: null
  });
  console.log(`🧹 Cleared flow state for ${psid}`);
}

/**
 * Abandon a flow (timeout or user request)
 */
async function abandonFlow(psid, convo, reason = 'abandoned') {
  const flowState = getFlowState(convo);
  if (!flowState) return;

  try {
    const flow = await Flow.findOne({ key: flowState.flowKey });
    if (flow) {
      await Flow.updateOne({ _id: flow._id }, { $inc: { abandonCount: 1 } });

      console.log(`⚠️ Flow abandoned: ${flow.name} (${reason})`);

      // Handle onAbandon if defined
      if (flow.onAbandon?.action === 'handoff') {
        await updateConversation(psid, {
          handoffRequested: true,
          handoffReason: `Flow abandonado: ${flow.name}`,
          handoffTimestamp: new Date(),
          state: "needs_human"
        });
      }

      await clearFlowState(psid);

      if (flow.onAbandon?.message) {
        return {
          type: "text",
          text: flow.onAbandon.message,
          handledBy: `flow_${flow.key}_abandon`
        };
      }
    }
  } catch (error) {
    console.error(`❌ Error abandoning flow:`, error);
  }

  await clearFlowState(psid);
  return null;
}

/**
 * Validate user input against step rules
 */
function validateInput(message, step) {
  const validation = step.validation || {};
  const trimmed = message.trim();

  // Required check
  if (validation.required !== false && !trimmed) {
    return {
      valid: false,
      error: validation.errorMessage || "Por favor proporciona una respuesta."
    };
  }

  // Min length
  if (validation.minLength && trimmed.length < validation.minLength) {
    return {
      valid: false,
      error: validation.errorMessage || `La respuesta debe tener al menos ${validation.minLength} caracteres.`
    };
  }

  // Max length
  if (validation.maxLength && trimmed.length > validation.maxLength) {
    return {
      valid: false,
      error: validation.errorMessage || `La respuesta no puede tener más de ${validation.maxLength} caracteres.`
    };
  }

  // Pattern (regex)
  if (validation.pattern) {
    try {
      const regex = new RegExp(validation.pattern, 'i');
      if (!regex.test(trimmed)) {
        return {
          valid: false,
          error: validation.errorMessage || "El formato de la respuesta no es válido."
        };
      }
    } catch (e) {
      console.error(`Invalid regex pattern: ${validation.pattern}`);
    }
  }

  // Options validation
  if (step.inputType === 'options' && step.options && step.options.length > 0) {
    const validValues = step.options.map(o => o.value.toLowerCase());
    const validLabels = step.options.map(o => o.label.toLowerCase());
    const userInput = trimmed.toLowerCase();

    // Also accept option numbers (1, 2, 3...)
    const optionIndex = parseInt(userInput) - 1;
    const isValidIndex = optionIndex >= 0 && optionIndex < step.options.length;

    if (!validValues.includes(userInput) && !validLabels.includes(userInput) && !isValidIndex) {
      const optionsList = step.options.map((o, i) => `${i + 1}. ${o.label}`).join('\n');
      return {
        valid: false,
        error: `Por favor selecciona una de las opciones:\n${optionsList}`
      };
    }
  }

  // Number validation
  if (step.inputType === 'number') {
    const num = parseFloat(trimmed.replace(/[,$]/g, ''));
    if (isNaN(num)) {
      return {
        valid: false,
        error: validation.errorMessage || "Por favor proporciona un número válido."
      };
    }
  }

  // Phone validation
  if (step.inputType === 'phone') {
    const phoneRegex = /^[\d\s\-\(\)\+]{7,20}$/;
    if (!phoneRegex.test(trimmed)) {
      return {
        valid: false,
        error: validation.errorMessage || "Por favor proporciona un número de teléfono válido."
      };
    }
  }

  // Email validation
  if (step.inputType === 'email') {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmed)) {
      return {
        valid: false,
        error: validation.errorMessage || "Por favor proporciona un correo electrónico válido."
      };
    }
  }

  return { valid: true };
}

/**
 * Process and normalize user input
 */
function processInput(message, step) {
  const trimmed = message.trim();

  switch (step.inputType) {
    case 'number':
      return parseFloat(trimmed.replace(/[,$]/g, ''));

    case 'phone':
      // Normalize phone: remove spaces, dashes
      return trimmed.replace(/[\s\-\(\)]/g, '');

    case 'email':
      return trimmed.toLowerCase();

    case 'confirm':
      const positive = ['si', 'sí', 'yes', 'ok', 'claro', 'perfecto', 'correcto', 'afirmativo'];
      return positive.includes(trimmed.toLowerCase()) ? 'yes' : 'no';

    case 'options':
      // Check if user entered a number
      const optionIndex = parseInt(trimmed) - 1;
      if (step.options && optionIndex >= 0 && optionIndex < step.options.length) {
        return step.options[optionIndex].value;
      }
      // Check if user entered the value or label
      if (step.options) {
        const matchedOption = step.options.find(
          o => o.value.toLowerCase() === trimmed.toLowerCase() ||
               o.label.toLowerCase() === trimmed.toLowerCase()
        );
        if (matchedOption) {
          return matchedOption.value;
        }
      }
      return trimmed;

    case 'text':
    default:
      return trimmed;
  }
}

/**
 * Get flow by trigger intent
 */
async function getFlowByIntent(intentKey) {
  try {
    return await Flow.findOne({ triggerIntent: intentKey, active: true });
  } catch (error) {
    console.error(`❌ Error getting flow by intent:`, error);
    return null;
  }
}

/**
 * Check if an intent has a linked flow
 */
async function hasLinkedFlow(intentKey) {
  const flow = await getFlowByIntent(intentKey);
  return !!flow;
}

module.exports = {
  isInFlow,
  getFlowState,
  startFlow,
  processFlowStep,
  completeFlow,
  clearFlowState,
  abandonFlow,
  getFlowByIntent,
  hasLinkedFlow
};
