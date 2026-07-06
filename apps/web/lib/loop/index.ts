/**
 * Loop barrel export. The server entry, the pet, and the CLI all import
 * from here. Server-only modules (paths, store, runner, scheduler) require
 * the Node.js runtime — they're never imported by client components.
 */

export * from "./types";
export { classify, isHardSkipped, rules } from "./classify";
export { listConnectors, refreshConnectors } from "./connectors";
export { LOOP_HOME, LOOP_PATHS, ensureDirs, migrate } from "./paths";
export { decisions, signals, readStatus, writeStatus, log } from "./store";
export { runDecision, dismissDecision, promoteDecision } from "./runner";
export { run as runTick } from "./tick";
export { build as buildBrief, buildAndEnqueue as enqueueBrief } from "./brief";
export { build as buildWrap, buildAndEnqueue as enqueueWrap } from "./wrap";
export {
  start as startScheduler,
  stop as stopScheduler,
  status as schedulerStatus,
  isStarted as isSchedulerStarted,
  ensureLoopJobs,
  syncLoopJobsForUser,
  setActiveUser,
  removeLoopJobs,
  LOOP_JOB_NAMES,
  briefTimeToCron,
} from "./scheduler";
export { registerLoopHandlers, LOOP_HANDLER_NAMES } from "./handlers";
export { readPreferences, writePreferences } from "./preferences";
export {
  state,
  listDecisions,
  getDecision,
  getCard,
  applyDecisionAction,
  connectors,
  triggerBrief,
  triggerWrap,
  triggerTick,
  getPreferences,
  setPreferences,
  setPreferencesForUser,
} from "./server";
export type {
  BriefActionResult,
  DecisionActionInput,
  LoopCardPayload,
} from "./server";
