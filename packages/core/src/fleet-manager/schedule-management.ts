/**
 * Schedule Management Module
 *
 * Centralizes all schedule management logic for FleetManager.
 * Provides methods to query, enable, and disable schedules.
 *
 * @module schedule-management
 */

import type { ResolvedAgent, ResolvedConfig } from "../config/index.js";
import type { AgentState, FleetState } from "../state/schemas/fleet-state.js";
import type { StateDirectory } from "../state/index.js";
import type {
  FleetManagerLogger,
  ScheduleInfo,
} from "./types.js";
import type { FleetManagerContext } from "./context.js";
import { AgentNotFoundError, ScheduleNotFoundError } from "./errors.js";
import { buildScheduleInfoList, type FleetStateSnapshot } from "./status-queries.js";

// =============================================================================
// Dependencies Interface (Kept for backwards compatibility)
// =============================================================================

/**
 * Dependencies required by schedule management functions.
 *
 * This interface allows FleetManager to inject its internal state
 * for schedule management without exposing implementation details.
 *
 * @deprecated Use ScheduleManagement class with FleetManagerContext instead
 */
export interface ScheduleManagementDependencies {
  /** Path to the state directory */
  stateDir: string;

  /** State directory info (null if not initialized) */
  stateDirInfo: StateDirectory | null;

  /** Loaded configuration (null if not initialized) */
  config: ResolvedConfig | null;

  /** Logger for operations */
  logger: FleetManagerLogger;

  /** Function to read fleet state snapshot */
  readFleetStateSnapshot: () => Promise<FleetStateSnapshot>;
}

// =============================================================================
// ScheduleManagement Class
// =============================================================================

/**
 * ScheduleManagement provides all schedule management operations for the FleetManager.
 *
 * This class encapsulates the logic for querying, enabling, and disabling schedules
 * using the FleetManagerContext pattern.
 */
export class ScheduleManagement {
  constructor(
    private ctx: FleetManagerContext,
    private readFleetStateSnapshotFn: () => Promise<FleetStateSnapshot>
  ) {}

  /**
   * Get all schedules across all agents
   *
   * Returns a list of all configured schedules with their current state,
   * including next trigger times.
   *
   * @returns Array of ScheduleInfo objects with current state
   */
  async getSchedules(): Promise<ScheduleInfo[]> {
    const config = this.ctx.getConfig();
    const agents = config?.agents ?? [];
    const fleetState = await this.readFleetStateSnapshotFn();

    const allSchedules: ScheduleInfo[] = [];

    for (const agent of agents) {
      const agentState = fleetState.agents[agent.name];
      const schedules = buildScheduleInfoList(agent, agentState);
      allSchedules.push(...schedules);
    }

    return allSchedules;
  }

  /**
   * Get a specific schedule by agent name and schedule name
   *
   * @param agentName - The name of the agent
   * @param scheduleName - The name of the schedule
   * @returns The schedule info with current state
   * @throws {AgentNotFoundError} If the agent doesn't exist
   * @throws {ScheduleNotFoundError} If the schedule doesn't exist
   */
  async getSchedule(agentName: string, scheduleName: string): Promise<ScheduleInfo> {
    const config = this.ctx.getConfig();
    const agents = config?.agents ?? [];
    const agent = agents.find((a) => a.name === agentName);

    if (!agent) {
      throw new AgentNotFoundError(agentName, {
        availableAgents: agents.map((a) => a.name),
      });
    }

    if (!agent.schedules || !(scheduleName in agent.schedules)) {
      const availableSchedules = agent.schedules
        ? Object.keys(agent.schedules)
        : [];
      throw new ScheduleNotFoundError(agentName, scheduleName, {
        availableSchedules,
      });
    }

    const fleetState = await this.readFleetStateSnapshotFn();
    const agentState = fleetState.agents[agentName];
    const schedule = agent.schedules[scheduleName];
    const scheduleState = agentState?.schedules?.[scheduleName];

    return {
      name: scheduleName,
      agentName,
      type: schedule.type,
      interval: schedule.interval,
      expression: schedule.expression,
      status: scheduleState?.status ?? "idle",
      lastRunAt: scheduleState?.last_run_at ?? null,
      nextRunAt: scheduleState?.next_run_at ?? null,
      lastError: scheduleState?.last_error ?? null,
    };
  }

