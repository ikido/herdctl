/**
 * Log Streaming Module (US-8)
 *
 * Provides log streaming functionality as async generators for the FleetManager.
 * Isolates the async generator patterns for streaming logs from agents, jobs,
 * and the fleet.
 *
 * This module provides three main streaming functions:
 * - `streamLogs` - Stream all fleet logs with filtering options
 * - `streamJobOutput` - Stream output from a specific job
 * - `streamAgentLogs` - Stream logs for a specific agent
 */

import { join } from "node:path";
import type { EventEmitter } from "node:events";
import type { JobMetadata } from "../state/schemas/job-metadata.js";
import type { ResolvedConfig } from "../config/index.js";
import type {
  FleetManagerLogger,
  LogLevel,
  LogEntry,
  LogStreamOptions,
  JobOutputPayload,
} from "./types.js";
import type { FleetManagerContext } from "./context.js";
import { AgentNotFoundError, JobNotFoundError } from "./errors.js";

// =============================================================================
// Dependencies Interface (Kept for backwards compatibility)
// =============================================================================

/**
 * Dependencies required for log streaming operations
 *
 * This interface defines the minimal set of dependencies needed to perform
 * log streaming, allowing the functions to be easily tested and used
 * independently of the full FleetManager instance.
 *
 * @deprecated Use LogStreaming class with FleetManagerContext instead
 */
export interface LogStreamingDependencies {
  /**
   * Path to the state directory
   */
  stateDir: string;

  /**
   * Current configuration (for agent validation)
   */
  config: ResolvedConfig | null;

  /**
   * Logger for debug output
   */
  logger: FleetManagerLogger;

  /**
   * Event emitter for subscribing to job:output events
   */
  emitter: EventEmitter;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Log level severity ordering for filtering
 */
const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// =============================================================================
// LogStreaming Class
// =============================================================================

/**
 * LogStreaming provides log streaming operations for the FleetManager.
 *
 * This class encapsulates the logic for streaming logs from agents, jobs,
 * and the fleet using the FleetManagerContext pattern.
 */
export class LogStreaming {
  constructor(private ctx: FleetManagerContext) {}

  /**
   * Stream all fleet logs as an async iterable
   *
   * Provides a unified stream of logs from all sources in the fleet including
   * agents, jobs, and the scheduler. Logs can be filtered by level and optionally
   * by agent or job.
   *
   * @param options - Options for filtering and configuring the stream
   * @returns An async iterable of LogEntry objects
   */
  async *streamLogs(options?: LogStreamOptions): AsyncIterable<LogEntry> {
    yield* streamLogs(
      {
        stateDir: this.ctx.getStateDir(),
        config: this.ctx.getConfig(),
        logger: this.ctx.getLogger(),
        emitter: this.ctx.getEmitter(),
      },
      options
    );
  }

  /**
   * Stream output from a specific job as an async iterable
   *
   * @param jobId - The ID of the job to stream output from
   * @returns An async iterable of LogEntry objects
   * @throws {JobNotFoundError} If the job doesn't exist
   */
  async *streamJobOutput(jobId: string): AsyncIterable<LogEntry> {
    yield* streamJobOutput(
      {
        stateDir: this.ctx.getStateDir(),
        config: this.ctx.getConfig(),
        logger: this.ctx.getLogger(),
        emitter: this.ctx.getEmitter(),
      },
      jobId
    );
  }

