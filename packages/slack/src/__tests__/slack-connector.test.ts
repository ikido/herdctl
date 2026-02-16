import { describe, it, expect, beforeEach, vi } from "vitest";
import { SlackConnector } from "../slack-connector.js";
import type { ISlackSessionManager, SlackMessageEvent } from "../types.js";

const BOT_USER_ID = "U0123456789";
const CHANNEL_ID = "C_GENERAL";
const AGENT_NAME = "test-agent";

const createMockLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

const createMockSessionManager = (
  overrides: Partial<ISlackSessionManager> = {}
): ISlackSessionManager => ({
  agentName: AGENT_NAME,
  getOrCreateSession: vi.fn().mockResolvedValue({ sessionId: "s1", isNew: true }),
  getSession: vi.fn().mockResolvedValue(null),
  setSession: vi.fn().mockResolvedValue(undefined),
  touchSession: vi.fn().mockResolvedValue(undefined),
  clearSession: vi.fn().mockResolvedValue(true),
  cleanupExpiredSessions: vi.fn().mockResolvedValue(0),
  getActiveSessionCount: vi.fn().mockResolvedValue(0),
  ...overrides,
});

/**
 * Helper to create a connector with a fake Bolt app and trigger handlers.
 *
 * We bypass connect() (which imports @slack/bolt) and instead inject a mock
 * app object, then call registerEventHandlers() via reflection.
 */
function createTestConnector(options?: {
  channelAgentMap?: Map<string, string>;
  sessionManagers?: Map<string, ISlackSessionManager>;
}) {
  const channelAgentMap =
    options?.channelAgentMap ?? new Map([[CHANNEL_ID, AGENT_NAME]]);
  const sessionManagers =
    options?.sessionManagers ??
    new Map([[AGENT_NAME, createMockSessionManager()]]);

  const connector = new SlackConnector({
    botToken: "xoxb-fake",
    appToken: "xapp-fake",
    channelAgentMap,
    sessionManagers,
    logger: createMockLogger(),
  });

  // Collect registered handlers
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlers: Record<string, (...args: any[]) => Promise<void>> = {};

  // Mock Bolt app
  const mockApp = {
    event: vi.fn((eventName: string, handler: (...args: unknown[]) => Promise<void>) => {
      handlers[`event:${eventName}`] = handler;
    }),
    message: vi.fn((handler: (...args: unknown[]) => Promise<void>) => {
      handlers["message"] = handler;
    }),
    client: {
      reactions: {
        add: vi.fn().mockResolvedValue({}),
        remove: vi.fn().mockResolvedValue({}),
      },
    },
  };

  // Inject mock app and botUserId via private field access
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (connector as any).app = mockApp;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (connector as any).botUserId = BOT_USER_ID;

  // Trigger registerEventHandlers
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (connector as any).registerEventHandlers();

  const say = vi.fn().mockResolvedValue(undefined);

  return { connector, handlers, say, mockApp, channelAgentMap, sessionManagers };
}

// Helper to capture emitted message events
function captureMessages(connector: SlackConnector): SlackMessageEvent[] {
  const messages: SlackMessageEvent[] = [];
  connector.on("message", (msg: SlackMessageEvent) => messages.push(msg));
  return messages;
}

