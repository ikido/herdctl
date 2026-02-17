/**
 * Session manager for Slack channel conversations
 *
 * Provides per-channel session management for Claude conversations,
 * enabling conversation context preservation across Slack channels.
 *
 * Sessions are stored at .herdctl/slack-sessions/<agent-name>.yaml
 */

import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { stringify as stringifyYaml, parse as parseYaml } from "yaml";
import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import {
  type SessionManagerOptions,
  type SessionManagerLogger,
  type ISessionManager,
  type SessionResult,
  type ChannelSession,
  type ChannelSessionV3,
  type SlackSessionState,
  type SlackSessionStateV3,
  SlackSessionStateSchema,
  createInitialSessionState,
  migrateSessionStateV2ToV3,
} from "./types.js";
import {
  SessionStateReadError,
  SessionStateWriteError,
  SessionDirectoryCreateError,
} from "./errors.js";

// =============================================================================
// Default Logger
// =============================================================================

function createDefaultLogger(agentName: string): SessionManagerLogger {
  const prefix = `[slack-session:${agentName}]`;
  return {
    debug: (msg, data) =>
      console.debug(prefix, msg, data ? JSON.stringify(data) : ""),
    info: (msg, data) =>
      console.info(prefix, msg, data ? JSON.stringify(data) : ""),
    warn: (msg, data) =>
      console.warn(prefix, msg, data ? JSON.stringify(data) : ""),
    error: (msg, data) =>
      console.error(prefix, msg, data ? JSON.stringify(data) : ""),
  };
}

// =============================================================================
// Session Manager Implementation
// =============================================================================

/**
 * SessionManager manages per-channel Claude sessions for a Slack agent.
 *
 * Each agent has its own SessionManager instance, storing session mappings
 * in a YAML file at .herdctl/slack-sessions/<agent-name>.yaml
 *
 * Sessions are keyed by channelId (matching Discord's approach).
 */
export class SessionManager implements ISessionManager {
  public readonly agentName: string;

  private readonly stateDir: string;
  private readonly sessionExpiryHours: number;
  private readonly logger: SessionManagerLogger;
  private readonly stateFilePath: string;

  // In-memory cache of session state
  private state: SlackSessionState | null = null;