  /**
   * Stream logs for a specific agent as an async iterable
   *
   * @param agentName - The name of the agent to stream logs for
   * @returns An async iterable of LogEntry objects
   * @throws {AgentNotFoundError} If the agent doesn't exist in the configuration
   */
  async *streamAgentLogs(agentName: string): AsyncIterable<LogEntry> {
    yield* streamAgentLogs(
      {
        stateDir: this.ctx.getStateDir(),
        config: this.ctx.getConfig(),
        logger: this.ctx.getLogger(),
        emitter: this.ctx.getEmitter(),
      },
      agentName
    );
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Convert a job output message to a LogEntry
 *
 * Transforms raw job output (as stored in JSONL files) into a structured
 * LogEntry for the streaming API.
 *
 * @param job - The job metadata
 * @param msg - The raw output message
 * @returns A LogEntry representing the message
 */
export function jobOutputToLogEntry(
  job: JobMetadata,
  msg: { type: string; content?: string; timestamp?: string }
): LogEntry {
  // Determine log level based on message type
  let level: LogLevel = "info";
  if (msg.type === "error") {
    level = "error";
  } else if (msg.type === "system") {
    level = "debug";
  }

  return {
    timestamp: msg.timestamp ?? new Date().toISOString(),
    level,
    source: "job",
    agentName: job.agent,
    jobId: job.id,
    scheduleName: job.schedule ?? undefined,
    message: msg.content ?? "",
    data: { type: msg.type },
  };
}

/**
 * Determine if a log entry should be yielded based on filters
 *
 * Checks log level, agent name, and job ID filters to determine
 * if an entry should be included in the stream.
 *
 * @param entry - The log entry to check
 * @param minLevel - Minimum log level to include
 * @param agentFilter - Optional agent name filter
 * @param jobFilter - Optional job ID filter
 * @returns True if the entry should be yielded
 */
export function shouldYieldLog(
  entry: LogEntry,
  minLevel: LogLevel,
  agentFilter?: string,
  jobFilter?: string
): boolean {
  // Check log level
  if (LOG_LEVEL_ORDER[entry.level] < LOG_LEVEL_ORDER[minLevel]) {
    return false;
  }

  // Check agent filter
  if (agentFilter && entry.agentName !== agentFilter) {
    return false;
  }

  // Check job filter
  if (jobFilter && entry.jobId !== jobFilter) {
    return false;
  }

  return true;
}

/**
 * Get the log level order value
 *
 * Utility function to get the numeric ordering of a log level.
 *
 * @param level - The log level
 * @returns The numeric ordering (0=debug, 1=info, 2=warn, 3=error)
 */
export function getLogLevelOrder(level: LogLevel): number {
  return LOG_LEVEL_ORDER[level];
}

/**
 * Compare two log levels
 *
 * @param a - First log level
 * @param b - Second log level
 * @returns Negative if a < b, 0 if equal, positive if a > b
 */
export function compareLogLevels(a: LogLevel, b: LogLevel): number {
  return LOG_LEVEL_ORDER[a] - LOG_LEVEL_ORDER[b];
}

/**
 * Check if a log level meets the minimum threshold
 *
 * @param level - The log level to check
 * @param minLevel - The minimum required level
 * @returns True if level >= minLevel
 */
export function meetsLogLevel(level: LogLevel, minLevel: LogLevel): boolean {
  return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[minLevel];
}

// =============================================================================
// Main Streaming Functions
// =============================================================================

/**
 * Stream all fleet logs as an async iterable
 *
 * Provides a unified stream of logs from all sources in the fleet including
 * agents, jobs, and the scheduler. Logs can be filtered by level and optionally
 * by agent or job.
 *
 * For completed jobs, this will replay their history (if includeHistory is true)
 * before streaming new logs from running jobs.
 *
 * @param deps - Dependencies for log streaming
 * @param options - Options for filtering and configuring the stream
 * @returns An async iterable of LogEntry objects
 *
 * @example
 * ```typescript
 * // Stream all info+ logs
 * for await (const log of streamLogs(deps)) {
 *   console.log(`[${log.level}] ${log.message}`);
 * }
 *
 * // Stream only errors for a specific agent
 * for await (const log of streamLogs(deps, {
 *   level: 'error',
 *   agentName: 'my-agent',
 * })) {
 *   console.error(log.message);
 * }
 * ```
 */
export async function* streamLogs(
  deps: LogStreamingDependencies,
  options?: LogStreamOptions
): AsyncIterable<LogEntry> {
  const level = options?.level ?? "info";
  const includeHistory = options?.includeHistory ?? true;
  const historyLimit = options?.historyLimit ?? 1000;
  const agentFilter = options?.agentName;
  const jobFilter = options?.jobId;

  const jobsDir = join(deps.stateDir, "jobs");
  const { readJobOutputAll } = await import("../state/job-output.js");
  const { listJobs } = await import("../state/index.js");

  // Replay historical logs if requested
  if (includeHistory) {
    // Get jobs to replay history from
    const jobsResult = await listJobs(
      jobsDir,
      agentFilter ? { agent: agentFilter } : {},
      { logger: deps.logger }
    );

    // Filter by job ID if specified
    let jobs = jobsResult.jobs;
    if (jobFilter) {
      jobs = jobs.filter((j) => j.id === jobFilter);
    }

    // Sort by started_at ascending to replay in chronological order
    jobs.sort(
      (a, b) =>
        new Date(a.started_at).getTime() - new Date(b.started_at).getTime()
    );

    let yielded = 0;
    for (const job of jobs) {
      if (yielded >= historyLimit) break;

      // Read job output and convert to log entries
      const output = await readJobOutputAll(jobsDir, job.id, {
        skipInvalidLines: true,
        logger: deps.logger,
      });

      for (const msg of output) {
        if (yielded >= historyLimit) break;

        const logEntry = jobOutputToLogEntry(job, msg);
        if (shouldYieldLog(logEntry, level, agentFilter, jobFilter)) {
          yield logEntry;
          yielded++;
        }
      }
    }
  }

  // For running jobs, subscribe to job:output events
  const outputQueue: LogEntry[] = [];
  let resolveWait: (() => void) | null = null;
  let stopped = false;

  const outputHandler = (payload: JobOutputPayload) => {
    if (stopped) return;

    const logEntry: LogEntry = {
      timestamp: payload.timestamp,
      level: "info",
      source: "job",
      agentName: payload.agentName,
      jobId: payload.jobId,
      message: payload.output,
    };

    if (shouldYieldLog(logEntry, level, agentFilter, jobFilter)) {
      outputQueue.push(logEntry);
      if (resolveWait) {
        resolveWait();
        resolveWait = null;
      }
    }
  };

  deps.emitter.on("job:output", outputHandler);

  try {
    // Yield queued entries as they arrive
    while (!stopped) {
      while (outputQueue.length > 0) {
        const entry = outputQueue.shift()!;
        yield entry;
      }

      // Wait for more entries
      await new Promise<void>((resolve) => {
        resolveWait = resolve;
        // Add timeout to prevent hanging forever
        setTimeout(resolve, 1000);
      });
    }
  } finally {
    stopped = true;
    deps.emitter.off("job:output", outputHandler);
  }
}

/**
 * Stream output from a specific job as an async iterable
 *
 * Provides a stream of log entries for a specific job. For completed jobs,
 * this will replay the job's history and then complete. For running jobs,
 * it will continue streaming until the job completes.
 *
 * @param deps - Dependencies for log streaming
 * @param jobId - The ID of the job to stream output from
 * @returns An async iterable of LogEntry objects
 * @throws {JobNotFoundError} If the job doesn't exist
 *
 * @example
 * ```typescript
 * // Stream job output
 * for await (const log of streamJobOutput(deps, 'job-2024-01-15-abc123')) {
 *   console.log(`[${log.level}] ${log.message}`);
 * }
 * ```
 */
export async function* streamJobOutput(
  deps: LogStreamingDependencies,
  jobId: string
): AsyncIterable<LogEntry> {
  const jobsDir = join(deps.stateDir, "jobs");
  const { getJob } = await import("../state/index.js");

  // Verify job exists
  const job = await getJob(jobsDir, jobId, { logger: deps.logger });
  if (!job) {
    throw new JobNotFoundError(jobId);
  }

  const { readJobOutputAll, getJobOutputPath } = await import(
    "../state/job-output.js"
  );
  const { watch } = await import("node:fs");
  const { stat } = await import("node:fs/promises");
  const { createReadStream } = await import("node:fs");
  const { createInterface } = await import("node:readline");

  const outputPath = getJobOutputPath(jobsDir, jobId);

  // First, replay all existing output
  const existingOutput = await readJobOutputAll(jobsDir, jobId, {
    skipInvalidLines: true,
    logger: deps.logger,
  });

  for (const msg of existingOutput) {
    yield jobOutputToLogEntry(job, msg);
  }

  // If job is already completed, we're done
  if (job.status !== "running" && job.status !== "pending") {
    return;
  }

  // For running jobs, watch for new output
  const outputQueue: LogEntry[] = [];
  let resolveWait: (() => void) | null = null;
  let stopped = false;
  let lastReadPosition = 0;

  // Get current file position
  try {
    const stats = await stat(outputPath);
    lastReadPosition = stats.size;
  } catch {
    // File doesn't exist yet
  }

  // Watch for file changes
  let watcher: import("node:fs").FSWatcher | null = null;
  try {
    watcher = watch(outputPath, async (eventType) => {
      if (stopped || eventType !== "change") return;

      try {
        const currentStats = await stat(outputPath);
        if (currentStats.size > lastReadPosition) {
          // Read new content
          const fileStream = createReadStream(outputPath, {
            encoding: "utf-8",
            start: lastReadPosition,
          });

          const rl = createInterface({
            input: fileStream,
            crlfDelay: Infinity,
          });

          for await (const line of rl) {
            if (stopped) break;
            const trimmedLine = line.trim();
            if (trimmedLine === "") continue;

            try {
              const parsed = JSON.parse(trimmedLine);
              const logEntry = jobOutputToLogEntry(job, parsed);
              outputQueue.push(logEntry);
              if (resolveWait) {
                resolveWait();
                resolveWait = null;
              }
            } catch {
              // Skip malformed lines
            }
          }

          rl.close();
          fileStream.destroy();
          lastReadPosition = currentStats.size;
        }
      } catch (err) {
        deps.logger.warn(
          `Error reading output file: ${(err as Error).message}`
        );
      }
    });
  } catch {
    // Can't watch file - might not exist yet
  }

  // Poll for job completion
  const checkJobComplete = async (): Promise<boolean> => {
    const { getJob: getJobFn } = await import("../state/index.js");
    const currentJob = await getJobFn(jobsDir, jobId, { logger: deps.logger });
    return (
      !currentJob ||
      (currentJob.status !== "running" && currentJob.status !== "pending")
    );
  };

  try {
    // Yield queued entries as they arrive
    while (!stopped) {
      while (outputQueue.length > 0) {
        const entry = outputQueue.shift()!;
        yield entry;
      }

      // Check if job is complete
      if (await checkJobComplete()) {
        stopped = true;
        break;
      }

      // Wait for more entries
      await new Promise<void>((resolve) => {
        resolveWait = resolve;
        setTimeout(resolve, 1000);
      });
    }
  } finally {
    stopped = true;
    if (watcher) {
      watcher.close();
    }
  }
}

/**
 * Stream logs for a specific agent as an async iterable
 *
 * Provides a stream of log entries for all jobs belonging to a specific agent.
 * For completed jobs, this will replay their history. For running jobs, it
 * will continue streaming until the iterator is stopped.
 *
 * @param deps - Dependencies for log streaming
 * @param agentName - The name of the agent to stream logs for
 * @returns An async iterable of LogEntry objects
 * @throws {AgentNotFoundError} If the agent doesn't exist in the configuration
 *
 * @example
 * ```typescript
 * // Stream all logs for an agent
 * for await (const log of streamAgentLogs(deps, 'my-agent')) {
 *   console.log(`[${log.jobId}] ${log.message}`);
 * }
 * ```
 */
export async function* streamAgentLogs(
  deps: LogStreamingDependencies,
  agentName: string
): AsyncIterable<LogEntry> {
  // Verify agent exists
  const agents = deps.config?.agents ?? [];
  const agent = agents.find((a) => a.name === agentName);

  if (!agent) {
    throw new AgentNotFoundError(agentName, {
      availableAgents: agents.map((a) => a.name),
    });
  }

  // Delegate to streamLogs with agent filter
  yield* streamLogs(deps, {
    agentName,
    includeHistory: true,
  });
}

// =============================================================================
// Utility Functions for Log Processing
// =============================================================================

/**
 * Filter log entries by level
 *
 * Creates a filtering function that only passes logs at or above
 * the specified level.
 *
 * @param minLevel - Minimum log level to include
 * @returns A filter function
 */
export function createLogLevelFilter(
  minLevel: LogLevel
): (entry: LogEntry) => boolean {
  return (entry: LogEntry) => meetsLogLevel(entry.level, minLevel);
}

/**
 * Filter log entries by agent
 *
 * Creates a filtering function that only passes logs from
 * the specified agent.
 *
 * @param agentName - Agent name to filter by
 * @returns A filter function
 */
export function createAgentFilter(
  agentName: string
): (entry: LogEntry) => boolean {
  return (entry: LogEntry) => entry.agentName === agentName;
}

/**
 * Filter log entries by job
 *
 * Creates a filtering function that only passes logs from
 * the specified job.
 *
 * @param jobId - Job ID to filter by
 * @returns A filter function
 */
export function createJobFilter(jobId: string): (entry: LogEntry) => boolean {
  return (entry: LogEntry) => entry.jobId === jobId;
}

/**
 * Combine multiple log filters
 *
 * Creates a filter that passes only if all provided filters pass.
 *
 * @param filters - Array of filter functions
 * @returns A combined filter function
 */
export function combineLogFilters(
  ...filters: ((entry: LogEntry) => boolean)[]
): (entry: LogEntry) => boolean {
  return (entry: LogEntry) => filters.every((f) => f(entry));
}

/**
 * Create a log entry from raw data
 *
 * Factory function for creating LogEntry objects with proper defaults.
 *
 * @param data - Partial log entry data
 * @returns A complete LogEntry
 */
export function createLogEntry(
  data: Partial<LogEntry> & { message: string }
): LogEntry {
  return {
    timestamp: data.timestamp ?? new Date().toISOString(),
    level: data.level ?? "info",
    source: data.source ?? "fleet",
    agentName: data.agentName,
    jobId: data.jobId,
    scheduleName: data.scheduleName,
    message: data.message,
    data: data.data,
  };
}

/**
 * Format a log entry as a string
 *
 * Creates a human-readable string representation of a log entry.
 *
 * @param entry - The log entry to format
 * @param options - Formatting options
 * @returns A formatted string
 */
export function formatLogEntry(
  entry: LogEntry,
  options?: {
    includeTimestamp?: boolean;
    includeSource?: boolean;
    includeContext?: boolean;
  }
): string {
  const parts: string[] = [];

  if (options?.includeTimestamp !== false) {
    parts.push(`[${entry.timestamp}]`);
  }

  parts.push(`[${entry.level.toUpperCase()}]`);

  if (options?.includeSource !== false && entry.source) {
    parts.push(`[${entry.source}]`);
  }

  if (options?.includeContext !== false) {
    if (entry.agentName) {
      parts.push(`[${entry.agentName}]`);
    }
    if (entry.jobId) {
      parts.push(`[${entry.jobId}]`);
    }
  }

  parts.push(entry.message);

  return parts.join(" ");
}