  /**
   * Enable a disabled schedule
   *
   * Enables a schedule that was previously disabled, allowing it to trigger
   * again on its configured interval. The enabled state is persisted to the
   * state directory and survives restarts.
   *
   * @param agentName - The name of the agent
   * @param scheduleName - The name of the schedule
   * @returns The updated schedule info
   * @throws {AgentNotFoundError} If the agent doesn't exist
   * @throws {ScheduleNotFoundError} If the schedule doesn't exist
   */
  async enableSchedule(agentName: string, scheduleName: string): Promise<ScheduleInfo> {
    const config = this.ctx.getConfig();
    const logger = this.ctx.getLogger();
    const stateDir = this.ctx.getStateDir();

    // Validate the agent and schedule exist
    const agents = config?.agents ?? [];
    const agent = agents.find((a) => a.name === agentName);

    if (!agent) {
      throw new AgentNotFoundError(agentName, {
        availableAgents: agents.map((a) => a.name),
      });
    }

    if (!agent.schedules || !(scheduleName in agent.schedules)) {
      const availableSchedules = agent.schedules
        ? Object.keys(agent.schedules)
        : [];
      throw new ScheduleNotFoundError(agentName, scheduleName, {
        availableSchedules,
      });
    }

    // Update schedule state to enabled (idle)
    const { updateScheduleState } = await import("../scheduler/schedule-state.js");
    await updateScheduleState(
      stateDir,
      agentName,
      scheduleName,
      { status: "idle" },
      { logger: { warn: logger.warn } }
    );

    logger.info(`Enabled schedule ${agentName}/${scheduleName}`);

    // Return the updated schedule info
    return this.getSchedule(agentName, scheduleName);
  }

  /**
   * Disable a schedule
   *
   * Disables a schedule, preventing it from triggering on its configured
   * interval. The schedule remains in the configuration but won't run until
   * re-enabled. The disabled state is persisted to the state directory and
   * survives restarts.
   *
   * @param agentName - The name of the agent
   * @param scheduleName - The name of the schedule
   * @returns The updated schedule info
   * @throws {AgentNotFoundError} If the agent doesn't exist
   * @throws {ScheduleNotFoundError} If the schedule doesn't exist
   */
  async disableSchedule(agentName: string, scheduleName: string): Promise<ScheduleInfo> {
    const config = this.ctx.getConfig();
    const logger = this.ctx.getLogger();
    const stateDir = this.ctx.getStateDir();

    // Validate the agent and schedule exist
    const agents = config?.agents ?? [];
    const agent = agents.find((a) => a.name === agentName);

    if (!agent) {
      throw new AgentNotFoundError(agentName, {
        availableAgents: agents.map((a) => a.name),
      });
    }

    if (!agent.schedules || !(scheduleName in agent.schedules)) {
      const availableSchedules = agent.schedules
        ? Object.keys(agent.schedules)
        : [];
      throw new ScheduleNotFoundError(agentName, scheduleName, {
        availableSchedules,
      });
    }

    // Update schedule state to disabled
    const { updateScheduleState } = await import("../scheduler/schedule-state.js");
    await updateScheduleState(
      stateDir,
      agentName,
      scheduleName,
      { status: "disabled" },
      { logger: { warn: logger.warn } }
    );

    logger.info(`Disabled schedule ${agentName}/${scheduleName}`);

    // Return the updated schedule info
    return this.getSchedule(agentName, scheduleName);
  }
}

// =============================================================================
// Legacy Function Wrappers (for backwards compatibility)
// =============================================================================

/**
 * Get all schedules across all agents
 *
 * @deprecated Use ScheduleManagement class instead
 * @param deps - Schedule management dependencies
 * @returns Array of ScheduleInfo objects with current state
 */
export async function getSchedules(
  deps: ScheduleManagementDependencies
): Promise<ScheduleInfo[]> {
  const agents = deps.config?.agents ?? [];
  const fleetState = await deps.readFleetStateSnapshot();

  const allSchedules: ScheduleInfo[] = [];

  for (const agent of agents) {
    const agentState = fleetState.agents[agent.name];
    const schedules = buildScheduleInfoList(agent, agentState);
    allSchedules.push(...schedules);
  }

  return allSchedules;
}

