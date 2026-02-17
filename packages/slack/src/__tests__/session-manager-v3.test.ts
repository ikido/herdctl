/**
 * Tests for SessionManager v3 features (context tracking, message count, agent config)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { SessionManager } from "../session-manager/session-manager.js";
import type { ChannelSessionV3 } from "../session-manager/types.js";

const createMockLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

describe("SessionManager v3 Features", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "slack-session-v3-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const createManager = (agentName = "test-agent", expiryHours = 24) => {
    return new SessionManager({
      agentName,
      stateDir: tempDir,
      sessionExpiryHours: expiryHours,
      logger: createMockLogger(),
    });
  };

  describe("updateContextUsage", () => {
    it("stores context usage data correctly", async () => {
      const manager = createManager();
      await manager.getOrCreateSession("C0123456789");

      await manager.updateContextUsage("C0123456789", {
        inputTokens: 1000,
        outputTokens: 500,
        contextWindow: 200000,
      });

      const session = (await manager.getSession(
        "C0123456789"
      )) as ChannelSessionV3;
      expect(session.contextUsage).toBeDefined();
      expect(session.contextUsage!.inputTokens).toBe(1000);
      expect(session.contextUsage!.outputTokens).toBe(500);
      expect(session.contextUsage!.totalTokens).toBe(1500);
      expect(session.contextUsage!.contextWindow).toBe(200000);
      expect(session.contextUsage!.lastUpdated).toBeDefined();
    });

    it("updates existing context usage", async () => {
      const manager = createManager();
      await manager.getOrCreateSession("C0123456789");

      // First update
      await manager.updateContextUsage("C0123456789", {
        inputTokens: 1000,
        outputTokens: 500,
        contextWindow: 200000,
      });

      // Second update
      await manager.updateContextUsage("C0123456789", {
        inputTokens: 2000,
        outputTokens: 800,
        contextWindow: 200000,
      });

      const session = (await manager.getSession(
        "C0123456789"
      )) as ChannelSessionV3;
      expect(session.contextUsage!.inputTokens).toBe(2000);
      expect(session.contextUsage!.outputTokens).toBe(800);
      expect(session.contextUsage!.totalTokens).toBe(2800);
    });

    it("handles zero tokens correctly", async () => {
      const manager = createManager();
      await manager.getOrCreateSession("C0123456789");

      await manager.updateContextUsage("C0123456789", {
        inputTokens: 0,
        outputTokens: 0,
        contextWindow: 200000,
      });

      const session = (await manager.getSession(
        "C0123456789"
      )) as ChannelSessionV3;
      expect(session.contextUsage!.totalTokens).toBe(0);
    });

    it("persists context usage to disk", async () => {
      const manager = createManager();
      await manager.getOrCreateSession("C0123456789");

      await manager.updateContextUsage("C0123456789", {
        inputTokens: 5000,
        outputTokens: 2500,
        contextWindow: 200000,
      });

      // Read from disk
      const filePath = join(tempDir, "slack-sessions", "test-agent.yaml");
      const content = await readFile(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.channels.C0123456789.contextUsage).toBeDefined();
      expect(parsed.channels.C0123456789.contextUsage.inputTokens).toBe(5000);
      expect(parsed.channels.C0123456789.contextUsage.outputTokens).toBe(2500);
      expect(parsed.channels.C0123456789.contextUsage.totalTokens).toBe(7500);
    });

    it("does nothing for non-existent channel", async () => {
      const manager = createManager();

      await expect(
        manager.updateContextUsage("C_UNKNOWN", {
          inputTokens: 1000,
          outputTokens: 500,
          contextWindow: 200000,
        })
      ).resolves.toBeUndefined();
    });
  });

  describe("incrementMessageCount", () => {
    it("increments message count from 0", async () => {
      const manager = createManager();
      await manager.getOrCreateSession("C0123456789");

      await manager.incrementMessageCount("C0123456789");

      const session = (await manager.getSession(
        "C0123456789"
      )) as ChannelSessionV3;
      expect(session.messageCount).toBe(1);
    });

    it("increments message count multiple times", async () => {
      const manager = createManager();
      await manager.getOrCreateSession("C0123456789");

      await manager.incrementMessageCount("C0123456789");
      await manager.incrementMessageCount("C0123456789");
      await manager.incrementMessageCount("C0123456789");

      const session = (await manager.getSession(
        "C0123456789"
      )) as ChannelSessionV3;
      expect(session.messageCount).toBe(3);
    });

    it("persists message count to disk", async () => {
      const manager = createManager();
      await manager.getOrCreateSession("C0123456789");

      await manager.incrementMessageCount("C0123456789");
      await manager.incrementMessageCount("C0123456789");

      // Read from disk
      const filePath = join(tempDir, "slack-sessions", "test-agent.yaml");
      const content = await readFile(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.channels.C0123456789.messageCount).toBe(2);
    });

    it("does nothing for non-existent channel", async () => {
      const manager = createManager();

      await expect(
        manager.incrementMessageCount("C_UNKNOWN")
      ).resolves.toBeUndefined();
    });
  });

  describe("setAgentConfig", () => {
    it("stores agent configuration", async () => {
      const manager = createManager();
      await manager.getOrCreateSession("C0123456789");

      await manager.setAgentConfig("C0123456789", {
        model: "claude-sonnet-4",
        permissionMode: "bypassPermissions",
        mcpServers: ["linear-mcp", "perplexity"],
      });

      const session = (await manager.getSession(
        "C0123456789"
      )) as ChannelSessionV3;
      expect(session.agentConfig).toBeDefined();
      expect(session.agentConfig!.model).toBe("claude-sonnet-4");
      expect(session.agentConfig!.permissionMode).toBe("bypassPermissions");
      expect(session.agentConfig!.mcpServers).toEqual([
        "linear-mcp",
        "perplexity",
      ]);
    });

    it("handles empty MCP server list", async () => {
      const manager = createManager();
      await manager.getOrCreateSession("C0123456789");

      await manager.setAgentConfig("C0123456789", {
        model: "claude-haiku-4",
        permissionMode: "default",
        mcpServers: [],
      });

      const session = (await manager.getSession(
        "C0123456789"
      )) as ChannelSessionV3;
      expect(session.agentConfig!.mcpServers).toEqual([]);
    });

    it("persists agent config to disk", async () => {
      const manager = createManager();
      await manager.getOrCreateSession("C0123456789");

      await manager.setAgentConfig("C0123456789", {
        model: "claude-opus-4",
        permissionMode: "plan",
        mcpServers: ["github", "posthog"],
      });

      // Read from disk
      const filePath = join(tempDir, "slack-sessions", "test-agent.yaml");
      const content = await readFile(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.channels.C0123456789.agentConfig).toBeDefined();
      expect(parsed.channels.C0123456789.agentConfig.model).toBe(
        "claude-opus-4"
      );
      expect(parsed.channels.C0123456789.agentConfig.permissionMode).toBe(
        "plan"
      );
      expect(parsed.channels.C0123456789.agentConfig.mcpServers).toEqual([
        "github",
        "posthog",
      ]);
    });

    it("does nothing for non-existent channel", async () => {
      const manager = createManager();

      await expect(
        manager.setAgentConfig("C_UNKNOWN", {
          model: "claude-sonnet-4",
          permissionMode: "default",
          mcpServers: [],
        })
      ).resolves.toBeUndefined();
    });
  });

  describe("v3 session format", () => {
    it("creates v3 sessions by default", async () => {
      const manager = createManager();
      await manager.getOrCreateSession("C0123456789");

      const session = (await manager.getSession(
        "C0123456789"
      )) as ChannelSessionV3;

      // v3 fields
      expect(session.sessionStartedAt).toBeDefined();
      expect(session.messageCount).toBe(0);

      // v2 fields still present
      expect(session.sessionId).toBeDefined();
      expect(session.lastMessageAt).toBeDefined();
    });

    it("writes version 3 to state file", async () => {
      const manager = createManager();
      await manager.getOrCreateSession("C0123456789");

      const filePath = join(tempDir, "slack-sessions", "test-agent.yaml");
      const content = await readFile(filePath, "utf-8");

      expect(content).toContain("version: 3");
    });

    it("includes all v3 fields in persisted state", async () => {
      const manager = createManager();
      await manager.getOrCreateSession("C0123456789");

      await manager.incrementMessageCount("C0123456789");
      await manager.updateContextUsage("C0123456789", {
        inputTokens: 1000,
        outputTokens: 500,
        contextWindow: 200000,
      });
      await manager.setAgentConfig("C0123456789", {
        model: "claude-sonnet-4",
        permissionMode: "default",
        mcpServers: ["linear-mcp"],
      });

      const filePath = join(tempDir, "slack-sessions", "test-agent.yaml");
      const content = await readFile(filePath, "utf-8");
      const parsed = parseYaml(content);

      const channel = parsed.channels.C0123456789;
      expect(channel.sessionStartedAt).toBeDefined();
      expect(channel.messageCount).toBe(1);
      expect(channel.contextUsage).toBeDefined();
      expect(channel.agentConfig).toBeDefined();
    });
  });

  describe("v2 to v3 migration", () => {
    it("migrates v2 sessions to v3 on write", async () => {
      const manager = createManager();

      // Manually create a v2 state file
      const filePath = join(tempDir, "slack-sessions", "test-agent.yaml");
      const v2State = {
        version: 2,
        agentName: "test-agent",
        channels: {
          C0123456789: {
            sessionId: "session-v2-123",
            lastMessageAt: new Date().toISOString(),
          },
        },
      };

      await mkdir(join(tempDir, "slack-sessions"), { recursive: true });
      await writeFile(filePath, stringifyYaml(v2State));

      // Load and interact with the session (triggers migration)
      await manager.incrementMessageCount("C0123456789");

      // Read back and verify v3 format
      const content = await readFile(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.version).toBe(3);
      expect(parsed.channels.C0123456789.sessionStartedAt).toBeDefined();
      expect(parsed.channels.C0123456789.messageCount).toBe(1);
    });
  });

  describe("combined operations", () => {
    it("handles all v3 operations together", async () => {
      const manager = createManager();
      const channelId = "C0123456789";

      // Create session
      await manager.getOrCreateSession(channelId);

      // Set agent config
      await manager.setAgentConfig(channelId, {
        model: "claude-sonnet-4",
        permissionMode: "bypassPermissions",
        mcpServers: ["linear-mcp", "perplexity"],
      });

      // Simulate a conversation
      for (let i = 0; i < 5; i++) {
        await manager.incrementMessageCount(channelId);
        await manager.updateContextUsage(channelId, {
          inputTokens: (i + 1) * 1000,
          outputTokens: (i + 1) * 500,
          contextWindow: 200000,
        });
      }

      // Verify final state
      const session = (await manager.getSession(channelId)) as ChannelSessionV3;

      expect(session.messageCount).toBe(5);
      expect(session.contextUsage!.inputTokens).toBe(5000);
      expect(session.contextUsage!.outputTokens).toBe(2500);
      expect(session.contextUsage!.totalTokens).toBe(7500);
      expect(session.agentConfig!.model).toBe("claude-sonnet-4");
      expect(session.agentConfig!.mcpServers).toHaveLength(2);
    });
  });
});
