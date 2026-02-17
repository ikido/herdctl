/**
 * !status command — Show agent status, connection info, and context window usage
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PrefixCommand, CommandContext } from "./command-handler.js";
import type { ChannelSessionV3 } from "../session-manager/types.js";

const execFileAsync = promisify(execFile);

/**
 * Format a timestamp for display
 */
function formatTimestamp(isoString: string | null): string {
  if (!isoString) {
    return "N/A";
  }
  const date = new Date(isoString);
  return date.toLocaleString();
}

/**
 * Format duration since a timestamp
 */
function formatDuration(isoString: string | null): string {
  if (!isoString) {
    return "N/A";
  }
  const startTime = new Date(isoString).getTime();
  const now = Date.now();
  const durationMs = now - startTime;

  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Format number with thousand separators
 */
function formatNumber(num: number): string {
  return num.toLocaleString();
}

/**
 * Get status emoji based on connection status
 */
function getStatusEmoji(status: string): string {
  switch (status) {
    case "connected":
      return "\u{1F7E2}"; // Green circle
    case "connecting":
    case "reconnecting":
      return "\u{1F7E1}"; // Yellow circle
    case "disconnected":
    case "disconnecting":
      return "\u26AA"; // White circle
    case "error":
      return "\u{1F534}"; // Red circle
    default:
      return "\u2753"; // Question mark
  }
}

/**
 * Get context usage emoji based on percentage used
 */
function getContextUsageEmoji(percentUsed: number): string {
  if (percentUsed >= 95) {
    return "\u{1F6A8}"; // Police car light (critical)
  }
  if (percentUsed >= 90) {
    return "\u26A0\uFE0F"; // Warning sign
  }
  if (percentUsed >= 75) {
    return "\u2139\uFE0F"; // Information
  }
  return "\u{1F4CA}"; // Bar chart (normal)
}

/**
 * Check if session is v3 format
 */
function isSessionV3(session: unknown): session is ChannelSessionV3 {
  return (
    typeof session === "object" &&
    session !== null &&
    "sessionStartedAt" in session
  );
}

export const statusCommand: PrefixCommand = {
  name: "status",
  description: "Show agent status, session info, and context window usage",

  async execute(context: CommandContext): Promise<void> {
    const { agentName, channelId, connectorState, sessionManager, reply } =
      context;

    // Get session info for this channel
    const session = await sessionManager.getSession(channelId);

    if (!session) {
      await reply("No active session in this channel. Start a conversation to create a session!");
      return;
    }

    // Build comprehensive status message
    let statusMessage = `📊 *${agentName} Status*\n\n`;

    // ===========================================================================
    // 1. Connection Status
    // ===========================================================================
    const statusEmoji = getStatusEmoji(connectorState.status);
    const botUsername = connectorState.botUser?.username ?? "Unknown";

    statusMessage += `*Connection*\n`;
    statusMessage += `${statusEmoji} ${connectorState.status}\n`;
    statusMessage += `Bot: ${botUsername}`;

    if (connectorState.connectedAt) {
      statusMessage += `\nUptime: ${formatDuration(connectorState.connectedAt)}`;
    }

    if (connectorState.reconnectAttempts > 0) {
      statusMessage += `\nReconnect Attempts: ${connectorState.reconnectAttempts}`;
    }

    if (connectorState.lastError) {
      statusMessage += `\nLast Error: ${connectorState.lastError}`;
    }

    // ===========================================================================
    // 2. Session Info (Enhanced for v3)
    // ===========================================================================
    statusMessage += `\n\n*Session*\n`;
    statusMessage += `ID: \`${session.sessionId.substring(0, 20)}...\`\n`;

    if (isSessionV3(session)) {
      // v3 session with enhanced fields
      statusMessage += `Started: ${formatTimestamp(session.sessionStartedAt)}\n`;
      statusMessage += `Duration: ${formatDuration(session.sessionStartedAt)}\n`;
      statusMessage += `Messages: ${session.messageCount}`;
    } else {
      // v2 session (legacy)
      statusMessage += `Last Activity: ${formatTimestamp(session.lastMessageAt)}`;
    }

    // ===========================================================================
    // 3. Context Window (v3 only)
    // ===========================================================================
    if (isSessionV3(session) && session.contextUsage) {
      const { totalTokens, contextWindow, lastUpdated } = session.contextUsage;
      const percentUsed = Math.round((totalTokens / contextWindow) * 100);
      const percentRemaining = 100 - percentUsed;
      const usageEmoji = getContextUsageEmoji(percentUsed);

      statusMessage += `\n\n*Context Window*\n`;
      statusMessage += `${usageEmoji} ${formatNumber(totalTokens)} / ${formatNumber(contextWindow)} tokens\n`;
      statusMessage += `${percentRemaining}% remaining`;

      // Add warnings based on usage
      if (percentUsed >= 95) {
        statusMessage += `\n\n⚠️ *CRITICAL:* Context window nearly full! Auto-compact will trigger soon.\nConsider starting a new session with \`!reset\`.`;
      } else if (percentUsed >= 90) {
        statusMessage += `\n\n⚠️ *WARNING:* Approaching context limit.\nConsider wrapping up or starting a new session soon.`;
      } else if (percentUsed >= 75) {
        statusMessage += `\n\nℹ️ Context filling up. Still plenty of room, but monitor usage.`;
      }

      statusMessage += `\n\nLast updated: ${formatTimestamp(lastUpdated)}`;
    }

    // ===========================================================================
    // 4. Agent Configuration (v3 only)
    // ===========================================================================
    if (isSessionV3(session) && session.agentConfig) {
      const { model, permissionMode, mcpServers } = session.agentConfig;

      statusMessage += `\n\n*Configuration*\n`;
      statusMessage += `Model: ${model}\n`;
      statusMessage += `Permissions: ${permissionMode}`;

      if (mcpServers.length > 0) {
        statusMessage += `\nMCP Servers: ${mcpServers.join(", ")}`;
      }
    }

    await reply(statusMessage);
  },
};