/**
 * Get a specific schedule by agent name and schedule name
 *
 * @deprecated Use ScheduleManagement class instead
 * @param deps - Schedule management dependencies
 * @param agentName - The name of the agent
 * @param scheduleName - The name of the schedule
 * @returns The schedule info with current state
 * @throws {AgentNotFoundError} If the agent doesn't exist
 * @throws {ScheduleNotFoundError} If the schedule doesn't exist
 */
export async function getSchedule(
  deps: ScheduleManagementDependencies,
  agentName: string,
  scheduleName: string
): Promise<ScheduleInfo> {
  const agents = deps.config?.agents ?? [];
  const agent = agents.find((a) => a.name === agentName);

  if (!agent) {
    throw new AgentNotFoundError(agentName, {
      availableAgents: agents.map((a) => a.name),
    });
  }

  if (!agent.schedules || !(scheduleName in agent.schedules)) {
    const availableSchedules = agent.schedules
      ? Object.keys(agent.schedules)
      : [];
    throw new ScheduleNotFoundError(agentName, scheduleName, {
      availableSchedules,
    });
  }

  const fleetState = await deps.readFleetStateSnapshot();
  const agentState = fleetState.agents[agentName];
  const schedule = agent.schedules[scheduleName];
  const scheduleState = agentState?.schedules?.[scheduleName];

  return {
    name: scheduleName,
    agentName,
    type: schedule.type,
    interval: schedule.interval,
    expression: schedule.expression,
    status: scheduleState?.status ?? "idle",
    lastRunAt: scheduleState?.last_run_at ?? null,
    nextRunAt: scheduleState?.next_run_at ?? null,
    lastError: scheduleState?.last_error ?? null,
  };
}

/**
 * Enable a disabled schedule
 *
 * @deprecated Use ScheduleManagement class instead
 * @param deps - Schedule management dependencies
 * @param agentName - The name of the agent
 * @param scheduleName - The name of the schedule
 * @returns The updated schedule info
 * @throws {AgentNotFoundError} If the agent doesn't exist
 * @throws {ScheduleNotFoundError} If the schedule doesn't exist
 */
export async function enableSchedule(
  deps: ScheduleManagementDependencies,
  agentName: string,
  scheduleName: string
): Promise<ScheduleInfo> {
  // Validate the agent and schedule exist
  const agents = deps.config?.agents ?? [];
  const agent = agents.find((a) => a.name === agentName);

  if (!agent) {
    throw new AgentNotFoundError(agentName, {
      availableAgents: agents.map((a) => a.name),
    });
  }

  if (!agent.schedules || !(scheduleName in agent.schedules)) {
    const availableSchedules = agent.schedules
      ? Object.keys(agent.schedules)
      : [];
    throw new ScheduleNotFoundError(agentName, scheduleName, {
      availableSchedules,
    });
  }

  // Update schedule state to enabled (idle)
  const { updateScheduleState } = await import("../scheduler/schedule-state.js");
  await updateScheduleState(
    deps.stateDir,
    agentName,
    scheduleName,
    { status: "idle" },
    { logger: { warn: deps.logger.warn } }
  );

  deps.logger.info(`Enabled schedule ${agentName}/${scheduleName}`);

  // Return the updated schedule info
  return getSchedule(deps, agentName, scheduleName);
}

/**
 * Disable a schedule
 *
 * @deprecated Use ScheduleManagement class instead
 * @param deps - Schedule management dependencies
 * @param agentName - The name of the agent
 * @param scheduleName - The name of the schedule
 * @returns The updated schedule info
 * @throws {AgentNotFoundError} If the agent doesn't exist
 * @throws {ScheduleNotFoundError} If the schedule doesn't exist
 */
export async function disableSchedule(
  deps: ScheduleManagementDependencies,
  agentName: string,
  scheduleName: string
): Promise<ScheduleInfo> {
  // Validate the agent and schedule exist
  const agents = deps.config?.agents ?? [];
  const agent = agents.find((a) => a.name === agentName);

  if (!agent) {
    throw new AgentNotFoundError(agentName, {
      availableAgents: agents.map((a) => a.name),
    });
  }

  if (!agent.schedules || !(scheduleName in agent.schedules)) {
    const availableSchedules = agent.schedules
      ? Object.keys(agent.schedules)
      : [];
    throw new ScheduleNotFoundError(agentName, scheduleName, {
      availableSchedules,
    });
  }

  // Update schedule state to disabled
  const { updateScheduleState } = await import("../scheduler/schedule-state.js");
  await updateScheduleState(
    deps.stateDir,
    agentName,
    scheduleName,
    { status: "disabled" },
    { logger: { warn: deps.logger.warn } }
  );

  deps.logger.info(`Disabled schedule ${agentName}/${scheduleName}`);

  // Return the updated schedule info
  return getSchedule(deps, agentName, scheduleName);
}

