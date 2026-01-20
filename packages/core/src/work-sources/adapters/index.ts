/**
 * Built-in Work Source Adapters
 *
 * This module exports built-in adapters and registers them with the
 * work source registry at module load time.
 */

import { registerWorkSource, isWorkSourceRegistered } from "../registry.js";
import {
  createGitHubAdapter,
  GitHubWorkSourceAdapter,
  GitHubAPIError,
  GitHubAuthError,
  extractRateLimitInfo,
  isRateLimitResponse,
  calculateBackoffDelay,
  type GitHubWorkSourceConfig,
  type GitHubIssue,
  type RateLimitInfo,
  type RateLimitWarningOptions,
  type RetryOptions,
} from "./github.js";

// =============================================================================
// Re-export Adapters
// =============================================================================

export {
  GitHubWorkSourceAdapter,
  createGitHubAdapter,
  GitHubAPIError,
  GitHubAuthError,
  extractRateLimitInfo,
  isRateLimitResponse,
  calculateBackoffDelay,
};
export type {
  GitHubWorkSourceConfig,
  GitHubIssue,
  RateLimitInfo,
  RateLimitWarningOptions,
  RetryOptions,
};

// =============================================================================
// Auto-registration of Built-in Adapters
// =============================================================================

/**
 * Register built-in adapters
 *
 * This function is called automatically when the module is imported.
 * It only registers adapters that haven't already been registered,
 * allowing tests to pre-register mocks before importing this module.
 */
function registerBuiltInAdapters(): void {
  // Register GitHub adapter if not already registered
  if (!isWorkSourceRegistered("github")) {
    registerWorkSource("github", createGitHubAdapter);
  }
}

// Auto-register on module load
registerBuiltInAdapters();
