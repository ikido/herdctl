/**
 * Error classes for scheduler module
 *
 * Provides typed errors with descriptive messages for scheduler operations.
 */

// =============================================================================
// Base Error Class
// =============================================================================

/**
 * Base error class for all scheduler errors
 */
export class SchedulerError extends Error {
  constructor(message: string, options?: { cause?: Error }) {
    super(message);
    this.name = "SchedulerError";
    this.cause = options?.cause;
  }
}

// =============================================================================
// Interval Parse Errors
// =============================================================================

/**
 * Error thrown when an interval string cannot be parsed
 *
 * This error provides detailed information about what went wrong during parsing,
 * including the invalid input and suggestions for valid formats.
 */
export class IntervalParseError extends SchedulerError {
  /** The original input string that failed to parse */
  public readonly input: string;

  constructor(message: string, input: string, options?: { cause?: Error }) {
    super(message, options);
    this.name = "IntervalParseError";
    this.input = input;
  }
}

// =============================================================================
// Schedule Trigger Errors
// =============================================================================

/**
 * Error thrown when a schedule trigger fails during execution
 *
 * This error wraps the underlying cause and provides context about which
 * agent and schedule encountered the error. It is used internally by the
 * Scheduler to capture and report trigger failures while allowing the
 * scheduler to continue processing other schedules.
 */
export class ScheduleTriggerError extends SchedulerError {
  /** The name of the agent that owns the schedule */
  public readonly agentName: string;

  /** The name of the schedule that failed */
  public readonly scheduleName: string;

  constructor(
    message: string,
    agentName: string,
    scheduleName: string,
    options?: { cause?: Error }
  ) {
    super(message, options);
    this.name = "ScheduleTriggerError";
    this.agentName = agentName;
    this.scheduleName = scheduleName;
  }
}

// =============================================================================
// Scheduler Shutdown Errors
// =============================================================================

/**
 * Error thrown when scheduler shutdown encounters issues
 *
 * This error is thrown when the scheduler cannot shut down cleanly,
 * typically due to running jobs not completing within the configured timeout.
 */
export class SchedulerShutdownError extends SchedulerError {
  /** Whether the shutdown timed out waiting for jobs to complete */
  public readonly timedOut: boolean;

  /** Number of jobs that were still running when shutdown completed/timed out */
  public readonly runningJobCount: number;

  constructor(
    message: string,
    options: { timedOut: boolean; runningJobCount: number; cause?: Error }
  ) {
    super(message, { cause: options.cause });
    this.name = "SchedulerShutdownError";
    this.timedOut = options.timedOut;
    this.runningJobCount = options.runningJobCount;
  }
}
