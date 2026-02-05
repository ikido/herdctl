/**
 * Subprocess spawning patterns security check
 *
 * Checks for potentially dangerous subprocess spawning:
 * - Shell string interpolation (command injection risk)
 * - Use of shell: true option
 * - Unvalidated user input in commands
 */

import { readFileSync, existsSync } from "node:fs";
import type { Finding } from "../scan.js";
import { grepForPattern, shouldSkipFile } from "../utils.js";

export async function checkSubprocessPatterns(projectRoot: string): Promise<Finding[]> {
  const findings: Finding[] = [];

  // Check for execa usage patterns
  findings.push(...checkExecaPatterns(projectRoot));

  // Check for child_process usage
  findings.push(...checkChildProcessPatterns(projectRoot));

  // Check for shell: true usage
  findings.push(...checkShellOption(projectRoot));

  return findings;
}

function checkExecaPatterns(projectRoot: string): Finding[] {
  const findings: Finding[] = [];

  // Find files that import execa
  const execaImports = grepForPattern(projectRoot, 'from.*execa', {
    fileTypes: "ts,js",
  });
  const filesWithExeca = new Set(
    execaImports.filter((m) => !shouldSkipFile(m.file)).map((m) => m.file)
  );

  // Check each file for potentially dangerous patterns
  for (const file of filesWithExeca) {
    const filePath = `${projectRoot}/${file}`;
    if (!existsSync(filePath)) continue;

    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    // Look for template literal usage with execa
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Dangerous: execa(`command ${variable}`)
      if (line.includes("execa(`") || line.includes("execa(\\`")) {
        findings.push({
          severity: "high",
          location: `${file}:${lineNum}`,
          description: "Template literal in execa call - potential command injection",
          recommendation:
            "Use array form: execa('command', [arg1, arg2]) instead of string interpolation",
        });
      }

      // Dangerous: execa(variable) where variable might be user-controlled
      if (/execa\(\s*[a-zA-Z_]\w*\s*[,)]/.test(line) && !line.includes('execa("') && !line.includes("execa('")) {
        // This might be a variable command - needs review
        findings.push({
          severity: "medium",
          location: `${file}:${lineNum}`,
          description: "Variable used as execa command - verify source is trusted",
          recommendation:
            "Ensure the command variable comes from a trusted source, not user input",
        });
      }
    }
  }

  return findings;
}

function checkChildProcessPatterns(projectRoot: string): Finding[] {
  const findings: Finding[] = [];

  // Check for direct child_process usage (should prefer execa)
  const cpImports = grepForPattern(projectRoot, 'from.*child_process', {
    fileTypes: "ts,js",
  });

  for (const match of cpImports) {
    if (shouldSkipFile(match.file)) continue;

    findings.push({
      severity: "low",
      location: `${match.file}:${match.line}`,
      description: "Direct child_process import - consider using execa instead",
      recommendation:
        "execa provides better escaping and cross-platform support",
    });
  }

  // Check for execSync with template literals
  const execSyncCalls = grepForPattern(projectRoot, 'execSync\\(', {
    fileTypes: "ts,js",
  });

  for (const match of execSyncCalls) {
    if (shouldSkipFile(match.file)) continue;

    const filePath = `${projectRoot}/${match.file}`;
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      const line = lines[match.line - 1] || "";

      if (line.includes("execSync(`") || line.includes("execSync(\\`")) {
        findings.push({
          severity: "high",
          location: `${match.file}:${match.line}`,
          description: "Template literal in execSync - potential command injection",
          recommendation:
            "Validate/sanitize interpolated values or use array form with execa",
        });
      }
    }
  }

  return findings;
}

function checkShellOption(projectRoot: string): Finding[] {
  const findings: Finding[] = [];

  // Check for shell: true option
  const shellTrue = grepForPattern(projectRoot, "shell:\\s*true", {
    fileTypes: "ts,js",
  });

  for (const match of shellTrue) {
    if (shouldSkipFile(match.file)) continue;

    findings.push({
      severity: "medium",
      location: `${match.file}:${match.line}`,
      description: "shell: true option enables shell interpretation",
      recommendation:
        "Avoid shell: true unless necessary - it enables shell metacharacter processing",
    });
  }

  return findings;
}
