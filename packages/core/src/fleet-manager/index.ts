/**
 * Fleet Manager module
 *
 * Provides the high-level FleetManager class for library consumers to
 * initialize and run agent fleets with minimal configuration.
 */

// Main class
export { FleetManager } from "./fleet-manager.js";

// Context interface for module composition
export type { FleetManagerContext } from "./context.js";

// Module classes (new pattern for composition)
export { StatusQueries } from "./status-queries.js";
export { ScheduleManagement } from "./schedule-management.js";
export { ConfigReload } from "./config-reload.js";
export { JobControl } from "./job-control.js";
export { LogStreaming } from "./log-streaming.js";
export { ScheduleExecutor } from "./schedule-executor.js";

// Event emitters (US-4: Extract Event Emitters Module)
export {
  emitConfigReloaded,
  emitAgentStarted,
  emitAgentStopped,
  emitScheduleSkipped,
  emitJobCreated,
  emitJobOutput,
  emitJobCompleted,
  emitJobFailed,
  emitJobCancelled,
  emitJobForked,
  type FleetManagerEventEmitter,
} from "./event-emitters.js";

// Status queries (US-3: Extract Status Queries Module)
export {
  getFleetStatus,
  getAgentInfo,
  getAgentInfoByName,
  readFleetStateSnapshot,
  buildAgentInfo,
  buildScheduleInfoList,
  computeFleetCounts,
  type StatusQueryDependencies,
  type FleetStateSnapshot,
} from "./status-queries.js";

// Schedule management (US-5: Extract Schedule Management Module)
export {
  getSchedules,
  getSchedule,
  enableSchedule,
  disableSchedule,
  validateAgent,
  validateSchedule,
  getScheduleNames,
  isScheduleEnabled,
  getEnabledSchedules,
  getDisabledSchedules,
  getAgentSchedules,
  type ScheduleManagementDependencies,
} from "./schedule-management.js";

// Config reload (US-6: Extract Config Reload Module)
export {
  reload,
  computeConfigChanges,
  computeScheduleChanges,
  getAgentModifications,
  isAgentModified,
  isScheduleModified,
  getScheduleModificationDetails,
  getChangesSummary,
  filterChangesByCategory,
  filterChangesByType,
  hasAgentChanges,
  hasScheduleChanges,
  getAddedAgentNames,
  getRemovedAgentNames,
  getModifiedAgentNames,
  type ConfigReloadDependencies,
} from "./config-reload.js";

// Job control (US-7: Extract Job Control Module)
export {
  trigger,
  cancelJob,
  forkJob,
  cancelRunningJobs,
  getJobById,
  jobExists,
  isJobRunning,
  canCancelJob,
  type JobControlDependencies,
} from "./job-control.js";

// Log streaming (US-8: Extract Log Streaming Module)
export {
  streamLogs,
  streamJobOutput,
  streamAgentLogs,
  jobOutputToLogEntry,
  shouldYieldLog,
  getLogLevelOrder,
  compareLogLevels,
  meetsLogLevel,
  createLogLevelFilter,
  createAgentFilter,
  createJobFilter,
  combineLogFilters,
  createLogEntry,
  formatLogEntry,
  type LogStreamingDependencies,
} from "./log-streaming.js";

// Job Manager (US-4)
export { JobManager } from "./job-manager.js";

// Job Queue (US-10: Concurrency Control)
export { JobQueue } from "./job-queue.js";
export type {
  JobQueueOptions,
  JobQueueLogger,
  JobPriority,
  QueuedJob,
  EnqueueOptions,
  EnqueueResult,
  ScheduleSkipResult,
  AgentQueueStatus,
  QueueStatus,
  JobQueueEventMap,
} from "./job-queue.js";
export type {
  Job,
  JobFilter,
  JobListResult,
  GetJobOptions,
  JobRetentionConfig,
  JobManagerOptions,
  JobManagerLogger,
  JobOutputStreamEvents,
  JobOutputStream,
} from "./job-manager.js";

// Types
export type {
  FleetManagerOptions,
  FleetManagerState,
  FleetManagerStatus,
  FleetManagerLogger,
  FleetManagerEvents,
  // Event types (US-2)
  FleetManagerEventMap,
  FleetManagerEventName,
  FleetManagerEventPayload,
  FleetManagerEventListener,
  ConfigChange,
  ConfigReloadedPayload,
  AgentStartedPayload,
  AgentStoppedPayload,
  ScheduleTriggeredPayload,
  ScheduleSkippedPayload,
  JobCreatedPayload,
  JobOutputPayload,
  JobCompletedPayload,
  JobFailedPayload,
  // Job control event types (US-6)
  JobCancelledPayload,
  JobForkedPayload,
  // Status query types (US-3)
  FleetStatus,
  AgentInfo,
  ScheduleInfo,
  FleetCounts,
  // Trigger types (US-5)
  TriggerOptions,
  TriggerResult,
  // Job control types (US-6)
  JobModifications,
  CancelJobResult,
  ForkJobResult,
  // Stop options (US-8)
  FleetManagerStopOptions,
  // Log streaming types (US-11)
  LogLevel,
  LogSource,
  LogEntry,
  LogStreamOptions,
} from "./types.js";

// Error codes and types
export {
  FleetManagerErrorCode,
  type FleetManagerErrorCode as FleetManagerErrorCodeType,
} from "./errors.js";

// Error classes
export {
  // Base error
  FleetManagerError,
  // New error classes (US-12)
  ConfigurationError,
  AgentNotFoundError,
  JobNotFoundError,
  ScheduleNotFoundError,
  InvalidStateError,
  ConcurrencyLimitError,
  // Job control error classes (US-6)
  JobCancelError,
  JobForkError,
  // Legacy error classes (backwards compatibility)
  FleetManagerStateError,
  FleetManagerConfigError,
  FleetManagerStateDirError,
  FleetManagerShutdownError,
} from "./errors.js";

// Validation error interface for ConfigurationError
export type { ValidationError } from "./errors.js";

// Type guards for error handling
export {
  isFleetManagerError,
  isConfigurationError,
  isAgentNotFoundError,
  isJobNotFoundError,
  isScheduleNotFoundError,
  isInvalidStateError,
  isConcurrencyLimitError,
  // Job control error type guards (US-6)
  isJobCancelError,
  isJobForkError,
} from "./errors.js";
