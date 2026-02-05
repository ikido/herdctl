/**
 * Permission modes security check
 *
 * Checks for usage of dangerous permission modes:
 * - bypassPermissions - Most dangerous, bypasses all safety checks
 * - acceptEdits - Auto-accepts file modifications
 *
 * These should be rare and well-justified.
 */

import type { Finding } from "../scan.js";
import { grepForPattern, shouldSkipFile } from "../utils.js";

export async function checkPermissionModes(projectRoot: string): Promise<Finding[]> {
  const findings: Finding[] = [];

  // Check for bypassPermissions usage
  findings.push(...checkBypassPermissions(projectRoot));

  // Check for acceptEdits usage
  findings.push(...checkAcceptEdits(projectRoot));

  // Check for dontAsk usage
  findings.push(...checkDontAsk(projectRoot));

  return findings;
}

function checkBypassPermissions(projectRoot: string): Finding[] {
  const findings: Finding[] = [];

  const matches = grepForPattern(projectRoot, "bypassPermissions", {
    fileTypes: "ts,js,yaml,yml,json,md",
  });

  // Filter to actual usage (not schema definitions or docs)
  const usageMatches = matches.filter((match) => {
    if (shouldSkipFile(match.file)) return false;

    // Skip CLAUDE.md (project instructions)
    if (match.file === "CLAUDE.md") return false;

    // Skip schema definitions
    if (
      match.content.includes("PermissionModeSchema") ||
      match.content.includes("enum") ||
      match.content.includes("type ") ||
      match.content.includes("interface ")
    ) {
      return false;
    }

    // Skip test assertions
    if (
      match.content.includes("expect(") ||
      match.content.includes("toBe(")
    ) {
      return false;
    }

    return true;
  });

  // Count actual usages in config files
  const configUsages = usageMatches.filter(
    (m) =>
      m.file.endsWith(".yaml") ||
      m.file.endsWith(".yml") ||
      m.file.endsWith(".json")
  );

  // Code usages need context
  const codeUsages = usageMatches.filter(
    (m) => m.file.endsWith(".ts") || m.file.endsWith(".js")
  );

  if (configUsages.length > 0) {
    findings.push({
      severity: "high",
      location: configUsages.map((m) => `${m.file}:${m.line}`).join(", "),
      description: `bypassPermissions used in ${configUsages.length} config file(s)`,
      recommendation:
        "bypassPermissions bypasses ALL safety checks. Review each usage carefully.",
    });
  }

  // Code usage in non-schema files needs review
  const nonSchemaCodeUsages = codeUsages.filter(
    (m) =>
      !m.file.includes("schema") &&
      !m.file.includes("types") &&
      !m.content.includes("PermissionMode")
  );

  if (nonSchemaCodeUsages.length > 0) {
    for (const match of nonSchemaCodeUsages) {
      findings.push({
        severity: "medium",
        location: `${match.file}:${match.line}`,
        description: "bypassPermissions referenced in code",
        recommendation:
          "Ensure this is only for schema/type definitions, not setting the value",
      });
    }
  }

  return findings;
}

function checkAcceptEdits(projectRoot: string): Finding[] {
  const findings: Finding[] = [];

  const matches = grepForPattern(projectRoot, "acceptEdits", {
    fileTypes: "yaml,yml,json",
  });

  const configUsages = matches.filter((match) => {
    if (shouldSkipFile(match.file)) return false;
    return true;
  });

  if (configUsages.length > 0) {
    findings.push({
      severity: "medium",
      location: configUsages.map((m) => `${m.file}:${m.line}`).join(", "),
      description: `acceptEdits used in ${configUsages.length} config file(s)`,
      recommendation:
        "acceptEdits auto-accepts file modifications. Ensure this is intentional.",
    });
  }

  return findings;
}

function checkDontAsk(projectRoot: string): Finding[] {
  const findings: Finding[] = [];

  const matches = grepForPattern(projectRoot, "dontAsk", {
    fileTypes: "yaml,yml,json",
  });

  const configUsages = matches.filter((match) => {
    if (shouldSkipFile(match.file)) return false;
    return true;
  });

  if (configUsages.length > 0) {
    findings.push({
      severity: "medium",
      location: configUsages.map((m) => `${m.file}:${m.line}`).join(", "),
      description: `dontAsk used in ${configUsages.length} config file(s)`,
      recommendation:
        "dontAsk allows all operations without prompting. Review each usage.",
    });
  }

  return findings;
}
