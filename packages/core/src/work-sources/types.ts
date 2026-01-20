/**
 * Type definitions for work sources
 *
 * Defines common types for work items, fetch options, and operation results
 * that all work source adapters must implement.
 */

// =============================================================================
// Work Item Types
// =============================================================================

/**
 * Priority levels for work items
 */
export type WorkItemPriority = "critical" | "high" | "medium" | "low";

/**
 * A work item that can be processed by an agent
 *
 * Represents a unit of work from any source (GitHub Issues, Linear, etc.)
 * with normalized fields for consistent handling across sources.
 */
export interface WorkItem {
  /** Unique identifier within herdctl (source-prefixed) */
  id: string;
  /** The type of source this work item came from (e.g., 'github', 'linear') */
  source: string;
  /** The original ID from the external system */
  externalId: string;
  /** Title or summary of the work item */
  title: string;
  /** Full description or body of the work item */
  description: string;
  /** Priority level of the work item */
  priority: WorkItemPriority;
  /** Labels/tags associated with the work item */
  labels: string[];
  /** Source-specific metadata (e.g., GitHub milestone, assignees) */
  metadata: Record<string, unknown>;
  /** URL to view the work item in the external system */
  url: string;
  /** When the work item was created */
  createdAt: Date;
  /** When the work item was last updated */
  updatedAt: Date;
}

// =============================================================================
// Fetch Options Types
// =============================================================================

/**
 * Options for fetching available work items
 *
 * Supports filtering by labels/priority and pagination for large result sets.
 */
export interface FetchOptions {
  /** Filter by labels (items must have ALL specified labels) */
  labels?: string[];
  /** Filter by priority levels (items must match ONE of the priorities) */
  priority?: WorkItemPriority[];
  /** Maximum number of items to return */
  limit?: number;
  /** Cursor for pagination (opaque string from previous response) */
  cursor?: string;
  /** Include items that are already claimed by this source */
  includeClaimed?: boolean;
}

/**
 * Result of fetching work items with pagination info
 */
export interface FetchResult {
  /** The fetched work items */
  items: WorkItem[];
  /** Cursor for fetching the next page (undefined if no more pages) */
  nextCursor?: string;
  /** Total count of matching items (if available from source) */
  totalCount?: number;
}

// =============================================================================
// Claim Result Types
// =============================================================================

/**
 * Reasons why claiming a work item might fail
 */
export type ClaimFailureReason =
  | "already_claimed"
  | "not_found"
  | "permission_denied"
  | "source_error"
  | "invalid_state";

/**
 * Result of attempting to claim a work item
 *
 * Indicates whether the claim succeeded and provides details on failure.
 */
export interface ClaimResult {
  /** Whether the claim was successful */
  success: boolean;
  /** The claimed work item (if successful) */
  workItem?: WorkItem;
  /** Reason for failure (if unsuccessful) */
  reason?: ClaimFailureReason;
  /** Human-readable error message (if unsuccessful) */
  message?: string;
}

// =============================================================================
// Work Result Types
// =============================================================================

/**
 * Outcome status of completing work
 */
export type WorkOutcome = "success" | "failure" | "partial";

/**
 * Result of completing a work item
 *
 * Captures the outcome and any artifacts or comments to post back to the source.
 */
export interface WorkResult {
  /** The outcome of the work */
  outcome: WorkOutcome;
  /** Summary of what was accomplished */
  summary: string;
  /** Detailed description of changes made (for PR descriptions, etc.) */
  details?: string;
  /** Artifacts produced (e.g., file paths, URLs) */
  artifacts?: string[];
  /** Error message if outcome is failure or partial */
  error?: string;
}

// =============================================================================
// Release Options Types
// =============================================================================

/**
 * Options for releasing a claimed work item
 */
export interface ReleaseOptions {
  /** Reason for releasing the work item */
  reason?: string;
  /** Whether to add a comment to the work item explaining the release */
  addComment?: boolean;
}

/**
 * Result of releasing a work item
 */
export interface ReleaseResult {
  /** Whether the release was successful */
  success: boolean;
  /** Error message if unsuccessful */
  message?: string;
}
