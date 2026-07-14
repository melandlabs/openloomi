/**
 * Loop barrel export. The server entry, the pet, and the CLI all import
 * from here. Server-only modules (paths, store, runner, scheduler) require
 * the Node.js runtime — they're never imported by client components.
 */

export * from "./types";
export {
  classify,
  isHardSkipped,
  isMuted,
  gateSignal,
  rules,
} from "./classify";
export { listConnectors, refreshConnectors } from "./connectors";
export { LOOP_HOME, LOOP_PATHS, ensureDirs, migrate } from "./paths";
export {
  decisions,
  signals,
  mutes,
  muteKeyFor,
  MUTABLE_DECISION_TYPES,
  readStatus,
  writeStatus,
  log,
} from "./store";
export {
  runDecision,
  dismissDecision,
  promoteDecision,
  recordMuteOnDismiss,
} from "./runner";
export { run as runTick } from "./tick";
export { runOnce as runWatcher } from "./watcher";
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
export { QUIET_DAY_MODULES, runQuietDayModule } from "./quiet-modules";
export type { QuietDayContext, QuietDayModule } from "./quiet-modules";
export {
  customTypes,
  validateCustomType,
  BUILTIN_ACTION_KINDS,
  BUILTIN_DECISION_TYPES,
  CUSTOM_TYPE_ID_RE,
  REMIX_ICON_RE,
} from "./custom-types";
export type {
  CustomDecisionType,
  CustomTypeValidationResult,
  BuiltInActionKind,
} from "./custom-types";
export {
  customChannels,
  validateCustomChannel,
  CUSTOM_CHANNEL_ID_RE,
  COMPOSIO_SLUG_RE,
  FILTER_OPS,
  MIN_POLL_INTERVAL_SEC,
  DEFAULT_POLL_INTERVAL_SEC,
} from "./custom-channels";
export type {
  CustomChannel,
  ChannelEventFilter,
  FilterOp,
  CustomChannelValidationResult,
} from "./custom-channels";
export {
  classifierRules,
  validateClassifierRule,
  evaluateRule,
  findMatchingRule,
  resolveField,
  RULE_OPS,
  RULE_ID_RE,
} from "./classifier-rules";
export type {
  ClassifierRule,
  ClassifierRulesFile,
  RuleCondition,
  RuleAction,
  RuleOp,
  RuleEvaluation,
  ClassifierRuleValidationResult,
} from "./classifier-rules";
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
/**
 * Re-exports from lib/cron/service so the loop's action-scheduling API
 * (/api/loop/action/schedule + DELETE /api/loop/action/[id]) has a
 * single import surface. Server-only — never imported from client code.
 */
export { createJob, deleteJob, getJob } from "@/lib/cron/service";
