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
  const sensitivePatterns = ["state/directory", "state/job", "state/session"];

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
        context.includes("agentName") ||
        context.includes("jobId")
      ) {
        // Check if there's validation nearby or if buildSafeFilePath is used
        const hasValidation =
          context.includes("validate") ||
          context.includes("sanitize") ||
          context.includes("normalize") ||
          context.includes("path.resolve") ||
          context.includes("includes('..')") ||
          context.includes("startsWith(") ||
          context.includes("isValidId") ||
          context.includes("isValidIdentifier") ||
          context.includes("buildSafeFilePath") ||
          content.includes("buildSafeFilePath"); // Also check full file

        if (!hasValidation) {
          findings.push({
            severity: "medium",
            location: `${match.file}:${match.line}`,
            description:
              "path.join with potentially user-controlled ID - verify validation",
            recommendation:
              "Use buildSafeFilePath or ensure IDs are validated before use in paths",
          });
        }
      }
    }
  }

  return findings;
}

function checkPathValidation(projectRoot: string): Finding[] {
  const findings: Finding[] = [];

  // Check for path-safety.ts utility (defense-in-depth for path traversal)
  const pathSafetyFile = `${projectRoot}/packages/core/src/state/utils/path-safety.ts`;
  if (!existsSync(pathSafetyFile)) {
    findings.push({
      severity: "high",
      location: "packages/core/src/state/utils/",
      description: "Path safety utility not found",
      recommendation:
        "Implement buildSafeFilePath utility to prevent path traversal attacks",
    });
  } else {
    // Verify it has the expected protection mechanisms
    const content = readFileSync(pathSafetyFile, "utf-8");

    const hasPatternValidation = content.includes("SAFE_IDENTIFIER_PATTERN") ||
                                  content.includes("isValidIdentifier");
    const hasPathVerification = content.includes("startsWith") &&
                                 content.includes("resolve");
    const hasPathTraversalError = content.includes("PathTraversalError");

    if (!hasPatternValidation || !hasPathVerification || !hasPathTraversalError) {
      findings.push({
        severity: "medium",
        location: "packages/core/src/state/utils/path-safety.ts",
        description: "Path safety utility may be incomplete",
        recommendation:
          "Ensure path-safety.ts has identifier validation, path verification, and proper error handling",
      });
    }
  }

  // Check if session.ts and job-metadata.ts use the safe path utility
  const sessionFile = `${projectRoot}/packages/core/src/state/session.ts`;
  const jobMetadataFile = `${projectRoot}/packages/core/src/state/job-metadata.ts`;

  for (const file of [sessionFile, jobMetadataFile]) {
    if (existsSync(file)) {
      const content = readFileSync(file, "utf-8");
      if (!content.includes("buildSafeFilePath")) {
        const fileName = file.split("/").pop();
        findings.push({
          severity: "high",
          location: `packages/core/src/state/${fileName}`,
          description: `${fileName} does not use buildSafeFilePath for path construction`,
          recommendation:
            "Use buildSafeFilePath from path-safety.ts for defense-in-depth",
        });
      }
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
