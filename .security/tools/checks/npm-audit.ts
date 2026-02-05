/**
 * npm audit check
 *
 * Runs `pnpm audit` to check for known vulnerabilities in dependencies.
 */

import { execSync } from "node:child_process";
import type { Finding } from "../scan.js";

interface NpmAuditVulnerability {
  name: string;
  severity: string;
  via: Array<string | { name: string; severity: string; title: string }>;
  effects: string[];
  range: string;
  fixAvailable: boolean | { name: string; version: string };
}

interface NpmAuditResult {
  vulnerabilities: Record<string, NpmAuditVulnerability>;
  metadata: {
    vulnerabilities: {
      info: number;
      low: number;
      moderate: number;
      high: number;
      critical: number;
      total: number;
    };
  };
}

export async function checkNpmAudit(projectRoot: string): Promise<Finding[]> {
  const findings: Finding[] = [];

  try {
    // Run pnpm audit with JSON output
    let auditOutput: string;
    try {
      auditOutput = execSync("pnpm audit --json 2>/dev/null", {
        cwd: projectRoot,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error: unknown) {
      // pnpm audit exits with code 1 if vulnerabilities found
      if (
        error &&
        typeof error === "object" &&
        "stdout" in error &&
        typeof error.stdout === "string"
      ) {
        auditOutput = error.stdout;
      } else {
        throw error;
      }
    }

    // Parse JSON output
    let audit: NpmAuditResult;
    try {
      audit = JSON.parse(auditOutput);
    } catch {
      // pnpm audit output might be different format, try simpler parse
      // Just report that we couldn't parse it
      findings.push({
        severity: "low",
        description: "Could not parse pnpm audit output - manual review recommended",
        recommendation: "Run `pnpm audit` manually to check for vulnerabilities",
      });
      return findings;
    }

    // Process vulnerabilities - only report summary, not each individual one
    const vulnCounts = audit.metadata?.vulnerabilities;
    if (vulnCounts) {
      if (vulnCounts.critical > 0) {
        findings.push({
          severity: "critical",
          description: `${vulnCounts.critical} critical vulnerabilities found in dependencies`,
          recommendation: "Run `pnpm audit fix` or manually update affected packages",
        });
      }

      if (vulnCounts.high > 0) {
        findings.push({
          severity: "high",
          description: `${vulnCounts.high} high severity vulnerabilities found in dependencies`,
          recommendation: "Run `pnpm audit fix` or manually update affected packages",
        });
      }

      if (vulnCounts.moderate > 0) {
        findings.push({
          severity: "medium",
          description: `${vulnCounts.moderate} moderate vulnerabilities found in dependencies`,
          recommendation: "Review and update affected packages when possible",
        });
      }

      // Don't report low/info vulnerabilities individually - too noisy
    }
  } catch (error) {
    findings.push({
      severity: "medium",
      description: `Failed to run pnpm audit: ${error instanceof Error ? error.message : String(error)}`,
      recommendation: "Ensure pnpm is installed and try running manually",
    });
  }

  return findings;
}
