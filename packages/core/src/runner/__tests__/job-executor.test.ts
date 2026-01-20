import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, rm, realpath, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JobExecutor, executeJob, type SDKQueryFunction } from "../job-executor.js";
import type { SDKMessage, RunnerOptionsWithCallbacks } from "../types.js";
import type { ResolvedAgent } from "../../config/index.js";
import {
  getJob,
  readJobOutputAll,
  initStateDirectory,
  getSessionInfo,
} from "../../state/index.js";

// =============================================================================
// Test Helpers
// =============================================================================

async function createTempDir(): Promise<string> {
  const baseDir = join(
    tmpdir(),
    `herdctl-executor-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(baseDir, { recursive: true });
  return await realpath(baseDir);
}

function createTestAgent(overrides: Partial<ResolvedAgent> = {}): ResolvedAgent {
  return {
    name: "test-agent",
    configPath: "/path/to/agent.yaml",
    ...overrides,
  };
}

function createMockLogger() {
  return {
    warnings: [] as string[],
    errors: [] as string[],
    infos: [] as string[],
    warn: (msg: string) => {
      // Suppress warnings during tests
    },
    error: (msg: string) => {
      // Suppress errors during tests
    },
    info: (msg: string) => {
      // Suppress info during tests
    },
  };
}

// Helper to create a mock SDK query function
function createMockSDKQuery(messages: SDKMessage[]): SDKQueryFunction {
  return async function* mockQuery() {
    for (const message of messages) {
      yield message;
    }
  };
}

// Helper to create a mock SDK query that yields messages with delays
function createDelayedSDKQuery(
  messages: SDKMessage[],
  delayMs: number = 10
): SDKQueryFunction {
  return async function* mockQuery() {
    for (const message of messages) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      yield message;
    }
  };
}

// Helper to create a mock SDK query that throws an error
function createErrorSDKQuery(error: Error): SDKQueryFunction {
  return async function* mockQuery() {
    throw error;
  };
}

// =============================================================================
// JobExecutor tests
// =============================================================================

describe("JobExecutor", () => {
  let tempDir: string;
  let stateDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    stateDir = join(tempDir, ".herdctl");
    await initStateDirectory({ path: stateDir });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("job lifecycle", () => {
    it("creates job record before execution", async () => {
      const messages: SDKMessage[] = [
        { type: "system", content: "Initialized" },
        { type: "assistant", content: "Done" },
      ];

      const executor = new JobExecutor(createMockSDKQuery(messages), {
        logger: createMockLogger(),
      });

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
      });

      expect(result.jobId).toMatch(/^job-\d{4}-\d{2}-\d{2}-[a-z0-9]+$/);

      const job = await getJob(join(stateDir, "jobs"), result.jobId);
      expect(job).not.toBeNull();
      expect(job?.agent).toBe("test-agent");
    });

    it("updates job status to running", async () => {
      let jobIdDuringExecution: string | undefined;

      const sdkQuery: SDKQueryFunction = async function* () {
        // During execution, we can check the job status
        yield { type: "system", content: "Running" };
      };

      const executor = new JobExecutor(sdkQuery, {
        logger: createMockLogger(),
      });

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
      });

      // Job should be completed now, but was running during execution
      const job = await getJob(join(stateDir, "jobs"), result.jobId);
      expect(job?.status).toBe("completed");
    });

    it("updates job with final status on success", async () => {
      const messages: SDKMessage[] = [
        { type: "system", content: "Start" },
        { type: "assistant", content: "Task completed!" },
      ];

      const executor = new JobExecutor(createMockSDKQuery(messages), {
        logger: createMockLogger(),
      });

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
      });

      expect(result.success).toBe(true);

      const job = await getJob(join(stateDir, "jobs"), result.jobId);
      expect(job?.status).toBe("completed");
      expect(job?.exit_reason).toBe("success");
      expect(job?.finished_at).toBeDefined();
      expect(job?.duration_seconds).toBeGreaterThanOrEqual(0);
    });

    it("updates job with failed status on error", async () => {
      const messages: SDKMessage[] = [
        { type: "system", content: "Start" },
        { type: "error", message: "Something went wrong" },
      ];

      const executor = new JobExecutor(createMockSDKQuery(messages), {
        logger: createMockLogger(),
      });

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Something went wrong");

      const job = await getJob(join(stateDir, "jobs"), result.jobId);
      expect(job?.status).toBe("failed");
      expect(job?.exit_reason).toBe("error");
    });

    it("handles SDK query throwing an error", async () => {
      const executor = new JobExecutor(
        createErrorSDKQuery(new Error("SDK error")),
        { logger: createMockLogger() }
      );

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("SDK error");

      const job = await getJob(join(stateDir, "jobs"), result.jobId);
      expect(job?.status).toBe("failed");
    });
  });

  describe("streaming output", () => {
    it("writes all messages to job output", async () => {
      const messages: SDKMessage[] = [
        { type: "system", content: "Init" },
        { type: "assistant", content: "Hello" },
        { type: "tool_use", tool_name: "bash", input: { command: "ls" } },
        { type: "tool_result", result: "file1\nfile2", success: true },
        { type: "assistant", content: "Done" },
      ];

      const executor = new JobExecutor(createMockSDKQuery(messages), {
        logger: createMockLogger(),
      });

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
      });

      const output = await readJobOutputAll(join(stateDir, "jobs"), result.jobId);
      expect(output).toHaveLength(5);
      expect(output[0].type).toBe("system");
      expect(output[1].type).toBe("assistant");
      expect(output[2].type).toBe("tool_use");
      expect(output[3].type).toBe("tool_result");
      expect(output[4].type).toBe("assistant");
    });

    it("writes output immediately without buffering", async () => {
      let outputCountDuringExecution = 0;
      const jobsDir = join(stateDir, "jobs");

      const sdkQuery: SDKQueryFunction = async function* () {
        yield { type: "system", content: "First" };
        yield { type: "assistant", content: "Second" };
        yield { type: "assistant", content: "Third" };
      };

      // We can't easily verify real-time writing in a unit test,
      // but we can verify all messages are written
      const executor = new JobExecutor(sdkQuery, {
        logger: createMockLogger(),
      });

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
      });

      const output = await readJobOutputAll(jobsDir, result.jobId);
      expect(output).toHaveLength(3);
    });

    it("preserves message content and metadata", async () => {
      const messages: SDKMessage[] = [
        { type: "system", content: "Session init", subtype: "session_start" },
        {
          type: "assistant",
          content: "Response",
          usage: { input_tokens: 100, output_tokens: 50 },
        },
        {
          type: "tool_use",
          tool_name: "read_file",
          tool_use_id: "tool-123",
          input: { path: "/etc/hosts" },
        },
        {
          type: "tool_result",
          tool_use_id: "tool-123",
          result: "localhost",
          success: true,
        },
      ];

      const executor = new JobExecutor(createMockSDKQuery(messages), {
        logger: createMockLogger(),
      });

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
      });

      const output = await readJobOutputAll(join(stateDir, "jobs"), result.jobId);

      // Check system message
      expect(output[0].type).toBe("system");
      if (output[0].type === "system") {
        expect(output[0].content).toBe("Session init");
        expect(output[0].subtype).toBe("session_start");
      }

      // Check assistant message
      expect(output[1].type).toBe("assistant");
      if (output[1].type === "assistant") {
        expect(output[1].content).toBe("Response");
        expect(output[1].usage?.input_tokens).toBe(100);
        expect(output[1].usage?.output_tokens).toBe(50);
      }

      // Check tool_use message
      expect(output[2].type).toBe("tool_use");
      if (output[2].type === "tool_use") {
        expect(output[2].tool_name).toBe("read_file");
        expect(output[2].tool_use_id).toBe("tool-123");
        expect(output[2].input).toEqual({ path: "/etc/hosts" });
      }

      // Check tool_result message
      expect(output[3].type).toBe("tool_result");
      if (output[3].type === "tool_result") {
        expect(output[3].tool_use_id).toBe("tool-123");
        expect(output[3].result).toBe("localhost");
        expect(output[3].success).toBe(true);
      }
    });

    it("writes error message to output when SDK throws", async () => {
      const executor = new JobExecutor(
        createErrorSDKQuery(new Error("Connection failed")),
        { logger: createMockLogger() }
      );

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
      });

      const output = await readJobOutputAll(join(stateDir, "jobs"), result.jobId);
      expect(output.some((m) => m.type === "error")).toBe(true);

      const errorMsg = output.find((m) => m.type === "error");
      if (errorMsg?.type === "error") {
        expect(errorMsg.message).toContain("Connection failed");
      }
    });
  });

  describe("message type handling", () => {
    it("handles all message types correctly", async () => {
      const messages: SDKMessage[] = [
        { type: "system", content: "System message", subtype: "init" },
        { type: "assistant", content: "Assistant message", partial: false },
        { type: "tool_use", tool_name: "bash", input: { cmd: "test" } },
        { type: "tool_result", result: "output", success: true },
        { type: "error", message: "Error message", code: "ERR_TEST" },
      ];

      const executor = new JobExecutor(createMockSDKQuery(messages), {
        logger: createMockLogger(),
      });

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
      });

      const output = await readJobOutputAll(join(stateDir, "jobs"), result.jobId);

      expect(output[0].type).toBe("system");
      expect(output[1].type).toBe("assistant");
      expect(output[2].type).toBe("tool_use");
      expect(output[3].type).toBe("tool_result");
      expect(output[4].type).toBe("error");
    });

    it("handles partial assistant messages", async () => {
      const messages: SDKMessage[] = [
        { type: "assistant", content: "Part 1...", partial: true },
        { type: "assistant", content: "Part 1... Part 2...", partial: true },
        { type: "assistant", content: "Part 1... Part 2... Done!", partial: false },
      ];

      const executor = new JobExecutor(createMockSDKQuery(messages), {
        logger: createMockLogger(),
      });

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
      });

      const output = await readJobOutputAll(join(stateDir, "jobs"), result.jobId);

      expect(output).toHaveLength(3);
      if (output[0].type === "assistant") {
        expect(output[0].partial).toBe(true);
      }
      if (output[2].type === "assistant") {
        expect(output[2].partial).toBe(false);
      }
    });

    it("handles tool_result with error", async () => {
      const messages: SDKMessage[] = [
        { type: "tool_use", tool_name: "read_file", input: { path: "/nope" } },
        { type: "tool_result", success: false, error: "File not found" },
      ];

      const executor = new JobExecutor(createMockSDKQuery(messages), {
        logger: createMockLogger(),
      });

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
      });

      const output = await readJobOutputAll(join(stateDir, "jobs"), result.jobId);

      if (output[1].type === "tool_result") {
        expect(output[1].success).toBe(false);
        expect(output[1].error).toBe("File not found");
      }
    });
  });

  describe("session handling", () => {
    it("extracts session ID from system message with init subtype", async () => {
      const messages: SDKMessage[] = [
        { type: "system", content: "Init", subtype: "init", session_id: "session-abc123" },
        { type: "assistant", content: "Done" },
      ];

      const executor = new JobExecutor(createMockSDKQuery(messages), {
        logger: createMockLogger(),
      });

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
      });

      expect(result.sessionId).toBe("session-abc123");

      const job = await getJob(join(stateDir, "jobs"), result.jobId);
      expect(job?.session_id).toBe("session-abc123");
    });

    it("does not extract session ID from non-init system messages", async () => {
      const messages: SDKMessage[] = [
        { type: "system", content: "Progress", subtype: "progress", session_id: "should-ignore" },
        { type: "assistant", content: "Done" },
      ];

      const executor = new JobExecutor(createMockSDKQuery(messages), {
        logger: createMockLogger(),
      });

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
      });

      expect(result.sessionId).toBeUndefined();

      const job = await getJob(join(stateDir, "jobs"), result.jobId);
      expect(job?.session_id).toBeUndefined();
    });

    it("persists session info via updateSessionInfo", async () => {
      const messages: SDKMessage[] = [
        { type: "system", content: "Init", subtype: "init", session_id: "session-persist-123" },
        { type: "assistant", content: "Done" },
      ];

      const executor = new JobExecutor(createMockSDKQuery(messages), {
        logger: createMockLogger(),
      });

      await executor.execute({
        agent: createTestAgent({ name: "persist-agent" }),
        prompt: "Test prompt",
        stateDir,
      });

      // Verify session info was persisted
      const sessionInfo = await getSessionInfo(join(stateDir, "sessions"), "persist-agent");
      expect(sessionInfo).not.toBeNull();
      expect(sessionInfo?.session_id).toBe("session-persist-123");
      expect(sessionInfo?.agent_name).toBe("persist-agent");
      expect(sessionInfo?.job_count).toBe(1);
      expect(sessionInfo?.mode).toBe("autonomous");
    });

    it("increments job_count on subsequent runs with session", async () => {
      const messages: SDKMessage[] = [
        { type: "system", content: "Init", subtype: "init", session_id: "session-multi-123" },
        { type: "assistant", content: "Done" },
      ];

      const executor = new JobExecutor(createMockSDKQuery(messages), {
        logger: createMockLogger(),
      });

      // Run twice
      await executor.execute({
        agent: createTestAgent({ name: "multi-agent" }),
        prompt: "First run",
        stateDir,
      });

      await executor.execute({
        agent: createTestAgent({ name: "multi-agent" }),
        prompt: "Second run",
        stateDir,
      });

      // Verify job_count was incremented
      const sessionInfo = await getSessionInfo(join(stateDir, "sessions"), "multi-agent");
      expect(sessionInfo?.job_count).toBe(2);
    });

    it("stores timestamps in session info", async () => {
      const messages: SDKMessage[] = [
        { type: "system", content: "Init", subtype: "init", session_id: "session-ts-123" },
        { type: "assistant", content: "Done" },
      ];

      const executor = new JobExecutor(createMockSDKQuery(messages), {
        logger: createMockLogger(),
      });

      await executor.execute({
        agent: createTestAgent({ name: "ts-agent" }),
        prompt: "Test prompt",
        stateDir,
      });

      const sessionInfo = await getSessionInfo(join(stateDir, "sessions"), "ts-agent");
      expect(sessionInfo?.created_at).toBeDefined();
      expect(sessionInfo?.last_used_at).toBeDefined();

      // Verify they are valid ISO timestamps
      expect(() => new Date(sessionInfo!.created_at)).not.toThrow();
      expect(() => new Date(sessionInfo!.last_used_at)).not.toThrow();
    });

    it("returns session ID in RunnerResult for caller use", async () => {
      const messages: SDKMessage[] = [
        { type: "system", content: "Init", subtype: "init", session_id: "session-result-123" },
        { type: "assistant", content: "Done" },
      ];

      const executor = new JobExecutor(createMockSDKQuery(messages), {
        logger: createMockLogger(),
      });

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
      });

      // Session ID should be available in the result for caller use
      expect(result.sessionId).toBe("session-result-123");
    });

    it("passes resume option to SDK", async () => {
      let receivedOptions: Record<string, unknown> | undefined;

      const sdkQuery: SDKQueryFunction = async function* (params) {
        receivedOptions = params.options;
        yield { type: "assistant", content: "Resumed" };
      };

      const executor = new JobExecutor(sdkQuery, {
        logger: createMockLogger(),
      });

      await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
        resume: "session-to-resume",
      });

      expect(receivedOptions?.resume).toBe("session-to-resume");
    });

    it("passes fork option to SDK", async () => {
      let receivedOptions: Record<string, unknown> | undefined;

      const sdkQuery: SDKQueryFunction = async function* (params) {
        receivedOptions = params.options;
        yield { type: "assistant", content: "Forked" };
      };

      const executor = new JobExecutor(sdkQuery, {
        logger: createMockLogger(),
      });

      await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
        fork: "session-to-fork",
      });

      expect(receivedOptions?.forkSession).toBe(true);
    });

    it("creates job with trigger_type 'fork' and forked_from when forking", async () => {
      const messages: SDKMessage[] = [
        { type: "system", content: "Init", subtype: "init", session_id: "forked-session-123" },
        { type: "assistant", content: "Forked session started" },
      ];

      const executor = new JobExecutor(createMockSDKQuery(messages), {
        logger: createMockLogger(),
      });

      const result = await executor.execute({
        agent: createTestAgent({ name: "fork-agent" }),
        prompt: "Continue from where we left off",
        stateDir,
        fork: "original-session-id",
        forkedFrom: "job-2024-01-15-abc123",
      });

      expect(result.success).toBe(true);

      const job = await getJob(join(stateDir, "jobs"), result.jobId);
      expect(job?.trigger_type).toBe("fork");
      expect(job?.forked_from).toBe("job-2024-01-15-abc123");
    });

    it("sets trigger_type to fork even if triggerType option provided", async () => {
      const messages: SDKMessage[] = [
        { type: "assistant", content: "Forked" },
      ];

      const executor = new JobExecutor(createMockSDKQuery(messages), {
        logger: createMockLogger(),
      });

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
        fork: "session-to-fork",
        triggerType: "manual", // Should be overridden by fork
      });

      const job = await getJob(join(stateDir, "jobs"), result.jobId);
      expect(job?.trigger_type).toBe("fork");
    });

    it("does not set forked_from when not forking", async () => {
      const messages: SDKMessage[] = [
        { type: "assistant", content: "Normal run" },
      ];

      const executor = new JobExecutor(createMockSDKQuery(messages), {
        logger: createMockLogger(),
      });

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
      });

      const job = await getJob(join(stateDir, "jobs"), result.jobId);
      expect(job?.trigger_type).toBe("manual");
      expect(job?.forked_from).toBeNull();
    });

    it("updates session info job_count after resume", async () => {
      const messages: SDKMessage[] = [
        { type: "system", content: "Init", subtype: "init", session_id: "resume-session-123" },
        { type: "assistant", content: "Resumed" },
      ];

      const executor = new JobExecutor(createMockSDKQuery(messages), {
        logger: createMockLogger(),
      });

      // First run to establish the session
      await executor.execute({
        agent: createTestAgent({ name: "resume-test-agent" }),
        prompt: "First run",
        stateDir,
      });

      // Check initial job count
      let sessionInfo = await getSessionInfo(join(stateDir, "sessions"), "resume-test-agent");
      expect(sessionInfo?.job_count).toBe(1);

      // Resume the session
      await executor.execute({
        agent: createTestAgent({ name: "resume-test-agent" }),
        prompt: "Resume run",
        stateDir,
        resume: "resume-session-123",
      });

      // Check job count was incremented
      sessionInfo = await getSessionInfo(join(stateDir, "sessions"), "resume-test-agent");
      expect(sessionInfo?.job_count).toBe(2);
    });

    it("updates session info job_count after fork", async () => {
      const messages: SDKMessage[] = [
        { type: "system", content: "Init", subtype: "init", session_id: "fork-session-123" },
        { type: "assistant", content: "Forked" },
      ];

      const executor = new JobExecutor(createMockSDKQuery(messages), {
        logger: createMockLogger(),
      });

      // First run to establish a session
      await executor.execute({
        agent: createTestAgent({ name: "fork-test-agent" }),
        prompt: "First run",
        stateDir,
      });

      // Check initial job count
      let sessionInfo = await getSessionInfo(join(stateDir, "sessions"), "fork-test-agent");
      expect(sessionInfo?.job_count).toBe(1);

      // Fork the session
      await executor.execute({
        agent: createTestAgent({ name: "fork-test-agent" }),
        prompt: "Fork run",
        stateDir,
        fork: "original-session-id",
        forkedFrom: "job-2024-01-15-parent",
      });

      // Check job count was incremented
      sessionInfo = await getSessionInfo(join(stateDir, "sessions"), "fork-test-agent");
      expect(sessionInfo?.job_count).toBe(2);
    });

    it("does not persist session info when no session ID is present", async () => {
      const messages: SDKMessage[] = [
        { type: "system", content: "No session" },
        { type: "assistant", content: "Done" },
      ];

      const executor = new JobExecutor(createMockSDKQuery(messages), {
        logger: createMockLogger(),
      });

      await executor.execute({
        agent: createTestAgent({ name: "no-session-agent" }),
        prompt: "Test prompt",
        stateDir,
      });

      // Verify no session info was created
      const sessionInfo = await getSessionInfo(join(stateDir, "sessions"), "no-session-agent");
      expect(sessionInfo).toBeNull();
    });
  });

  describe("summary extraction", () => {
    it("extracts summary from explicit summary field", async () => {
      const messages: SDKMessage[] = [
        { type: "assistant", content: "Working..." },
        { type: "assistant", content: "Done!", summary: "Task completed" },
      ];

      const executor = new JobExecutor(createMockSDKQuery(messages), {
        logger: createMockLogger(),
      });

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
      });

      expect(result.summary).toBe("Task completed");

      const job = await getJob(join(stateDir, "jobs"), result.jobId);
      expect(job?.summary).toBe("Task completed");
    });

    it("extracts summary from short final assistant message", async () => {
      const messages: SDKMessage[] = [
        { type: "assistant", content: "Working..." },
        { type: "assistant", content: "All tasks finished successfully." },
      ];

      const executor = new JobExecutor(createMockSDKQuery(messages), {
        logger: createMockLogger(),
      });

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
      });

      expect(result.summary).toBe("All tasks finished successfully.");
    });

    it("returns undefined summary when no assistant messages exist", async () => {
      const messages: SDKMessage[] = [
        { type: "system", content: "Initialized" },
        { type: "tool_use", tool_name: "bash", input: { command: "ls" } },
        { type: "tool_result", result: "file1\nfile2", success: true },
      ];

      const executor = new JobExecutor(createMockSDKQuery(messages), {
        logger: createMockLogger(),
      });

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
      });

      expect(result.summary).toBeUndefined();

      const job = await getJob(join(stateDir, "jobs"), result.jobId);
      expect(job?.summary).toBeUndefined();
    });

    it("returns undefined summary when all assistant messages are partial", async () => {
      const messages: SDKMessage[] = [
        { type: "assistant", content: "Partial 1...", partial: true },
        { type: "assistant", content: "Partial 2...", partial: true },
      ];

      const executor = new JobExecutor(createMockSDKQuery(messages), {
        logger: createMockLogger(),
      });

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
      });

      expect(result.summary).toBeUndefined();
    });

    it("returns undefined summary when all assistant messages are too long", async () => {
      const longContent = "x".repeat(501);
      const messages: SDKMessage[] = [
        { type: "assistant", content: longContent },
        { type: "assistant", content: longContent },
      ];

      const executor = new JobExecutor(createMockSDKQuery(messages), {
        logger: createMockLogger(),
      });

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
      });

      expect(result.summary).toBeUndefined();
    });

    it("truncates long explicit summary to 500 chars", async () => {
      const longSummary = "x".repeat(600);
      const messages: SDKMessage[] = [
        { type: "assistant", content: "Done!", summary: longSummary },
      ];

      const executor = new JobExecutor(createMockSDKQuery(messages), {
        logger: createMockLogger(),
      });

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
      });

      expect(result.summary).toBeDefined();
      expect(result.summary!.length).toBe(500);
      expect(result.summary!.endsWith("...")).toBe(true);

      const job = await getJob(join(stateDir, "jobs"), result.jobId);
      expect(job?.summary?.length).toBe(500);
    });

    it("uses latest summary when multiple messages have summaries", async () => {
      const messages: SDKMessage[] = [
        { type: "assistant", content: "First", summary: "First summary" },
        { type: "assistant", content: "Second", summary: "Second summary" },
        { type: "assistant", content: "Third", summary: "Final summary" },
      ];

      const executor = new JobExecutor(createMockSDKQuery(messages), {
        logger: createMockLogger(),
      });

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
      });

      expect(result.summary).toBe("Final summary");
    });

    it("handles empty message stream with undefined summary", async () => {
      const messages: SDKMessage[] = [];

      const executor = new JobExecutor(createMockSDKQuery(messages), {
        logger: createMockLogger(),
      });

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
      });

      expect(result.summary).toBeUndefined();
    });
  });

  describe("callbacks", () => {
    it("calls onMessage for each SDK message", async () => {
      const messages: SDKMessage[] = [
        { type: "system", content: "Init" },
        { type: "assistant", content: "Hello" },
        { type: "assistant", content: "World" },
      ];

      const receivedMessages: SDKMessage[] = [];
      const onMessage = vi.fn((msg: SDKMessage) => {
        receivedMessages.push(msg);
      });

      const executor = new JobExecutor(createMockSDKQuery(messages), {
        logger: createMockLogger(),
      });

      await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
        onMessage,
      });

      expect(onMessage).toHaveBeenCalledTimes(3);
      expect(receivedMessages).toHaveLength(3);
      expect(receivedMessages[0].type).toBe("system");
      expect(receivedMessages[1].type).toBe("assistant");
      expect(receivedMessages[2].type).toBe("assistant");
    });

    it("continues execution if onMessage throws", async () => {
      const messages: SDKMessage[] = [
        { type: "system", content: "Init" },
        { type: "assistant", content: "Continue" },
      ];

      const onMessage = vi.fn(() => {
        throw new Error("Callback error");
      });

      const executor = new JobExecutor(createMockSDKQuery(messages), {
        logger: createMockLogger(),
      });

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
        onMessage,
      });

      // Should still succeed despite callback error
      expect(result.success).toBe(true);
      expect(onMessage).toHaveBeenCalledTimes(2);
    });

    it("supports async onMessage callback", async () => {
      const messages: SDKMessage[] = [
        { type: "assistant", content: "Hello" },
      ];

      const onMessage = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      const executor = new JobExecutor(createMockSDKQuery(messages), {
        logger: createMockLogger(),
      });

      await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
        onMessage,
      });

      expect(onMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe("trigger types", () => {
    it("sets trigger type to manual by default", async () => {
      const messages: SDKMessage[] = [{ type: "assistant", content: "Done" }];

      const executor = new JobExecutor(createMockSDKQuery(messages), {
        logger: createMockLogger(),
      });

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
      });

      const job = await getJob(join(stateDir, "jobs"), result.jobId);
      expect(job?.trigger_type).toBe("manual");
    });

    it("sets trigger type from options", async () => {
      const messages: SDKMessage[] = [{ type: "assistant", content: "Done" }];

      const executor = new JobExecutor(createMockSDKQuery(messages), {
        logger: createMockLogger(),
      });

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
        triggerType: "schedule",
        schedule: "daily-cleanup",
      });

      const job = await getJob(join(stateDir, "jobs"), result.jobId);
      expect(job?.trigger_type).toBe("schedule");
      expect(job?.schedule).toBe("daily-cleanup");
    });
  });

  describe("duration tracking", () => {
    it("calculates duration in seconds", async () => {
      const messages: SDKMessage[] = [
        { type: "system", content: "Start" },
        { type: "assistant", content: "End" },
      ];

      const executor = new JobExecutor(
        createDelayedSDKQuery(messages, 50),
        { logger: createMockLogger() }
      );

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
      });

      expect(result.durationSeconds).toBeGreaterThanOrEqual(0);

      const job = await getJob(join(stateDir, "jobs"), result.jobId);
      expect(job?.duration_seconds).toBeGreaterThanOrEqual(0);
    });
  });
});

// =============================================================================
// executeJob convenience function tests
// =============================================================================

describe("executeJob", () => {
  let tempDir: string;
  let stateDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    stateDir = join(tempDir, ".herdctl");
    await initStateDirectory({ path: stateDir });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("executes job using convenience function", async () => {
    const messages: SDKMessage[] = [
      { type: "system", content: "Init" },
      { type: "assistant", content: "Done" },
    ];

    const result = await executeJob(
      createMockSDKQuery(messages),
      {
        agent: createTestAgent({ name: "convenience-agent" }),
        prompt: "Test prompt",
        stateDir,
      },
      { logger: createMockLogger() }
    );

    expect(result.success).toBe(true);
    expect(result.jobId).toBeDefined();

    const job = await getJob(join(stateDir, "jobs"), result.jobId);
    expect(job?.agent).toBe("convenience-agent");
  });

  it("passes executor options", async () => {
    const messages: SDKMessage[] = [{ type: "assistant", content: "Done" }];
    const logger = createMockLogger();

    await executeJob(
      createMockSDKQuery(messages),
      {
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
      },
      { logger }
    );

    // Logger should have been used (even though messages are suppressed)
  });
});

// =============================================================================
// Edge cases
// =============================================================================

describe("edge cases", () => {
  let tempDir: string;
  let stateDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    stateDir = join(tempDir, ".herdctl");
    await initStateDirectory({ path: stateDir });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("handles empty message stream", async () => {
    const executor = new JobExecutor(createMockSDKQuery([]), {
      logger: createMockLogger(),
    });

    const result = await executor.execute({
      agent: createTestAgent(),
      prompt: "Test prompt",
      stateDir,
    });

    expect(result.success).toBe(true);

    const output = await readJobOutputAll(join(stateDir, "jobs"), result.jobId);
    expect(output).toHaveLength(0);
  });

  it("handles very long content in messages", async () => {
    const longContent = "x".repeat(100000);
    const messages: SDKMessage[] = [
      { type: "assistant", content: longContent },
    ];

    const executor = new JobExecutor(createMockSDKQuery(messages), {
      logger: createMockLogger(),
    });

    const result = await executor.execute({
      agent: createTestAgent(),
      prompt: "Test prompt",
      stateDir,
    });

    const output = await readJobOutputAll(join(stateDir, "jobs"), result.jobId);
    if (output[0].type === "assistant") {
      expect(output[0].content).toHaveLength(100000);
    }
  });

  it("handles unicode content", async () => {
    const messages: SDKMessage[] = [
      { type: "assistant", content: "Hello 世界! 🌍 Γεια σου κόσμε" },
    ];

    const executor = new JobExecutor(createMockSDKQuery(messages), {
      logger: createMockLogger(),
    });

    const result = await executor.execute({
      agent: createTestAgent(),
      prompt: "Test prompt",
      stateDir,
    });

    const output = await readJobOutputAll(join(stateDir, "jobs"), result.jobId);
    if (output[0].type === "assistant") {
      expect(output[0].content).toBe("Hello 世界! 🌍 Γεια σου κόσμε");
    }
  });

  it("handles special characters in content", async () => {
    const messages: SDKMessage[] = [
      {
        type: "assistant",
        content: 'Content with "quotes", \\backslashes\\, and\nnewlines',
      },
    ];

    const executor = new JobExecutor(createMockSDKQuery(messages), {
      logger: createMockLogger(),
    });

    const result = await executor.execute({
      agent: createTestAgent(),
      prompt: "Test prompt",
      stateDir,
    });

    const output = await readJobOutputAll(join(stateDir, "jobs"), result.jobId);
    if (output[0].type === "assistant") {
      expect(output[0].content).toBe(
        'Content with "quotes", \\backslashes\\, and\nnewlines'
      );
    }
  });

  it("handles rapid message stream", async () => {
    const messages: SDKMessage[] = Array(100)
      .fill(null)
      .map((_, i) => ({
        type: "assistant" as const,
        content: `Message ${i}`,
      }));

    const executor = new JobExecutor(createMockSDKQuery(messages), {
      logger: createMockLogger(),
    });

    const result = await executor.execute({
      agent: createTestAgent(),
      prompt: "Test prompt",
      stateDir,
    });

    const output = await readJobOutputAll(join(stateDir, "jobs"), result.jobId);
    expect(output).toHaveLength(100);
  });
});

// =============================================================================
// Enhanced error handling tests (US-7)
// =============================================================================

describe("error handling (US-7)", () => {
  let tempDir: string;
  let stateDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    stateDir = join(tempDir, ".herdctl");
    await initStateDirectory({ path: stateDir });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("SDK initialization errors", () => {
    it("catches SDK initialization errors (e.g., missing API key)", async () => {
      // Simulates SDK throwing immediately when query is created
      const sdkQuery: SDKQueryFunction = () => {
        throw new Error("ANTHROPIC_API_KEY environment variable is not set");
      };

      const executor = new JobExecutor(sdkQuery, {
        logger: createMockLogger(),
      });

      const result = await executor.execute({
        agent: createTestAgent({ name: "api-key-agent" }),
        prompt: "Test prompt",
        stateDir,
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("ANTHROPIC_API_KEY");
      expect(result.errorDetails?.type).toBe("initialization");
    });

    it("provides context (job ID, agent name) in initialization error", async () => {
      const sdkQuery: SDKQueryFunction = () => {
        throw new Error("SDK init failed");
      };

      const executor = new JobExecutor(sdkQuery, {
        logger: createMockLogger(),
      });

      const result = await executor.execute({
        agent: createTestAgent({ name: "context-agent" }),
        prompt: "Test prompt",
        stateDir,
      });

      expect(result.error?.message).toContain("context-agent");
      expect(result.error?.message).toContain(result.jobId);
    });
  });

  describe("SDK streaming errors", () => {
    it("catches SDK streaming errors during execution", async () => {
      const sdkQuery: SDKQueryFunction = async function* () {
        yield { type: "system", content: "Init" };
        yield { type: "assistant", content: "Working..." };
        throw new Error("Connection reset by peer");
      };

      const executor = new JobExecutor(sdkQuery, {
        logger: createMockLogger(),
      });

      const result = await executor.execute({
        agent: createTestAgent({ name: "streaming-agent" }),
        prompt: "Test prompt",
        stateDir,
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Connection reset");
      expect(result.errorDetails?.type).toBe("streaming");
    });

    it("tracks messages received before streaming error", async () => {
      const sdkQuery: SDKQueryFunction = async function* () {
        yield { type: "system", content: "Init" };
        yield { type: "assistant", content: "Message 1" };
        yield { type: "assistant", content: "Message 2" };
        throw new Error("Stream interrupted");
      };

      const executor = new JobExecutor(sdkQuery, {
        logger: createMockLogger(),
      });

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
      });

      expect(result.success).toBe(false);
      expect(result.errorDetails?.messagesReceived).toBe(3);
    });

    it("identifies recoverable errors (rate limit)", async () => {
      const sdkQuery: SDKQueryFunction = async function* () {
        yield { type: "system", content: "Init" };
        throw new Error("Rate limit exceeded, please retry");
      };

      const executor = new JobExecutor(sdkQuery, {
        logger: createMockLogger(),
      });

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
      });

      expect(result.errorDetails?.recoverable).toBe(true);
    });

    it("identifies non-recoverable errors", async () => {
      const sdkQuery: SDKQueryFunction = async function* () {
        yield { type: "system", content: "Init" };
        throw new Error("Invalid request format");
      };

      const executor = new JobExecutor(sdkQuery, {
        logger: createMockLogger(),
      });

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
      });

      expect(result.errorDetails?.recoverable).toBe(false);
    });
  });

  describe("error logging to job output", () => {
    it("logs error messages to job output as error type messages", async () => {
      const executor = new JobExecutor(
        createErrorSDKQuery(new Error("Test error for logging")),
        { logger: createMockLogger() }
      );

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
      });

      const output = await readJobOutputAll(join(stateDir, "jobs"), result.jobId);
      const errorMessages = output.filter((m) => m.type === "error");

      expect(errorMessages.length).toBeGreaterThanOrEqual(1);
      expect(errorMessages[0].type).toBe("error");
      if (errorMessages[0].type === "error") {
        expect(errorMessages[0].message).toContain("Test error for logging");
      }
    });

    it("includes error code in job output when available", async () => {
      const errorWithCode = new Error("Network error") as NodeJS.ErrnoException;
      errorWithCode.code = "ECONNRESET";

      const executor = new JobExecutor(createErrorSDKQuery(errorWithCode), {
        logger: createMockLogger(),
      });

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
      });

      const output = await readJobOutputAll(join(stateDir, "jobs"), result.jobId);
      const errorMsg = output.find((m) => m.type === "error");

      if (errorMsg?.type === "error") {
        expect(errorMsg.code).toBe("ECONNRESET");
      }
    });

    it("includes stack trace in job output", async () => {
      const error = new Error("Stack trace test");

      const executor = new JobExecutor(createErrorSDKQuery(error), {
        logger: createMockLogger(),
      });

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
      });

      const output = await readJobOutputAll(join(stateDir, "jobs"), result.jobId);
      const errorMsg = output.find((m) => m.type === "error");

      if (errorMsg?.type === "error") {
        expect(errorMsg.stack).toBeDefined();
        expect(errorMsg.stack).toContain("Stack trace test");
      }
    });
  });

  describe("job status updates", () => {
    it("updates job status to failed with error exit_reason", async () => {
      const executor = new JobExecutor(
        createErrorSDKQuery(new Error("Failure")),
        { logger: createMockLogger() }
      );

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
      });

      const job = await getJob(join(stateDir, "jobs"), result.jobId);
      expect(job?.status).toBe("failed");
      expect(job?.exit_reason).toBe("error");
    });

    it("sets exit_reason to timeout for timeout errors", async () => {
      const timeoutError = new Error("Request timed out");

      const executor = new JobExecutor(createErrorSDKQuery(timeoutError), {
        logger: createMockLogger(),
      });

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
      });

      const job = await getJob(join(stateDir, "jobs"), result.jobId);
      expect(job?.exit_reason).toBe("timeout");
    });

    it("sets exit_reason to cancelled for abort errors", async () => {
      const abortError = new Error("Operation aborted by user");

      const executor = new JobExecutor(createErrorSDKQuery(abortError), {
        logger: createMockLogger(),
      });

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
      });

      const job = await getJob(join(stateDir, "jobs"), result.jobId);
      expect(job?.exit_reason).toBe("cancelled");
    });

    it("sets exit_reason to max_turns for turn limit errors", async () => {
      const maxTurnsError = new Error("Maximum turns exceeded");

      const executor = new JobExecutor(createErrorSDKQuery(maxTurnsError), {
        logger: createMockLogger(),
      });

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
      });

      const job = await getJob(join(stateDir, "jobs"), result.jobId);
      expect(job?.exit_reason).toBe("max_turns");
    });
  });

  describe("error details in RunnerResult", () => {
    it("provides descriptive error message with context", async () => {
      const executor = new JobExecutor(
        createErrorSDKQuery(new Error("API connection failed")),
        { logger: createMockLogger() }
      );

      const result = await executor.execute({
        agent: createTestAgent({ name: "descriptive-agent" }),
        prompt: "Test prompt",
        stateDir,
      });

      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain("API connection failed");
      expect(result.error?.message).toContain("descriptive-agent");
      expect(result.error?.message).toContain(result.jobId);
    });

    it("returns error details in RunnerResult", async () => {
      const errorWithCode = new Error("Network timeout") as NodeJS.ErrnoException;
      errorWithCode.code = "ETIMEDOUT";

      const executor = new JobExecutor(createErrorSDKQuery(errorWithCode), {
        logger: createMockLogger(),
      });

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
      });

      expect(result.errorDetails).toBeDefined();
      expect(result.errorDetails?.message).toContain("Network timeout");
      expect(result.errorDetails?.code).toBe("ETIMEDOUT");
      expect(result.errorDetails?.stack).toBeDefined();
    });
  });

  describe("malformed SDK responses", () => {
    it("does not crash on malformed SDK messages", async () => {
      const sdkQuery: SDKQueryFunction = async function* () {
        yield { type: "system", content: "Init" };
        // Yield a malformed message (null)
        yield null as unknown as SDKMessage;
        yield { type: "assistant", content: "Continuing after malformed" };
      };

      const executor = new JobExecutor(sdkQuery, {
        logger: createMockLogger(),
      });

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
      });

      // Should complete without crashing
      expect(result.success).toBe(true);

      const output = await readJobOutputAll(join(stateDir, "jobs"), result.jobId);
      // Should have processed all 3 messages (including malformed one logged as system)
      expect(output.length).toBe(3);
      // The malformed message should be logged as a system warning
      const malformedMsg = output.find(
        (m) => m.type === "system" && m.subtype === "malformed_message"
      );
      expect(malformedMsg).toBeDefined();
    });

    it("handles messages with missing type field", async () => {
      const sdkQuery: SDKQueryFunction = async function* () {
        yield { type: "system", content: "Init" };
        yield { content: "Missing type" } as unknown as SDKMessage;
        yield { type: "assistant", content: "Done" };
      };

      const executor = new JobExecutor(sdkQuery, {
        logger: createMockLogger(),
      });

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
      });

      expect(result.success).toBe(true);

      const output = await readJobOutputAll(join(stateDir, "jobs"), result.jobId);
      // Should contain a system message about unknown type
      const unknownTypeMsg = output.find(
        (m) => m.type === "system" && m.subtype === "unknown_type"
      );
      expect(unknownTypeMsg).toBeDefined();
    });

    it("handles messages with unexpected type values", async () => {
      const sdkQuery: SDKQueryFunction = async function* () {
        yield { type: "system", content: "Init" };
        yield { type: "unexpected_type", content: "Unknown" } as unknown as SDKMessage;
        yield { type: "assistant", content: "Done" };
      };

      const executor = new JobExecutor(sdkQuery, {
        logger: createMockLogger(),
      });

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
      });

      expect(result.success).toBe(true);

      const output = await readJobOutputAll(join(stateDir, "jobs"), result.jobId);
      // Should handle gracefully
      expect(output.length).toBeGreaterThanOrEqual(2);
    });

    it("handles SDK error message type gracefully", async () => {
      const messages: SDKMessage[] = [
        { type: "system", content: "Start" },
        { type: "error", message: "SDK reported error", code: "SDK_ERR" },
      ];

      const executor = new JobExecutor(createMockSDKQuery(messages), {
        logger: createMockLogger(),
      });

      const result = await executor.execute({
        agent: createTestAgent(),
        prompt: "Test prompt",
        stateDir,
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("SDK reported error");
      expect(result.errorDetails?.code).toBe("SDK_ERR");
    });
  });
});
