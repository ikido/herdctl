/**
 * Path safety security check
 *
 * Checks for path traversal vulnerabilities:
 * - Unvalidated path.join with user input
 * - Missing path.resolve normalization
 * - Direct string concatenation for paths
 */

import { readFileSync, existsSync } from "node:fs";
import type { Finding } from "../scan.js";
import { grepForPattern, shouldSkipFile } from "../utils.js";

export async function checkPathSafety(projectRoot: string): Promise<Finding[]> {
  const findings: Finding[] = [];

  // Check for path.join patterns in sensitive files
  findings.push(...checkPathJoinPatterns(projectRoot));

  // Check for proper validation in state directory
  findings.push(...checkPathValidation(projectRoot));

  return findings;
}

function checkPathJoinPatterns(projectRoot: string): Finding[] {
  const findings: Finding[] = [];

  // Find all path.join usages in state directory handling
  const pathJoins = grepForPattern(projectRoot, "path\\.join\\(", {
    fileTypes: "ts,js",
  });

  // Files that handle user input (config, state)
  const sensitivePatterns = ["state/directory", "state/job"];

  for (const match of pathJoins) {
    if (shouldSkipFile(match.file)) continue;

    // Check if this file is in a sensitive area
    const isSensitive = sensitivePatterns.some((p) =>
      match.file.toLowerCase().includes(p)
    );

    if (isSensitive) {
      const filePath = `${projectRoot}/${match.file}`;
      if (!existsSync(filePath)) continue;

      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n");

      // Look at surrounding lines for context
      const startLine = Math.max(0, match.line - 10);
      const endLine = Math.min(lines.length, match.line + 10);
      const context = lines.slice(startLine, endLine).join("\n");

      // Check for potential user-controlled input
      if (
        context.includes("agentId") ||
        context.includes("jobId")
      ) {
        // Check if there's validation nearby
        const hasValidation =
          context.includes("validate") ||
          context.includes("sanitize") ||
          context.includes("normalize") ||
          context.includes("path.resolve") ||
          context.includes("includes('..')") ||
          context.includes("startsWith(") ||
          context.includes("isValidId");

        if (!hasValidation) {
          findings.push({
            severity: "medium",
            location: `${match.file}:${match.line}`,
            description:
              "path.join with potentially user-controlled ID - verify validation",
            recommendation:
              "Ensure IDs are validated before use in paths (no '..' or absolute paths)",
          });
        }
      }
    }
  }

  return findings;
}

function checkPathValidation(projectRoot: string): Finding[] {
  const findings: Finding[] = [];

  // Check state/directory.ts specifically since it's critical
  const directoryFile = `${projectRoot}/packages/core/src/state/directory.ts`;
  if (existsSync(directoryFile)) {
    const content = readFileSync(directoryFile, "utf-8");

    // Check for path traversal protection
    const hasTraversalCheck =
      (content.includes("..") &&
        (content.includes("includes") ||
          content.includes("indexOf") ||
          content.includes("startsWith"))) ||
      content.includes("isValidId") ||
      content.includes("validateId");

    const hasNormalization =
      content.includes("path.resolve") || content.includes("path.normalize");

    if (!hasTraversalCheck && !hasNormalization) {
      findings.push({
        severity: "high",
        location: "packages/core/src/state/directory.ts",
        description:
          "State directory may lack path traversal protection",
        recommendation:
          "Add validation to prevent '../' in agent/job IDs and normalize paths",
      });
    }
  }

  // Check if working-directory-validation.ts exists and is used
  const wdvFile = `${projectRoot}/packages/core/src/state/working-directory-validation.ts`;
  if (!existsSync(wdvFile)) {
    findings.push({
      severity: "high",
      location: "packages/core/src/state/",
      description: "Working directory validation file not found",
      recommendation:
        "Implement working directory validation to prevent session mixup",
    });
  }

  return findings;
}
