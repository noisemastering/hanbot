// ai/flows/groundcoverFlow.js
// Thin re-export — groundcover is now handled by the unified rolloFlow
// Kept for backward compatibility with any imports we might have missed

const rolloFlow = require("./rolloFlow");

module.exports = {
  handle: rolloFlow.handle,
  handleStart: rolloFlow.handleStart,
  shouldHandle: rolloFlow.shouldHandle,
  STAGES: rolloFlow.STAGES,
  getFlowState: rolloFlow.getFlowState,
  determineStage: rolloFlow.determineStage
};
