// ai/flowExecutor.js
// Executes database-driven conversation flows

const Flow = require("../models/Flow");
const { updateConversation } = require("../conversationManager");
const { parseDimensions } = require("./utils/sizeParser");
const { executeHandoff } = require("./utils/executeHandoff");

// Dynamic action handlers
const customSizeActions = require("./flows/customSizeActions");

/**
 * Check if user is currently in a flow
 */
function isInFlow(convo) {
  return convo?.activeFlow?.flowKey && convo?.activeFlow?.currentStep;
}

/**
 * Check if a step should be skipped based on context
 * Handles special skip conditions beyond the standard skipIf variable check
 */
function shouldSkipStepByContext(step, convo, collectedData, triggerMessage = null) {
  // Standard skipIf check is handled by Flow.shouldSkipStep
  // Here we handle special context-based conditions

  if (step.stepId === 'ask_product_type') {
    // Skip if we already know the product type from conversation context
    if (customSizeActions.hasProductContext(convo)) {
      console.log(`⏭️ Skipping ask_product_type - context already has product info`);
      return true;
    }
  }

  if (step.stepId === 'collect_dimensions') {
    // Skip if we already have dimensions from the trigger message
    if (triggerMessage) {
      const dims = parseDimensions(triggerMessage);
      if (dims && dims.hasFractional) {
        console.log(`⏭️ Skipping collect_dimensions - found in trigger: ${dims.raw}`);
        return true;
      }
    }
  }

  return false;
}

/**
 * Pre-populate collected data from context
 */
function prepopulateFromContext(convo, triggerMessage = null) {
  const data = {};

  // Get product type from context
  const productType = customSizeActions.determineProductType(convo, {}, null);
  if (productType && productType !== 'unknown') {
    data.productType = productType;
    console.log(`📋 Pre-populated productType from context: ${productType}`);
  }

  // Get dimensions from trigger message
  if (triggerMessage) {
    const dims = parseDimensions(triggerMessage);
    if (dims && dims.hasFractional) {
      data.requestedSize = dims.raw;
      data._parsedDimensions = dims;
      console.log(`📋 Pre-populated requestedSize from trigger: ${dims.raw}`);
    }
  }

  return data;
}

/**
 * Handle dynamic message generation
 * Messages starting with "DYNAMIC:" trigger special handlers
 */
async function handleDynamicMessage(step, collectedData, convo, psid) {
  const message = step.message;

  if (!message.startsWith('DYNAMIC:')) {
    return null; // Not a dynamic message
  }

  const action = message.replace('DYNAMIC:', '').trim();
  console.log(`🔄 Handling dynamic action: ${action}`);

  switch (action) {
    case 'find_similar_sizes':
      return await customSizeActions.generateFindSimilarResponse(collectedData, convo);

    case 'process_size_choice':
      const userChoice = collectedData.userChoice;
      return await customSizeActions.processUserChoice(userChoice, collectedData, convo, psid);

    default:
      console.warn(`⚠️ Unknown dynamic action: ${action}`);
      return null;
  }
}

/**
 * Get the active flow state from conversation
 */
function getFlowState(convo) {
  return convo?.activeFlow || null;
}

/**
 * Start a flow for a user
 * @param {string} flowKey - The flow key to start
 * @param {string} psid - User's PSID
 * @param {object} convo - Conversation object
 * @param {string} triggerMessage - The message that triggered this flow (optional)
 */
