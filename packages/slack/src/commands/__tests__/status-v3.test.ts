/**
 * Tests for enhanced !status command with v3 features
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { statusCommand } from "../status.js";
import type { CommandContext } from "../command-handler.js";
import type {
  ChannelSessionV2,
  ChannelSessionV3,
  ISessionManager,
} from "../../session-manager/types.js";

describe("Status Command v3", () => {
  const createMockSessionManager = (
    session: ChannelSessionV2 | ChannelSessionV3 | null
  ): ISessionManager => {
    return {
      agentName: "test-agent",
      getSession: vi.fn().mockResolvedValue(session),
      getOrCreateSession: vi.fn(),
      touchSession: vi.fn(),
      setSession: vi.fn(),
      clearSession: vi.fn(),
      cleanupExpiredSessions: vi.fn(),
      getActiveSessionCount: vi.fn(),
      updateContextUsage: vi.fn(),
      incrementMessageCount: vi.fn(),
      setAgentConfig: vi.fn(),
    };
  };

  const createMockContext = (
    sessionManager: ISessionManager
  ): CommandContext => {
    return {
      agentName: "test-agent",
      channelId: "C0123456789",
      userId: "U0123456789",
      reply: vi.fn(),
      sessionManager,
      connectorState: {
        status: "connected",
        connectedAt: new Date().toISOString(),
        disconnectedAt: null,
        reconnectAttempts: 0,
        lastError: null,
        botUser: {
          id: "B0123456789",
          username: "test-bot",
        },
        messageStats: {
          received: 10,
          sent: 10,
          ignored: 0,
        },
      },
    };
  };

  describe("with v3 session", () => {
    it("shows context window usage", async () => {
      const sessionV3: ChannelSessionV3 = {
        sessionId: "session-123",
        sessionStartedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
        lastMessageAt: new Date().toISOString(),
        messageCount: 15,
        contextUsage: {
          inputTokens: 45234,
          outputTokens: 12500,
          totalTokens: 57734,
          contextWindow: 200000,
          lastUpdated: new Date().toISOString(),
        },
      };

      const sessionManager = createMockSessionManager(sessionV3);
      const context = createMockContext(sessionManager);

      await statusCommand.execute(context);

      expect(context.reply).toHaveBeenCalledOnce();
      const reply = (context.reply as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;

      // Check context window section exists
      expect(reply).toContain("Context Window");
      expect(reply).toContain("57,734");
      expect(reply).toContain("200,000");
      expect(reply).toContain("tokens");
      expect(reply).toContain("71% remaining");
    });

    it("shows session duration and message count", async () => {
      const sessionV3: ChannelSessionV3 = {
        sessionId: "session-456",
        sessionStartedAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(), // 4 hours ago
        lastMessageAt: new Date().toISOString(),
        messageCount: 42,
      };

      const sessionManager = createMockSessionManager(sessionV3);
      const context = createMockContext(sessionManager);

      await statusCommand.execute(context);

      const reply = (context.reply as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;

      expect(reply).toContain("Started:");
      expect(reply).toContain("Duration:");
      expect(reply).toContain("Messages: 42");
    });

    it("shows agent configuration", async () => {
      const sessionV3: ChannelSessionV3 = {
        sessionId: "session-789",
        sessionStartedAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
        messageCount: 5,
        agentConfig: {
          model: "claude-sonnet-4",
          permissionMode: "bypassPermissions",
          mcpServers: ["linear-mcp", "perplexity"],
        },
      };

      const sessionManager = createMockSessionManager(sessionV3);
      const context = createMockContext(sessionManager);

      await statusCommand.execute(context);

      const reply = (context.reply as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;

      expect(reply).toContain("Configuration");
      expect(reply).toContain("Model: claude-sonnet-4");
      expect(reply).toContain("Permissions: bypassPermissions");
      expect(reply).toContain("MCP Servers: linear-mcp, perplexity");
    });

    it("shows warning at 75% context usage", async () => {
      const sessionV3: ChannelSessionV3 = {
        sessionId: "session-123",
        sessionStartedAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
        messageCount: 20,
        contextUsage: {
          inputTokens: 100000,
          outputTokens: 50000,
          totalTokens: 150000,
          contextWindow: 200000,
          lastUpdated: new Date().toISOString(),
        },
      };

      const sessionManager = createMockSessionManager(sessionV3);
      const context = createMockContext(sessionManager);

      await statusCommand.execute(context);

      const reply = (context.reply as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;

      expect(reply).toContain("Context filling up");
    });

    it("shows warning at 90% context usage", async () => {
      const sessionV3: ChannelSessionV3 = {
        sessionId: "session-123",
        sessionStartedAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
        messageCount: 30,
        contextUsage: {
          inputTokens: 120000,
          outputTokens: 60000,
          totalTokens: 180000,
          contextWindow: 200000,
          lastUpdated: new Date().toISOString(),
        },
      };

      const sessionManager = createMockSessionManager(sessionV3);
      const context = createMockContext(sessionManager);

      await statusCommand.execute(context);

      const reply = (context.reply as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;

      expect(reply).toContain("WARNING");
      expect(reply).toContain("Approaching context limit");
    });

    it("shows critical warning at 95% context usage", async () => {
      const sessionV3: ChannelSessionV3 = {
        sessionId: "session-123",
        sessionStartedAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
        messageCount: 40,
        contextUsage: {
          inputTokens: 127000,
          outputTokens: 63000,
          totalTokens: 190000,
          contextWindow: 200000,
          lastUpdated: new Date().toISOString(),
        },
      };

      const sessionManager = createMockSessionManager(sessionV3);
      const context = createMockContext(sessionManager);

      await statusCommand.execute(context);

      const reply = (context.reply as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;

      expect(reply).toContain("CRITICAL");
      expect(reply).toContain("Auto-compact");
      expect(reply).toContain("!reset");
    });

    it("handles missing contextUsage gracefully", async () => {
      const sessionV3: ChannelSessionV3 = {
        sessionId: "session-123",
        sessionStartedAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
        messageCount: 10,
        // No contextUsage field
      };

      const sessionManager = createMockSessionManager(sessionV3);
      const context = createMockContext(sessionManager);

      await statusCommand.execute(context);

      const reply = (context.reply as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;

      // Should not crash and should not show context window section
      expect(reply).not.toContain("Context Window");
      expect(reply).toContain("Messages: 10");
    });

    it("handles missing agentConfig gracefully", async () => {
      const sessionV3: ChannelSessionV3 = {
        sessionId: "session-123",
        sessionStartedAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
        messageCount: 10,
        // No agentConfig field
      };

      const sessionManager = createMockSessionManager(sessionV3);
      const context = createMockContext(sessionManager);

      await statusCommand.execute(context);

      const reply = (context.reply as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;

      // Should not crash and should not show configuration section
      expect(reply).not.toContain("Configuration");
    });

    it("handles empty MCP server list", async () => {
      const sessionV3: ChannelSessionV3 = {
        sessionId: "session-123",
        sessionStartedAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
        messageCount: 5,
        agentConfig: {
          model: "claude-haiku-4",
          permissionMode: "default",
          mcpServers: [],
        },
      };

      const sessionManager = createMockSessionManager(sessionV3);
      const context = createMockContext(sessionManager);

      await statusCommand.execute(context);

      const reply = (context.reply as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;

      expect(reply).toContain("Configuration");
      expect(reply).toContain("Model: claude-haiku-4");
      // Should not show MCP Servers line when empty
      expect(reply).not.toContain("MCP Servers:");
    });
  });

  describe("with v2 session (legacy)", () => {
    it("shows only v2 fields without crashing", async () => {
      const sessionV2: ChannelSessionV2 = {
        sessionId: "session-v2-123",
        lastMessageAt: new Date().toISOString(),
      };

      const sessionManager = createMockSessionManager(sessionV2);
      const context = createMockContext(sessionManager);

      await statusCommand.execute(context);

      const reply = (context.reply as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;

      // Should show connection and session ID
      expect(reply).toContain("Session");
      expect(reply).toContain("session-v2-123");

      // Should show v2-style last activity
      expect(reply).toContain("Last Activity:");

      // Should not show v3 fields
      expect(reply).not.toContain("Started:");
      expect(reply).not.toContain("Duration:");
      expect(reply).not.toContain("Messages:");
      expect(reply).not.toContain("Context Window");
      expect(reply).not.toContain("Configuration");
    });
  });

  describe("with no session", () => {
    it("shows friendly message", async () => {
      const sessionManager = createMockSessionManager(null);
      const context = createMockContext(sessionManager);

      await statusCommand.execute(context);

      const reply = (context.reply as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;

      expect(reply).toContain("No active session");
      expect(reply).toContain("Start a conversation to create a session");
    });
  });

  describe("formatting helpers", () => {
    it("formats large numbers with commas", async () => {
      const sessionV3: ChannelSessionV3 = {
        sessionId: "session-123",
        sessionStartedAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
        messageCount: 100,
        contextUsage: {
          inputTokens: 123456,
          outputTokens: 78901,
          totalTokens: 202357,
          contextWindow: 200000,
          lastUpdated: new Date().toISOString(),
        },
      };

      const sessionManager = createMockSessionManager(sessionV3);
      const context = createMockContext(sessionManager);

      await statusCommand.execute(context);

      const reply = (context.reply as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;

      // Numbers should be formatted with commas
      expect(reply).toMatch(/202,357/);
      expect(reply).toMatch(/200,000/);
    });

    it("uses appropriate emoji for normal usage", async () => {
      const sessionV3: ChannelSessionV3 = {
        sessionId: "session-123",
        sessionStartedAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
        messageCount: 5,
        contextUsage: {
          inputTokens: 10000,
          outputTokens: 5000,
          totalTokens: 15000,
          contextWindow: 200000,
          lastUpdated: new Date().toISOString(),
        },
      };

      const sessionManager = createMockSessionManager(sessionV3);
      const context = createMockContext(sessionManager);

      await statusCommand.execute(context);

      const reply = (context.reply as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;

      // Should have bar chart emoji for normal usage (< 75%)
      expect(reply).toContain("📊");
    });
  });
});