  constructor(options: SessionManagerOptions) {
    this.agentName = options.agentName;
    this.stateDir = options.stateDir;
    this.sessionExpiryHours = options.sessionExpiryHours ?? 24;
    this.logger =
      options.logger ?? createDefaultLogger(options.agentName);

    // Compute state file path
    this.stateFilePath = join(
      this.stateDir,
      "slack-sessions",
      `${this.agentName}.yaml`
    );
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Get or create a session for a channel
   */
  async getOrCreateSession(channelId: string): Promise<SessionResult> {
    const existingSession = await this.getSession(channelId);

    if (existingSession) {
      this.logger.info("Resuming existing session", {
        channelId,
        sessionId: existingSession.sessionId,
      });
      return {
        sessionId: existingSession.sessionId,
        isNew: false,
      };
    }

    // Create new session (v3 format)
    const sessionId = this.generateSessionId();
    const state = await this.loadState();
    const now = new Date().toISOString();

    state.channels[channelId] = {
      sessionId,
      sessionStartedAt: now,
      lastMessageAt: now,
      messageCount: 0,
    };

    await this.saveState(state);

    this.logger.info("Created new session", { channelId, sessionId });

    return {
      sessionId,
      isNew: true,
    };
  }

  /**
   * Update the last message timestamp for a session
   */
  async touchSession(channelId: string): Promise<void> {
    const state = await this.loadState();
    const session = state.channels[channelId];

    if (!session) {
      this.logger.warn("Attempted to touch non-existent session", {
        channelId,
      });
      return;
    }

    session.lastMessageAt = new Date().toISOString();
    await this.saveState(state);

    this.logger.debug("Touched session", {
      channelId,
      sessionId: session.sessionId,
    });
  }

  /**
   * Get an existing session without creating one
   */
  async getSession(channelId: string): Promise<ChannelSession | null> {
    const state = await this.loadState();
    const session = state.channels[channelId];

    if (!session) {
      return null;
    }

    // Check if session is expired
    if (this.isSessionExpired(session)) {
      this.logger.info("Session expired", {
        channelId,
        sessionId: session.sessionId,
        lastMessageAt: session.lastMessageAt,
        expiryHours: this.sessionExpiryHours,
      });
      return null;
    }

    return session;
  }

  /**
   * Store or update the session ID for a channel
   */
  async setSession(channelId: string, sessionId: string): Promise<void> {
    const state = await this.loadState();
    const now = new Date().toISOString();
    const existingSession = state.channels[channelId];

    if (existingSession) {
      // Preserve v3 fields if they exist
      const sessionV3 = this.ensureSessionV3(existingSession);
      sessionV3.sessionId = sessionId;
      sessionV3.lastMessageAt = now;
      state.channels[channelId] = sessionV3;
    } else {
      // Create new v3 session
      state.channels[channelId] = {
        sessionId,
        sessionStartedAt: now,
        lastMessageAt: now,
        messageCount: 0,
      };
    }

    await this.saveState(state);

    if (existingSession) {
      this.logger.info("Updated session", {
        channelId,
        oldSessionId: existingSession.sessionId,
        newSessionId: sessionId,
      });
    } else {
      this.logger.info("Stored new session", { channelId, sessionId });
    }
  }

  /**
   * Clear a specific session
   */
  async clearSession(channelId: string): Promise<boolean> {
    const state = await this.loadState();

    if (!state.channels[channelId]) {
      return false;
    }

    const sessionId = state.channels[channelId].sessionId;
    delete state.channels[channelId];
    await this.saveState(state);

    this.logger.info("Cleared session", { channelId, sessionId });
    return true;
  }

  /**
   * Clean up all expired sessions
   */
  async cleanupExpiredSessions(): Promise<number> {
    const state = await this.loadState();
    const channelIds = Object.keys(state.channels);
    let cleanedUp = 0;

    for (const channelId of channelIds) {
      const session = state.channels[channelId];
      if (this.isSessionExpired(session)) {
        this.logger.debug("Cleaning up expired session", {
          channelId,
          sessionId: session.sessionId,
          lastMessageAt: session.lastMessageAt,
        });
        delete state.channels[channelId];
        cleanedUp++;
      }
    }

    if (cleanedUp > 0) {
      await this.saveState(state);
      this.logger.info("Cleaned up expired sessions", { count: cleanedUp });
    }

    return cleanedUp;
  }

  /**
   * Get the count of active (non-expired) sessions
   */
  async getActiveSessionCount(): Promise<number> {
    const state = await this.loadState();
    let activeCount = 0;

    for (const channelId of Object.keys(state.channels)) {
      const session = state.channels[channelId];
      if (!this.isSessionExpired(session)) {
        activeCount++;
      }
    }

    return activeCount;
  }

  /**
   * Update context usage for a session (v3+)
   */
  async updateContextUsage(
    channelId: string,
    usage: {
      inputTokens: number;
      outputTokens: number;
      contextWindow: number;
    }
  ): Promise<void> {
    const state = await this.loadState();
    const session = state.channels[channelId];

    if (!session) {
      this.logger.warn("Attempted to update context usage for non-existent session", {
        channelId,
      });
      return;
    }

    // Ensure session is v3 format
    const sessionV3 = this.ensureSessionV3(session);

    sessionV3.contextUsage = {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.inputTokens + usage.outputTokens,
      contextWindow: usage.contextWindow,
      lastUpdated: new Date().toISOString(),
    };

    state.channels[channelId] = sessionV3;
    await this.saveState(state);

    this.logger.debug("Updated context usage", {
      channelId,
      totalTokens: sessionV3.contextUsage.totalTokens,
      contextWindow: sessionV3.contextUsage.contextWindow,
    });
  }

  /**
   * Increment message count for a session (v3+)
   */
  async incrementMessageCount(channelId: string): Promise<void> {
    const state = await this.loadState();
    const session = state.channels[channelId];

    if (!session) {
      this.logger.warn("Attempted to increment message count for non-existent session", {
        channelId,
      });
      return;
    }

    // Ensure session is v3 format
    const sessionV3 = this.ensureSessionV3(session);
    sessionV3.messageCount = (sessionV3.messageCount ?? 0) + 1;

    state.channels[channelId] = sessionV3;
    await this.saveState(state);

    this.logger.debug("Incremented message count", {
      channelId,
      messageCount: sessionV3.messageCount,
    });
  }

  /**
   * Set agent configuration snapshot for a session (v3+)
   */
  async setAgentConfig(
    channelId: string,
    config: {
      model: string;
      permissionMode: string;
      mcpServers: string[];
    }
  ): Promise<void> {
    const state = await this.loadState();
    const session = state.channels[channelId];

    if (!session) {
      this.logger.warn("Attempted to set agent config for non-existent session", {
        channelId,
      });
      return;
    }

    // Ensure session is v3 format
    const sessionV3 = this.ensureSessionV3(session);
    sessionV3.agentConfig = config;

    state.channels[channelId] = sessionV3;
    await this.saveState(state);

    this.logger.debug("Set agent config", {
      channelId,
      model: config.model,
      permissionMode: config.permissionMode,
    });
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private generateSessionId(): string {
    return `slack-${this.agentName}-${randomUUID()}`;
  }

  private isSessionExpired(session: ChannelSession): boolean {
    const lastMessageAt = new Date(session.lastMessageAt);
    const now = new Date();
    const expiryMs = this.sessionExpiryHours * 60 * 60 * 1000;
    return now.getTime() - lastMessageAt.getTime() > expiryMs;
  }

  /**
   * Ensure a session is in v3 format, migrating from v2 if necessary
   */
  private ensureSessionV3(session: ChannelSession): ChannelSessionV3 {
    // Check if already v3 (has sessionStartedAt)
    if ("sessionStartedAt" in session) {
      return session as ChannelSessionV3;
    }

    // Migrate v2 to v3
    return {
      sessionId: session.sessionId,
      sessionStartedAt: session.lastMessageAt, // Best guess
      lastMessageAt: session.lastMessageAt,
      messageCount: 0,
    };
  }

  private async loadState(): Promise<SlackSessionState> {
    if (this.state) {
      return this.state;
    }

    let content: string;
    try {
      content = await readFile(this.stateFilePath, "utf-8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;

      if (code === "ENOENT") {
        this.state = createInitialSessionState(this.agentName);
        return this.state;
      }

      throw new SessionStateReadError(this.agentName, this.stateFilePath, {
        cause: error as Error,
      });
    }

    if (content.trim() === "") {
      this.state = createInitialSessionState(this.agentName);
      return this.state;
    }

    let parsed: unknown;
    try {
      parsed = parseYaml(content);
    } catch (error) {
      this.logger.warn("Corrupted session state file, creating fresh state", {
        error: (error as Error).message,
      });
      this.state = createInitialSessionState(this.agentName);
      return this.state;
    }

    const validated = SlackSessionStateSchema.safeParse(parsed);
    if (!validated.success) {
      this.logger.warn("Corrupted session state file, creating fresh state", {
        error: validated.error.message,
      });
      this.state = createInitialSessionState(this.agentName);
      return this.state;
    }

    // Handle v2→v3 migration
    if (validated.data.version === 2) {
      this.logger.info("Migrating session state from v2 to v3");
      this.state = migrateSessionStateV2ToV3(validated.data);
      // Save migrated state
      await this.saveState(this.state);
    } else {
      this.state = validated.data as SlackSessionStateV3;
    }

    return this.state;
  }

  private async saveState(state: SlackSessionState): Promise<void> {
    await this.ensureDirectoryExists();

    this.state = state;

    const yamlContent = stringifyYaml(state, { indent: 2, lineWidth: 120 });
    const tempPath = this.generateTempPath(this.stateFilePath);

    try {
      await writeFile(tempPath, yamlContent, "utf-8");
      await this.renameWithRetry(tempPath, this.stateFilePath);
    } catch (error) {
      try {
        await unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }

      throw new SessionStateWriteError(this.agentName, this.stateFilePath, {
        cause: error as Error,
      });
    }
  }

  private async ensureDirectoryExists(): Promise<void> {
    const dir = dirname(this.stateFilePath);
    try {
      await mkdir(dir, { recursive: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw new SessionDirectoryCreateError(this.agentName, dir, {
          cause: error as Error,
        });
      }
    }
  }

  private generateTempPath(targetPath: string): string {
    const dir = dirname(targetPath);
    const random = randomBytes(8).toString("hex");
    const filename = `${this.agentName}.yaml`;
    return join(dir, `.${filename}.tmp.${random}`);
  }

  private async renameWithRetry(
    oldPath: string,
    newPath: string,
    maxRetries = 3,
    baseDelayMs = 50
  ): Promise<void> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await rename(oldPath, newPath);
        return;
      } catch (error) {
        lastError = error as Error;
        const code = (error as NodeJS.ErrnoException).code;

        if (code !== "EACCES" && code !== "EPERM") {
          throw error;
        }

        if (attempt < maxRetries) {
          const delay = baseDelayMs * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }
}