async function startFlow(flowKey, psid, convo, triggerMessage = null) {
  try {
    const flow = await Flow.findOne({ key: flowKey, active: true });
    if (!flow) {
      console.log(`❌ Flow not found or inactive: ${flowKey}`);
      return null;
    }

    let currentStep = flow.getFirstStep();
    if (!currentStep) {
      console.log(`❌ Flow has no steps: ${flowKey}`);
      return null;
    }

    // Pre-populate data from context (product type, dimensions from trigger)
    const collectedData = prepopulateFromContext(convo, triggerMessage);

    // Skip steps based on context
    while (currentStep && shouldSkipStepByContext(currentStep, convo, collectedData, triggerMessage)) {
      currentStep = flow.getNextStep(currentStep.stepId, collectedData);
    }

    // Also skip based on standard skipIf rules
    while (currentStep && flow.shouldSkipStep(currentStep, collectedData)) {
      currentStep = flow.getNextStep(currentStep.stepId, collectedData);
    }

    if (!currentStep) {
      console.log(`⚠️ All steps skipped, completing flow immediately`);
      return await completeFlow(flow, collectedData, psid, convo);
    }

    // Initialize flow state in conversation
    const flowState = {
      flowKey: flow.key,
      flowId: flow._id.toString(),
      currentStep: currentStep.stepId,
      collectedData: collectedData,
      startedAt: new Date(),
      triggerMessage: triggerMessage
    };

    await updateConversation(psid, {
      activeFlow: flowState,
      lastIntent: `flow_${flow.key}_start`
    });

    // Increment start count
    await Flow.updateOne({ _id: flow._id }, { $inc: { startCount: 1 } });

    console.log(`🚀 Started flow: ${flow.name} (step: ${currentStep.stepId})`);

    // Check if this is a dynamic message step
    if (currentStep.message.startsWith('DYNAMIC:')) {
      const dynamicResult = await handleDynamicMessage(currentStep, collectedData, convo, psid);
      if (dynamicResult) {
        // Handle special actions from dynamic result
        if (dynamicResult.action === 'handoff') {
          await updateConversation(psid, { activeFlow: null });
          const handoffRes = await executeHandoff(psid, convo, '', {
            reason: dynamicResult.handoffReason || `Flow: ${flow.name}`,
            responsePrefix: dynamicResult.message,
            skipChecklist: true,
            timingStyle: 'none'
          });
          return {
            ...handoffRes,
            handledBy: `flow_${flow.key}_handoff`
          };
        }

        // Update options if dynamic response provides them
        if (dynamicResult.options && dynamicResult.options.length > 0) {
          currentStep.options = dynamicResult.options;
        }

        return {
          type: "text",
          text: dynamicResult.message,
          handledBy: `flow_${flow.key}`,
          flowState: {
            ...flowState,
            stepType: currentStep.inputType,
            options: dynamicResult.options || currentStep.options
          }
        };
      }
    }

    // Return the step's message
    return {
      type: "text",
      text: currentStep.message,
      handledBy: `flow_${flow.key}`,
      flowState: {
        ...flowState,
        stepType: currentStep.inputType,
        options: currentStep.options
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

    // Check if this is a dynamic message step
    if (nextStep.message.startsWith('DYNAMIC:')) {
      const dynamicResult = await handleDynamicMessage(nextStep, updatedData, convo, psid);
      if (dynamicResult) {
        // Handle special actions from dynamic result
        if (dynamicResult.action === 'handoff') {
          await updateConversation(psid, { activeFlow: null });
          const handoffRes2 = await executeHandoff(psid, convo, userMessage, {
            reason: dynamicResult.handoffReason || `Flow: ${flow.name}`,
            responsePrefix: dynamicResult.message,
            skipChecklist: true,
            timingStyle: 'none',
            extraState: { flowCollectedData: updatedData }
          });
          return {
            ...handoffRes2,
            handledBy: `flow_${flow.key}_handoff`
          };
        }

        if (dynamicResult.action === 'message') {
          // Complete the flow with a message
          await clearFlowState(psid);
          return {
            type: "text",
            text: dynamicResult.message,
            handledBy: `flow_${flow.key}_complete`
          };
        }

        // If repeatStep is specified, go back to that step
        if (dynamicResult.repeatStep) {
          const repeatStep = flow.getStep(dynamicResult.repeatStep);
          if (repeatStep) {
            newFlowState.currentStep = repeatStep.stepId;
            await updateConversation(psid, { activeFlow: newFlowState });
            return {
              type: "text",
              text: dynamicResult.message,
              handledBy: `flow_${flow.key}`,
              flowState: {
                ...newFlowState,
                stepType: repeatStep.inputType,
                options: repeatStep.options
              }
            };
          }
        }

        // Update options if dynamic response provides them
        if (dynamicResult.options && dynamicResult.options.length > 0) {
          nextStep.options = dynamicResult.options;
        }

        return {
          type: "text",
          text: dynamicResult.message,
          handledBy: `flow_${flow.key}`,
          flowState: {
            ...newFlowState,
            stepType: nextStep.inputType,
            options: dynamicResult.options || nextStep.options
          }
        };
      }
    }

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
    case 'handoff': {
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

      const completeHandoff = await executeHandoff(psid, convo, '', {
        reason: onComplete.handoffReason || `Flow: ${flow.name}`,
        responsePrefix: onComplete.message || '',
        skipChecklist: true,
        timingStyle: onComplete.message ? 'none' : 'elaborate',
        notificationText: `Flow completado: ${flow.name}\n${handoffNotes}`,
        extraState: { flowCollectedData: collectedData, handoffNotes }
      });
      return {
        ...completeHandoff,
        handledBy: `flow_${flow.key}_complete_handoff`
      };
    }

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