// =============================================================================
// Schedule Helper Functions
// =============================================================================

/**
 * Validate that an agent exists in the configuration
 *
 * @param deps - Schedule management dependencies
 * @param agentName - The agent name to validate
 * @returns The resolved agent configuration
 * @throws {AgentNotFoundError} If the agent doesn't exist
 */
export function validateAgent(
  deps: ScheduleManagementDependencies,
  agentName: string
): ResolvedAgent {
  const agents = deps.config?.agents ?? [];
  const agent = agents.find((a) => a.name === agentName);

  if (!agent) {
    throw new AgentNotFoundError(agentName, {
      availableAgents: agents.map((a) => a.name),
    });
  }

  return agent;
}

/**
 * Validate that a schedule exists for an agent
 *
 * @param agent - The resolved agent configuration
 * @param scheduleName - The schedule name to validate
 * @throws {ScheduleNotFoundError} If the schedule doesn't exist
 */
export function validateSchedule(
  agent: ResolvedAgent,
  scheduleName: string
): void {
  if (!agent.schedules || !(scheduleName in agent.schedules)) {
    const availableSchedules = agent.schedules
      ? Object.keys(agent.schedules)
      : [];
    throw new ScheduleNotFoundError(agent.name, scheduleName, {
      availableSchedules,
    });
  }
}

/**
 * Get available schedule names for an agent
 *
 * @param deps - Schedule management dependencies
 * @param agentName - The agent name
 * @returns Array of schedule names, or empty array if agent not found
 */
export function getScheduleNames(
  deps: ScheduleManagementDependencies,
  agentName: string
): string[] {
  const agents = deps.config?.agents ?? [];
  const agent = agents.find((a) => a.name === agentName);

  if (!agent || !agent.schedules) {
    return [];
  }

  return Object.keys(agent.schedules);
}

/**
 * Check if a schedule is currently enabled
 *
 * @param deps - Schedule management dependencies
 * @param agentName - The agent name
 * @param scheduleName - The schedule name
 * @returns True if the schedule is enabled (not disabled)
 */
export async function isScheduleEnabled(
  deps: ScheduleManagementDependencies,
  agentName: string,
  scheduleName: string
): Promise<boolean> {
  try {
    const schedule = await getSchedule(deps, agentName, scheduleName);
    return schedule.status !== "disabled";
  } catch {
    return false;
  }
}

/**
 * Get all enabled schedules across all agents
 *
 * @param deps - Schedule management dependencies
 * @returns Array of enabled ScheduleInfo objects
 */
export async function getEnabledSchedules(
  deps: ScheduleManagementDependencies
): Promise<ScheduleInfo[]> {
  const allSchedules = await getSchedules(deps);
  return allSchedules.filter((s) => s.status !== "disabled");
}

/**
 * Get all disabled schedules across all agents
 *
 * @param deps - Schedule management dependencies
 * @returns Array of disabled ScheduleInfo objects
 */
export async function getDisabledSchedules(
  deps: ScheduleManagementDependencies
): Promise<ScheduleInfo[]> {
  const allSchedules = await getSchedules(deps);
  return allSchedules.filter((s) => s.status === "disabled");
}

/**
 * Get schedules for a specific agent
 *
 * @param deps - Schedule management dependencies
 * @param agentName - The agent name
 * @returns Array of ScheduleInfo objects for the agent
 * @throws {AgentNotFoundError} If the agent doesn't exist
 */
export async function getAgentSchedules(
  deps: ScheduleManagementDependencies,
  agentName: string
): Promise<ScheduleInfo[]> {
  // Validate agent exists
  validateAgent(deps, agentName);

  const allSchedules = await getSchedules(deps);
  return allSchedules.filter((s) => s.agentName === agentName);
}
