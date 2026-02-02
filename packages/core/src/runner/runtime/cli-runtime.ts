/**
 * CLI Runtime implementation
 *
 * Executes Claude agents via the Claude CLI instead of the SDK, enabling Max plan
 * pricing for agent execution. This runtime spawns the `claude` CLI command and
 * watches the session file for messages (since claude only outputs to TTY).
 *
 * Requirements:
 * - Claude CLI must be installed (`brew install claude-ai/tap/claude`)
 * - CLI must be authenticated (`claude login`)
 * - Uses Max plan pricing when available
 *
 * The CLIRuntime provides identical streaming interface to SDKRuntime, allowing
 * seamless runtime switching via agent configuration.
 */

import { execa, type Subprocess } from "execa";
import type { RuntimeInterface, RuntimeExecuteOptions } from "./interface.js";
import type { SDKMessage } from "../types.js";
import {
  getCliSessionDir,
  findNewestSessionFile,
} from "./cli-session-path.js";
import { CLISessionWatcher } from "./cli-session-watcher.js";

/**
 * CLI runtime implementation
 *
 * This runtime uses the Claude CLI to execute agents, providing an alternative
 * backend to the SDK runtime. It spawns `claude` CLI and watches the session file
 * for new messages (since claude only outputs stream-json to TTY).
 *
 * The CLI runtime enables:
 * - Max plan pricing (cost savings vs SDK/API pricing)
 * - Full Claude Code capabilities (identical to manual CLI usage)
 * - AbortController support for process cancellation
 *
 * @example
 * ```typescript
 * const runtime = new CLIRuntime();
 * const messages = runtime.execute({
 *   prompt: "Fix the bug in auth.ts",
 *   agent: resolvedAgent,
 * });
 *
 * for await (const message of messages) {
 *   console.log(message.type, message.content);
 * }
 * ```
 */
export class CLIRuntime implements RuntimeInterface {
  /**
   * Execute an agent using the Claude CLI
   *
   * Spawns `claude` CLI and watches the session file for messages. The session
   * file approach is used because claude only outputs stream-json to TTY, not
   * to pipes.
   *
   * Process flow:
   * 1. Build CLI arguments from execution options
   * 2. Spawn claude subprocess (output is ignored)
   * 3. Find the CLI session directory for the workspace
   * 4. Wait briefly for session file to be created
   * 5. Find the newest .jsonl file (the one just created)
   * 6. Watch that file and stream messages as they're appended
   * 7. Handle process completion and exit codes
   *
   * @param options - Execution options including prompt, agent, and session info
   * @returns AsyncIterable of SDK messages
   */
  async *execute(options: RuntimeExecuteOptions): AsyncIterable<SDKMessage> {
    // Build CLI arguments
    // Note: -p is a boolean flag for print mode, prompt goes at the end as positional arg
    const args: string[] = [
      "-p",
      "--dangerously-skip-permissions",
    ];

    // Add session options
    if (options.resume) {
      args.push("--resume", options.resume);
    }
    if (options.fork) {
      args.push("--fork-session");
    }

    // Add prompt as positional argument at the end
    args.push(options.prompt);

    // Track process and watcher for cleanup
    let subprocess: Subprocess | undefined;
    let watcher: CLISessionWatcher | undefined;
    let hasError = false;

    try {
      // Determine working directory root for cwd
      const working_directory = options.agent.working_directory;
      const cwd = working_directory
        ? typeof working_directory === "string"
          ? working_directory
          : working_directory.root
        : process.cwd();

      // Get the CLI session directory where files will be written
      const sessionDir = getCliSessionDir(cwd);

      // Spawn claude subprocess (we won't read its output)
      subprocess = execa("claude", args, {
        cwd,
        cancelSignal: options.abortController?.signal,
      });

      // Wait for session file to be created (claude creates it almost immediately)
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Find the newest session file (the one just created)
      const sessionFilePath = await findNewestSessionFile(sessionDir);

      // Watch the session file for messages
      watcher = new CLISessionWatcher(sessionFilePath);

      // Set up abort handling
      if (options.abortController) {
        options.abortController.signal.addEventListener("abort", () => {
          subprocess?.kill();
          watcher?.stop();
        });
      }

      // Stream messages from the session file
      for await (const message of watcher.watch()) {
        yield message;

        // Track errors
        if (message.type === "error") {
          hasError = true;
        }

        // If this is a result message, we're done
        if (message.type === "result") {
          break;
        }
      }

      // Wait for process to complete
      const { exitCode } = await subprocess;

      // If process failed and we didn't yield an error message, create one
      if (exitCode !== 0 && !hasError) {
        yield {
          type: "error",
          message: `Claude CLI exited with code ${exitCode}`,
          code: `EXIT_${exitCode}`,
        };
      }
    } catch (error) {
      // Handle process errors
      if (error && typeof error === "object" && "code" in error) {
        const execaError = error as { code?: string; message: string };

        // CLI not found
        if (execaError.code === "ENOENT") {
          yield {
            type: "error",
            message:
              "Claude CLI not found. Install with: brew install claude-ai/tap/claude",
            code: "CLI_NOT_FOUND",
          };
          return;
        }

        // Process was killed (likely by AbortController)
        if (execaError.code === "ABORT_ERR") {
          yield {
            type: "error",
            message: "Claude CLI execution was cancelled",
            code: "CANCELLED",
          };
          return;
        }
      }

      // Generic error
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      yield {
        type: "error",
        message: `CLI execution failed: ${errorMessage}`,
      };
    } finally {
      // Cleanup
      watcher?.stop();
    }
  }
}