describe("SlackConnector registerEventHandlers", () => {
  describe("app_mention handler", () => {
    it("emits message event for @mention in configured channel", async () => {
      const { connector, handlers, say } = createTestConnector();
      const messages = captureMessages(connector);

      await handlers["event:app_mention"]({
        event: {
          type: "app_mention",
          user: "UUSER1",
          text: `<@${BOT_USER_ID}> help me`,
          ts: "1707930001.000001",
          channel: CHANNEL_ID,
        },
        say,
      });

      expect(messages).toHaveLength(1);
      expect(messages[0].agentName).toBe(AGENT_NAME);
      expect(messages[0].prompt).toBe("help me");
      expect(messages[0].metadata.wasMentioned).toBe(true);
      expect(messages[0].metadata.threadTs).toBe("1707930001.000001");
    });

    it("ignores @mention in unconfigured channel", async () => {
      const { connector, handlers, say } = createTestConnector();
      const messages = captureMessages(connector);

      await handlers["event:app_mention"]({
        event: {
          type: "app_mention",
          user: "UUSER1",
          text: `<@${BOT_USER_ID}> help`,
          ts: "1707930001.000001",
          channel: "C_UNKNOWN",
        },
        say,
      });

      expect(messages).toHaveLength(0);
    });

    it("uses existing thread_ts when mention is inside a thread", async () => {
      const { connector, handlers, say } = createTestConnector();
      const messages = captureMessages(connector);

      await handlers["event:app_mention"]({
        event: {
          type: "app_mention",
          user: "UUSER1",
          text: `<@${BOT_USER_ID}> help`,
          ts: "1707930002.000001",
          channel: CHANNEL_ID,
          thread_ts: "1707930001.000001",
        },
        say,
      });

      expect(messages).toHaveLength(1);
      expect(messages[0].metadata.threadTs).toBe("1707930001.000001");
    });
  });

  describe("message handler — thread replies (WEA-13)", () => {
    it("routes thread reply to agent when thread is tracked in activeThreads", async () => {
      const { connector, handlers, say } = createTestConnector();
      const messages = captureMessages(connector);

      // First: @mention creates the thread tracking
      await handlers["event:app_mention"]({
        event: {
          type: "app_mention",
          user: "UUSER1",
          text: `<@${BOT_USER_ID}> start`,
          ts: "1707930001.000001",
          channel: CHANNEL_ID,
        },
        say,
      });

      // Second: thread reply without mention
      await handlers["event:message"]({
        event: {
          type: "message",
          user: "UUSER1",
          text: "follow up question",
          ts: "1707930002.000001",
          channel: CHANNEL_ID,
          thread_ts: "1707930001.000001",
        },
        say,
      });

      expect(messages).toHaveLength(2);
      expect(messages[1].agentName).toBe(AGENT_NAME);
      expect(messages[1].prompt).toBe("follow up question");
      expect(messages[1].metadata.wasMentioned).toBe(false);
      expect(messages[1].metadata.threadTs).toBe("1707930001.000001");
    });

    it("recovers thread from session manager after restart (WEA-13)", async () => {
      const sessionManager = createMockSessionManager({
        getSession: vi.fn().mockResolvedValue({
          sessionId: "recovered-session",
          lastMessageAt: new Date().toISOString(),
          channelId: CHANNEL_ID,
        }),
      });

      const { connector, handlers, say } = createTestConnector({
        sessionManagers: new Map([[AGENT_NAME, sessionManager]]),
      });
      const messages = captureMessages(connector);

      // Thread reply without prior @mention (simulates restart)
      await handlers["event:message"]({
        event: {
          type: "message",
          user: "UUSER1",
          text: "continuing after restart",
          ts: "1707930002.000001",
          channel: CHANNEL_ID,
          thread_ts: "1707930001.000001",
        },
        say,
      });

      expect(sessionManager.getSession).toHaveBeenCalledWith(
        "1707930001.000001"
      );
      expect(messages).toHaveLength(1);
      expect(messages[0].agentName).toBe(AGENT_NAME);
      expect(messages[0].prompt).toBe("continuing after restart");
    });

    it("ignores thread reply in unconfigured channel with no session", async () => {
      const { connector, handlers, say } = createTestConnector();
      const messages = captureMessages(connector);

      await handlers["event:message"]({
        event: {
          type: "message",
          user: "UUSER1",
          text: "hello",
          ts: "1707930002.000001",
          channel: "C_UNKNOWN",
          thread_ts: "1707930001.000001",
        },
        say,
      });

      expect(messages).toHaveLength(0);
    });

    it("ignores thread reply when session manager has no session", async () => {
      const sessionManager = createMockSessionManager({
        getSession: vi.fn().mockResolvedValue(null),
      });

      const { connector, handlers, say } = createTestConnector({
        sessionManagers: new Map([[AGENT_NAME, sessionManager]]),
      });
      const messages = captureMessages(connector);

      // Thread reply for an unknown thread (not tracked, no session)
      await handlers["event:message"]({
        event: {
          type: "message",
          user: "UUSER1",
          text: "random thread reply",
          ts: "1707930002.000001",
          channel: CHANNEL_ID,
          thread_ts: "1707930099.000001",
        },
        say,
      });

      expect(messages).toHaveLength(0);
    });
  });

  describe("message handler — top-level channel messages (WEA-12)", () => {
    it("routes top-level message in configured channel to agent", async () => {
      const { connector, handlers, say } = createTestConnector();
      const messages = captureMessages(connector);

      await handlers["event:message"]({
        event: {
          type: "message",
          user: "UUSER1",
          text: "hello bot",
          ts: "1707930001.000001",
          channel: CHANNEL_ID,
        },
        say,
      });

      expect(messages).toHaveLength(1);
      expect(messages[0].agentName).toBe(AGENT_NAME);
      expect(messages[0].prompt).toBe("hello bot");
      expect(messages[0].metadata.wasMentioned).toBe(false);
      // threadTs should be the message's own ts (creates a new thread)
      expect(messages[0].metadata.threadTs).toBe("1707930001.000001");
    });

    it("ignores top-level message in unconfigured channel", async () => {
      const { connector, handlers, say } = createTestConnector();
      const messages = captureMessages(connector);

      await handlers["event:message"]({
        event: {
          type: "message",
          user: "UUSER1",
          text: "hello",
          ts: "1707930001.000001",
          channel: "C_UNKNOWN",
        },
        say,
      });

      expect(messages).toHaveLength(0);
    });
  });

  describe("@mention dedup", () => {
    it("message handler skips messages containing @mention (handled by app_mention)", async () => {
      const { connector, handlers, say } = createTestConnector();
      const messages = captureMessages(connector);

      await handlers["event:message"]({
        event: {
          type: "message",
          user: "UUSER1",
          text: `<@${BOT_USER_ID}> do something`,
          ts: "1707930001.000001",
          channel: CHANNEL_ID,
        },
        say,
      });

      // Should be skipped — app_mention handler processes these
      expect(messages).toHaveLength(0);
    });

    it("app_mention and message for same @mention produce exactly one event", async () => {
      const { connector, handlers, say } = createTestConnector();
      const messages = captureMessages(connector);

      // Slack sends both events for an @mention
      await handlers["event:app_mention"]({
        event: {
          type: "app_mention",
          user: "UUSER1",
          text: `<@${BOT_USER_ID}> help`,
          ts: "1707930001.000001",
          channel: CHANNEL_ID,
        },
        say,
      });

      await handlers["event:message"]({
        event: {
          type: "message",
          user: "UUSER1",
          text: `<@${BOT_USER_ID}> help`,
          ts: "1707930001.000001",
          channel: CHANNEL_ID,
        },
        say,
      });

      // Only one message event should be emitted (from app_mention)
      expect(messages).toHaveLength(1);
      expect(messages[0].metadata.wasMentioned).toBe(true);
    });
  });

  describe("bot message filtering", () => {
    it("ignores messages from bots", async () => {
      const { connector, handlers, say } = createTestConnector();
      const messages = captureMessages(connector);

      await handlers["event:message"]({
        event: {
          type: "message",
          bot_id: "BBOT123",
          text: "I am a bot",
          ts: "1707930001.000001",
          channel: CHANNEL_ID,
        },
        say,
      });

      expect(messages).toHaveLength(0);
    });

    it("ignores messages with bot_message subtype", async () => {
      const { connector, handlers, say } = createTestConnector();
      const messages = captureMessages(connector);

      await handlers["event:message"]({
        event: {
          type: "message",
          subtype: "bot_message",
          user: "UUSER1",
          text: "bot subtype message",
          ts: "1707930001.000001",
          channel: CHANNEL_ID,
        },
        say,
      });

      expect(messages).toHaveLength(0);
    });

    it("ignores messages from the bot itself", async () => {
      const { connector, handlers, say } = createTestConnector();
      const messages = captureMessages(connector);

      await handlers["event:message"]({
        event: {
          type: "message",
          user: BOT_USER_ID,
          text: "my own message",
          ts: "1707930001.000001",
          channel: CHANNEL_ID,
        },
        say,
      });

      expect(messages).toHaveLength(0);
    });
  });

  describe("message stats", () => {
    it("increments received and ignored counts correctly", async () => {
      const { connector, handlers, say } = createTestConnector();

      // Bot message → received + ignored
      await handlers["event:message"]({
        event: {
          type: "message",
          bot_id: "BBOT123",
          text: "bot msg",
          ts: "1707930001.000001",
          channel: CHANNEL_ID,
        },
        say,
      });

      // Unknown channel → received + ignored
      await handlers["event:message"]({
        event: {
          type: "message",
          user: "UUSER1",
          text: "hello",
          ts: "1707930002.000001",
          channel: "C_UNKNOWN",
        },
        say,
      });

      // Successful → received only (not ignored)
      await handlers["event:message"]({
        event: {
          type: "message",
          user: "UUSER1",
          text: "hello bot",
          ts: "1707930003.000001",
          channel: CHANNEL_ID,
        },
        say,
      });

      const state = connector.getState();
      expect(state.messageStats.received).toBe(3);
      expect(state.messageStats.ignored).toBe(2);
    });
  });

  describe("reply function", () => {
    it("sends reply in the correct thread", async () => {
      const { connector, handlers, say } = createTestConnector();
      const messages = captureMessages(connector);

      await handlers["event:message"]({
        event: {
          type: "message",
          user: "UUSER1",
          text: "hello",
          ts: "1707930001.000001",
          channel: CHANNEL_ID,
        },
        say,
      });

      expect(messages).toHaveLength(1);

      await messages[0].reply("hi back!");

      expect(say).toHaveBeenCalledWith({
        text: "hi back!",
        thread_ts: "1707930001.000001",
      });
    });
  });

  describe("event handler registration", () => {
    it("registers both app_mention and message via app.event()", () => {
      const { mockApp } = createTestConnector();

      expect(mockApp.event).toHaveBeenCalledTimes(2);
      expect(mockApp.event).toHaveBeenCalledWith(
        "app_mention",
        expect.any(Function)
      );
      expect(mockApp.event).toHaveBeenCalledWith(
        "message",
        expect.any(Function)
      );
    });
  });
});
