/**
 * Type definitions for Slack session management
 *
 * Provides interfaces for per-channel session state tracking,
 * enabling conversation context preservation across Slack channels.
 */

import { z } from "zod";

// =============================================================================
// Session Schema
// =============================================================================

/**
 * Schema for context usage tracking (v3+)
 */
export const ContextUsageSchema = z.object({
  /** Input tokens used */
  inputTokens: z.number().int().nonnegative(),

  /** Output tokens used */
  outputTokens: z.number().int().nonnegative(),

  /** Total tokens (input + output) */
  totalTokens: z.number().int().nonnegative(),

  /** Context window size */
  contextWindow: z.number().int().positive(),

  /** ISO timestamp when usage was last updated */
  lastUpdated: z.string().datetime(),
});

/**
 * Schema for agent configuration snapshot (v3+)
 */
export const AgentConfigSnapshotSchema = z.object({
  /** Model being used (e.g., "claude-sonnet-4") */
  model: z.string(),

  /** Permission mode */
  permissionMode: z.string(),

  /** List of MCP server names */
  mcpServers: z.array(z.string()),
});

/**
 * Schema for individual channel session mapping (v2)
 */
export const ChannelSessionSchemaV2 = z.object({
  /** Claude session ID for resuming conversations */
  sessionId: z.string().min(1, "Session ID cannot be empty"),

  /** ISO timestamp when last message was sent/received */
  lastMessageAt: z.string().datetime({
    message: "lastMessageAt must be a valid ISO datetime string",
  }),
});

/**
 * Schema for individual channel session mapping (v3)
 */
export const ChannelSessionSchemaV3 = z.object({
  /** Claude session ID for resuming conversations */
  sessionId: z.string().min(1, "Session ID cannot be empty"),

  /** ISO timestamp when session was started */
  sessionStartedAt: z.string().datetime(),

  /** ISO timestamp when last message was sent/received */
  lastMessageAt: z.string().datetime({
    message: "lastMessageAt must be a valid ISO datetime string",
  }),

  /** Number of messages in this session */
  messageCount: z.number().int().nonnegative().default(0),

  /** Context usage tracking (optional for backwards compatibility) */
  contextUsage: ContextUsageSchema.optional(),

  /** Agent configuration snapshot (optional for backwards compatibility) */
  agentConfig: AgentConfigSnapshotSchema.optional(),
});

/**
 * Union schema supporting both v2 and v3 channel sessions
 */
export const ChannelSessionSchema = z.union([
  ChannelSessionSchemaV2,
  ChannelSessionSchemaV3,
]);

/**
 * Schema for the entire agent's Slack session state file (v2)
 */
export const SlackSessionStateSchemaV2 = z.object({
  /** Version for future schema migrations */
  version: z.literal(2),

  /** Agent name this session state belongs to */
  agentName: z.string().min(1, "Agent name cannot be empty"),

  /** Map of channel ID to session info */
  channels: z.record(z.string(), ChannelSessionSchemaV2),
});

/**
 * Schema for the entire agent's Slack session state file (v3)
 *
 * Stored at .herdctl/slack-sessions/<agent-name>.yaml
 */
export const SlackSessionStateSchemaV3 = z.object({
  /** Version for future schema migrations */
  version: z.literal(3),

  /** Agent name this session state belongs to */
  agentName: z.string().min(1, "Agent name cannot be empty"),

  /** Map of channel ID to session info */
  channels: z.record(z.string(), ChannelSessionSchemaV3),
});

/**
 * Union schema supporting both v2 and v3 state files
 */
export const SlackSessionStateSchema = z.union([
  SlackSessionStateSchemaV2,
  SlackSessionStateSchemaV3,
]);

// =============================================================================
// Type Exports
// =============================================================================

export type ContextUsage = z.infer<typeof ContextUsageSchema>;
export type AgentConfigSnapshot = z.infer<typeof AgentConfigSnapshotSchema>;
export type ChannelSessionV2 = z.infer<typeof ChannelSessionSchemaV2>;
export type ChannelSessionV3 = z.infer<typeof ChannelSessionSchemaV3>;
export type ChannelSession = z.infer<typeof ChannelSessionSchema>;
export type SlackSessionStateV2 = z.infer<typeof SlackSessionStateSchemaV2>;
export type SlackSessionStateV3 = z.infer<typeof SlackSessionStateSchemaV3>;
export type SlackSessionState = z.infer<typeof SlackSessionStateSchema>;

