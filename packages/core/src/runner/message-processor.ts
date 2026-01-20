/**
 * Message processor for transforming SDK messages to job output format
 *
 * Handles all Claude SDK message types and converts them to the format
 * expected by the job output logging system. Includes robust handling
 * of malformed or unexpected SDK responses.
 */

import type { SDKMessage, ProcessedMessage } from "./types.js";
import type { JobOutputInput } from "../state/index.js";

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Safely extract a string value from an unknown field
 */
function safeString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return undefined;
  }
  // Convert other types to string for safety
  try {
    return String(value);
  } catch {
    return undefined;
  }
}

/**
 * Safely extract a boolean value from an unknown field
 */
function safeBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  return undefined;
}

/**
 * Check if a value is a valid SDK message type
 */
function isValidMessageType(
  type: unknown
): type is "system" | "assistant" | "tool_use" | "tool_result" | "error" {
  return (
    type === "system" ||
    type === "assistant" ||
    type === "tool_use" ||
    type === "tool_result" ||
    type === "error"
  );
}

// =============================================================================
// Message Type Handlers
// =============================================================================

/**
 * Process a system message from the SDK
 *
 * Session ID is specifically extracted from messages with subtype "init",
 * as this is when the Claude SDK provides the session identifier.
 */
function processSystemMessage(message: SDKMessage): ProcessedMessage {
  const output: JobOutputInput = {
    type: "system",
  };

  if (message.content) {
    output.content = message.content;
  }

  if (message.subtype) {
    output.subtype = message.subtype;
  }

  // Extract session ID specifically from init messages
  // The Claude SDK provides session_id in the system message with subtype "init"
  const sessionId =
    message.subtype === "init" ? message.session_id : undefined;

  return {
    output,
    sessionId,
  };
}

/**
 * Process an assistant message from the SDK
 */
function processAssistantMessage(message: SDKMessage): ProcessedMessage {
  const output: JobOutputInput = {
    type: "assistant",
  };

  if (message.content !== undefined) {
    output.content = message.content;
  }

  if (message.partial !== undefined) {
    output.partial = message.partial as boolean;
  }

  // Handle usage statistics
  if (message.usage) {
    const usage = message.usage as {
      input_tokens?: number;
      output_tokens?: number;
    };
    output.usage = {};
    if (usage.input_tokens !== undefined) {
      output.usage.input_tokens = usage.input_tokens;
    }
    if (usage.output_tokens !== undefined) {
      output.usage.output_tokens = usage.output_tokens;
    }
  }

  return { output };
}

/**
 * Process a tool use message from the SDK
 */
function processToolUseMessage(message: SDKMessage): ProcessedMessage {
  // Tool name is required - try multiple possible field names
  const toolName = message.tool_name ?? message.name ?? "unknown";

  const output: JobOutputInput = {
    type: "tool_use",
    tool_name: toolName as string,
  };

  if (message.tool_use_id) {
    output.tool_use_id = message.tool_use_id;
  }

  if (message.input !== undefined) {
    output.input = message.input;
  }

  return { output };
}

/**
 * Process a tool result message from the SDK
 */
function processToolResultMessage(message: SDKMessage): ProcessedMessage {
  const output: JobOutputInput = {
    type: "tool_result",
  };

  if (message.tool_use_id) {
    output.tool_use_id = message.tool_use_id;
  }

  if (message.result !== undefined) {
    output.result = message.result;
  }

  if (message.success !== undefined) {
    output.success = message.success as boolean;
  }

  if (message.error !== undefined) {
    output.error = message.error as string;
  }

  return { output };
}

/**
 * Process an error message from the SDK
 */
function processErrorMessage(message: SDKMessage): ProcessedMessage {
  const output: JobOutputInput = {
    type: "error",
    message: (message.message as string) ?? "Unknown error",
  };

  if (message.code) {
    output.code = message.code;
  }

  if (message.stack) {
    output.stack = message.stack as string;
  }

  return {
    output,
    isFinal: true,
  };
}

