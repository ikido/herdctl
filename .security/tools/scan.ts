#!/usr/bin/env npx tsx
/**
 * herdctl Security Scanner
 *
 * Runs deterministic security checks against the codebase.
 * Designed to be run both manually and by the security agent.
 *
 * Usage:
 *   npx tsx .security/tools/scan.ts [--json] [--save]
 *
 * Options:
 *   --json    Output results as JSON instead of human-readable
 *   --save    Save results to .security/scans/YYYY-MM-DD.json
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Check implementations
import { checkNpmAudit } from "./checks/npm-audit.js";
import { checkDockerConfig } from "./checks/docker-config.js";
import { checkPermissionModes } from "./checks/permission-modes.js";
import { checkSubprocessPatterns } from "./checks/subprocess-patterns.js";
import { checkPathSafety } from "./checks/path-safety.js";
import { checkEnvHandling } from "./checks/env-handling.js";

// Types
export interface CheckResult {
  name: string;
  status: "pass" | "warn" | "fail";
  findings: Finding[];
  duration: number;
}

export interface Finding {
  severity: "low" | "medium" | "high" | "critical";
  location?: string;
  description: string;
  recommendation?: string;
}

export interface ScanResult {
  date: string;
  timestamp: string;
  commit: string;
  branch: string;
  checks: CheckResult[];
  summary: {
    total: number;
    passed: number;
    warned: number;
    failed: number;
  };
  status: "pass" | "warn" | "fail";
  duration: number;
}

// Get project root (relative to this script)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "..", "..");

function getGitInfo(): { commit: string; branch: string } {
  try {
    const commit = execSync("git rev-parse --short HEAD", {
      cwd: PROJECT_ROOT,
      encoding: "utf-8",
    }).trim();
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: PROJECT_ROOT,
      encoding: "utf-8",
    }).trim();
    return { commit, branch };
  } catch {
    return { commit: "unknown", branch: "unknown" };
  }
}

async function runCheck(
  name: string,
  checkFn: () => Promise<Finding[]>
): Promise<CheckResult> {
  const start = Date.now();
  try {
    const findings = await checkFn();
    const duration = Date.now() - start;

    // Determine status based on findings
    const hasCritical = findings.some((f) => f.severity === "critical");
    const hasHigh = findings.some((f) => f.severity === "high");
    const hasMedium = findings.some((f) => f.severity === "medium");

    let status: "pass" | "warn" | "fail" = "pass";
    if (hasCritical || hasHigh) {
      status = "fail";
    } else if (hasMedium) {
      status = "warn";
    } else if (findings.length > 0) {
      status = "warn";
    }

    return { name, status, findings, duration };
  } catch (error) {
    return {
      name,
      status: "fail",
      findings: [
        {
          severity: "high",
          description: `Check failed to run: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      duration: Date.now() - start,
    };
  }
}

async function runAllChecks(): Promise<ScanResult> {
  const start = Date.now();
  const { commit, branch } = getGitInfo();
  const now = new Date();

  console.error("Running security checks...\n");

  const checks: CheckResult[] = [];

  // Run all checks
  const checkDefinitions = [
    { name: "npm-audit", fn: () => checkNpmAudit(PROJECT_ROOT) },
    { name: "docker-config", fn: () => checkDockerConfig(PROJECT_ROOT) },
    { name: "permission-modes", fn: () => checkPermissionModes(PROJECT_ROOT) },
    {
      name: "subprocess-patterns",
      fn: () => checkSubprocessPatterns(PROJECT_ROOT),
    },
    { name: "path-safety", fn: () => checkPathSafety(PROJECT_ROOT) },
    { name: "env-handling", fn: () => checkEnvHandling(PROJECT_ROOT) },
  ];

  for (const { name, fn } of checkDefinitions) {
    process.stderr.write(`  Checking ${name}...`);
    const result = await runCheck(name, fn);
    checks.push(result);
    console.error(
      ` ${result.status.toUpperCase()} (${result.duration}ms, ${result.findings.length} findings)`
    );
  }

  // Calculate summary
  const summary = {
    total: checks.length,
    passed: checks.filter((c) => c.status === "pass").length,
    warned: checks.filter((c) => c.status === "warn").length,
    failed: checks.filter((c) => c.status === "fail").length,
  };

  // Overall status
  let status: "pass" | "warn" | "fail" = "pass";
  if (summary.failed > 0) {
    status = "fail";
  } else if (summary.warned > 0) {
    status = "warn";
  }

  return {
    date: now.toISOString().split("T")[0],
    timestamp: now.toISOString(),
    commit,
    branch,
    checks,
    summary,
    status,
    duration: Date.now() - start,
  };
}

function formatHumanReadable(result: ScanResult): string {
  const lines: string[] = [];

  lines.push("═".repeat(60));
  lines.push("  HERDCTL SECURITY SCAN REPORT");
  lines.push("═".repeat(60));
  lines.push("");
  lines.push(`  Date:    ${result.date}`);
  lines.push(`  Commit:  ${result.commit}`);
  lines.push(`  Branch:  ${result.branch}`);
  lines.push(`  Status:  ${result.status.toUpperCase()}`);
  lines.push("");

  // Summary
  lines.push("─".repeat(60));
  lines.push("  SUMMARY");
  lines.push("─".repeat(60));
  lines.push(
    `  Total checks: ${result.summary.total}  |  Passed: ${result.summary.passed}  |  Warned: ${result.summary.warned}  |  Failed: ${result.summary.failed}`
  );
  lines.push("");

  // Findings by check
  for (const check of result.checks) {
    if (check.findings.length === 0) continue;

    lines.push("─".repeat(60));
    lines.push(`  ${check.name.toUpperCase()} (${check.status})`);
    lines.push("─".repeat(60));

    for (const finding of check.findings) {
      const icon =
        finding.severity === "critical"
          ? "[!!]"
          : finding.severity === "high"
            ? "[!]"
            : finding.severity === "medium"
              ? "[~]"
              : "[.]";

      lines.push(`  ${icon} [${finding.severity.toUpperCase()}] ${finding.description}`);
      if (finding.location) {
        lines.push(`      Location: ${finding.location}`);
      }
      if (finding.recommendation) {
        lines.push(`      Recommendation: ${finding.recommendation}`);
      }
      lines.push("");
    }
  }

  // Footer
  lines.push("═".repeat(60));
  lines.push(`  Completed in ${result.duration}ms`);
  lines.push("═".repeat(60));

  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const jsonOutput = args.includes("--json");
  const saveResult = args.includes("--save");

  const result = await runAllChecks();

  // Output
  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatHumanReadable(result));
  }

  // Save if requested
  if (saveResult) {
    const scansDir = join(PROJECT_ROOT, ".security", "scans");
    if (!existsSync(scansDir)) {
      mkdirSync(scansDir, { recursive: true });
    }
    const filename = join(scansDir, `${result.date}.json`);
    writeFileSync(filename, JSON.stringify(result, null, 2));
    console.error(`\nResults saved to ${filename}`);
  }

  // Exit code based on status
  if (result.status === "fail") {
    process.exit(1);
  } else if (result.status === "warn") {
    process.exit(0); // Warnings don't fail the scan
  }
}

main().catch((error) => {
  console.error("Scanner failed:", error);
  process.exit(2);
});