// =============================================================================
// Session Manager Options
// =============================================================================

/**
 * Logger interface for session manager operations
 */
export interface SessionManagerLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

/**
 * Options for configuring the SessionManager
 */
export interface SessionManagerOptions {
  /** Name of the agent this session manager is for */
  agentName: string;

  /** Root path for state storage (e.g., .herdctl) */
  stateDir: string;

  /** Session expiry timeout in hours (default: 24) */
  sessionExpiryHours?: number;

  /** Logger for session manager operations */
  logger?: SessionManagerLogger;
}

// =============================================================================
// Session Manager Interface
// =============================================================================

/**
 * Result of getting or creating a session
 */
export interface SessionResult {
  /** Claude session ID */
  sessionId: string;

  /** Whether this is a newly created session */
  isNew: boolean;
}

/**
 * Interface that all Slack session managers must implement
 *
 * Keyed by channelId (matching Discord's approach)
 */
export interface ISessionManager {
  /**
   * Get or create a session for a channel
   *
   * @param channelId - Slack channel ID (conversation key)
   */
  getOrCreateSession(channelId: string): Promise<SessionResult>;

  /**
   * Update the last message timestamp for a session
   *
   * @param channelId - Slack channel ID
   */
  touchSession(channelId: string): Promise<void>;

  /**
   * Get an existing session without creating one
   *
   * @param channelId - Slack channel ID
   * @returns Session if it exists and is not expired, null otherwise
   */
  getSession(channelId: string): Promise<ChannelSession | null>;

  /**
   * Store or update the session ID for a channel
   *
   * @param channelId - Slack channel ID
   * @param sessionId - The Claude Agent SDK session ID
   */
  setSession(channelId: string, sessionId: string): Promise<void>;

  /**
   * Clear a specific session
   *
   * @param channelId - Slack channel ID
   * @returns true if cleared, false if it didn't exist
   */
  clearSession(channelId: string): Promise<boolean>;

  /**
   * Clean up all expired sessions
   *
   * @returns Number of sessions cleaned up
   */
  cleanupExpiredSessions(): Promise<number>;

  /**
   * Get the count of active (non-expired) sessions
   */
  getActiveSessionCount(): Promise<number>;

  /**
   * Update context usage for a session (v3+)
   *
   * @param channelId - Slack channel ID
   * @param usage - Context usage information
   */
  updateContextUsage(
    channelId: string,
    usage: {
      inputTokens: number;
      outputTokens: number;
      contextWindow: number;
    }
  ): Promise<void>;

  /**
   * Increment message count for a session (v3+)
   *
   * @param channelId - Slack channel ID
   */
  incrementMessageCount(channelId: string): Promise<void>;

  /**
   * Set agent configuration snapshot for a session (v3+)
   *
   * @param channelId - Slack channel ID
   * @param config - Agent configuration
   */
  setAgentConfig(
    channelId: string,
    config: {
      model: string;
      permissionMode: string;
      mcpServers: string[];
    }
  ): Promise<void>;

  /** Name of the agent this session manager is for */
  readonly agentName: string;
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create initial session state for a new agent (v3)
 */
export function createInitialSessionState(
  agentName: string
): SlackSessionStateV3 {
  return {
    version: 3,
    agentName,
    channels: {},
  };
}

/**
 * Create a new channel session (v3)
 */
export function createChannelSession(sessionId: string): ChannelSessionV3 {
  const now = new Date().toISOString();
  return {
    sessionId,
    sessionStartedAt: now,
    lastMessageAt: now,
    messageCount: 0,
  };
}

/**
 * Migrate v2 session state to v3
 */
export function migrateSessionStateV2ToV3(
  stateV2: SlackSessionStateV2
): SlackSessionStateV3 {
  const channels: Record<string, ChannelSessionV3> = {};

  for (const [channelId, sessionV2] of Object.entries(stateV2.channels)) {
    channels[channelId] = {
      sessionId: sessionV2.sessionId,
      sessionStartedAt: sessionV2.lastMessageAt, // Use lastMessageAt as best guess
      lastMessageAt: sessionV2.lastMessageAt,
      messageCount: 0, // Unknown, start from 0
    };
  }

  return {
    version: 3,
    agentName: stateV2.agentName,
    channels,
  };
}