// =============================================================================
// Main Processing Function
// =============================================================================

/**
 * Process an SDK message into job output format
 *
 * Takes a message from the Claude Agent SDK and transforms it into
 * the format expected by the job output logging system. This function
 * handles malformed responses gracefully without crashing.
 *
 * @param message - The SDK message to process
 * @returns Processed message with output and optional metadata
 *
 * @example
 * ```typescript
 * const sdkMessage = { type: "assistant", content: "Hello!" };
 * const { output, sessionId } = processSDKMessage(sdkMessage);
 * await appendJobOutput(jobsDir, jobId, output);
 * ```
 */
export function processSDKMessage(message: SDKMessage): ProcessedMessage {
  // Handle null/undefined messages - log as system warning, not error
  // to avoid terminating execution due to malformed SDK responses
  if (message === null || message === undefined) {
    return {
      output: {
        type: "system",
        content: "Received null or undefined SDK message",
        subtype: "malformed_message",
      },
    };
  }

  // Handle non-object messages - log as system warning
  if (typeof message !== "object") {
    return {
      output: {
        type: "system",
        content: `Expected object message, received ${typeof message}`,
        subtype: "malformed_message",
      },
    };
  }

  // Validate message type
  const messageType = message.type;

  if (!isValidMessageType(messageType)) {
    // Handle unknown or missing message types gracefully
    const unknownType = safeString(messageType) ?? "undefined";
    return {
      output: {
        type: "system",
        content: `Unknown message type: ${unknownType}`,
        subtype: "unknown_type",
      },
    };
  }

  // Process known message types
  switch (messageType) {
    case "system":
      return processSystemMessage(message);

    case "assistant":
      return processAssistantMessage(message);

    case "tool_use":
      return processToolUseMessage(message);

    case "tool_result":
      return processToolResultMessage(message);

    case "error":
      return processErrorMessage(message);
  }
}

/**
 * Check if a message indicates the end of execution
 *
 * @param message - The SDK message to check
 * @returns true if this is a terminal message
 */
export function isTerminalMessage(message: SDKMessage): boolean {
  // Handle null/undefined/non-object messages - these are not terminal
  if (message === null || message === undefined || typeof message !== "object") {
    return false;
  }

  // Error messages are terminal
  if (message.type === "error") {
    return true;
  }

  // System messages with certain subtypes indicate completion
  if (message.type === "system") {
    const subtype = message.subtype as string | undefined;
    if (
      subtype === "end" ||
      subtype === "complete" ||
      subtype === "session_end"
    ) {
      return true;
    }
  }

  return false;
}

/** Maximum summary length in characters */
const MAX_SUMMARY_LENGTH = 500;

/**
 * Truncate a string to maximum length, adding ellipsis if truncated
 */
function truncateSummary(text: string): string {
  if (text.length <= MAX_SUMMARY_LENGTH) {
    return text;
  }
  return text.slice(0, MAX_SUMMARY_LENGTH - 3) + "...";
}

/**
 * Extract the final summary from a message if present
 *
 * Looks for summaries in the following order:
 * 1. Explicit `summary` field on the message (truncated to 500 chars)
 * 2. Short assistant message content (≤500 chars, non-partial)
 *
 * @param message - The SDK message to extract summary from
 * @returns Summary string if present, undefined otherwise
 */
export function extractSummary(message: SDKMessage): string | undefined {
  // Handle null/undefined/non-object messages
  if (message === null || message === undefined || typeof message !== "object") {
    return undefined;
  }

  // Check for explicit summary field (truncate if too long)
  if (message.summary) {
    const summaryStr = String(message.summary);
    return truncateSummary(summaryStr);
  }

  // For assistant messages, use content as potential summary
  if (message.type === "assistant" && message.content && !message.partial) {
    // Only use if it looks like a conclusion (short enough)
    if (message.content.length <= MAX_SUMMARY_LENGTH) {
      return message.content;
    }
  }

  return undefined;
}
