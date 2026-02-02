# Agent Distribution System

**Status**: Design Phase
**Last Updated**: 2026-01-31

This document outlines the agent distribution and sharing system for herdctl, enabling users to easily discover, install, and share pre-configured agents.

---

## Table of Contents

- [Vision](#vision)
- [Agent Repository Structure](#agent-repository-structure)
- [Installation Flow](#installation-flow)
- [CLI Commands](#cli-commands)
- [Template System](#template-system)
- [Registry Design](#registry-design)
- [Security Model](#security-model)
- [Implementation Plan](#implementation-plan)
- [Use Cases](#use-cases)

---

## Vision

**"ShadCN for herdctl agents"** - A simple, GitHub-based distribution system that makes it easy to share and reuse agent configurations.

### Goals

1. **Easy sharing**: Publish agents as GitHub repos
2. **Simple installation**: One command to install and configure
3. **Customizable**: Template variables for personalization
4. **Discoverable**: Optional registry for finding agents
5. **Community-driven**: Anyone can create and share agents

### Non-Goals

- ❌ Complex package management (no dependency resolution, versioning is simple)
- ❌ Centralized hosting (agents live on GitHub, not our servers)
- ❌ Code execution during install (just file copying and templating)

---

## Agent Repository Structure

An agent repository is a template that contains all files needed to run the agent.

### Minimal Structure

```
competitive-analysis-agent/          # Repository root
├── agent.yaml                       # Agent configuration (required)
├── CLAUDE.md                        # Agent identity (optional)
├── README.md                        # Installation/usage docs (recommended)
└── .env.example                     # Example environment variables (optional)
```

### Full Structure

```
competitive-analysis-agent/
├── agent.yaml                       # Agent configuration template
├── CLAUDE.md                        # Agent identity/personality
├── README.md                        # Installation and usage guide
├── LICENSE                          # License file
├── .env.example                     # Example environment variables
├── herdctl.json                     # Agent metadata (for registry)
├── knowledge/                       # Domain knowledge files
│   ├── competitive-research-framework.md
│   ├── market-analysis-guide.md
│   └── industry-glossary.md
├── skills/                          # Custom skills (optional)
│   ├── analyze-competitor/
│   │   ├── skill.yaml
│   │   └── implementation.md
│   └── generate-report/
│       ├── skill.yaml
│       └── implementation.md
└── templates/                       # Report templates (optional)
    ├── daily-summary.md
    └── weekly-report.md
```

### File Descriptions

| File | Required | Purpose |
|------|----------|---------|
| `agent.yaml` | ✅ | Agent configuration with template variables |
| `herdctl.json` | ⚠️ | Metadata for registry (required for registry listing) |
| `README.md` | Recommended | Setup instructions, usage guide |
| `CLAUDE.md` | Optional | Agent personality and instructions |
| `knowledge/` | Optional | Domain-specific knowledge files |
| `skills/` | Optional | Custom Claude Code skills |
| `.env.example` | Optional | Example environment variables |

---

## Agent Metadata (herdctl.json)

The `herdctl.json` file contains metadata for registry listing and validation.

### Schema

```json
{
  "$schema": "https://herdctl.dev/schemas/agent-metadata.json",
  "name": "competitive-analysis",
  "version": "1.0.0",
  "description": "Daily competitive intelligence agent that monitors competitor websites and generates reports",
  "author": "edspencer",
  "repository": "github:edspencer/competitive-analysis-agent",
  "homepage": "https://github.com/edspencer/competitive-analysis-agent",
  "license": "MIT",
  "keywords": ["marketing", "competitive-analysis", "research", "monitoring"],

  "requires": {
    "herdctl": ">=0.1.0",
    "runtime": "cli",
    "env": [
      "COMPETITOR_WEBSITES",
      "DISCORD_WEBHOOK_URL"
    ],
    "workspace": true,
    "docker": false
  },

  "category": "marketing",
  "tags": ["monitoring", "automation", "reporting"],

  "screenshots": [
    "https://github.com/user/repo/blob/main/screenshots/dashboard.png"
  ],

  "examples": {
    "basic": "Simple daily competitive monitoring",
    "advanced": "Multi-competitor analysis with custom metrics"
  }
}
```

### Field Definitions

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Agent name (kebab-case, unique in registry) |
| `version` | string | Semantic version (1.0.0) |
| `description` | string | Short description (max 200 chars) |
| `author` | string | Author username or name |
| `repository` | string | GitHub repo (github:user/repo) |
| `license` | string | License identifier (MIT, Apache-2.0, etc.) |
| `keywords` | string[] | Search keywords |
| `requires.herdctl` | string | Min herdctl version (semver range) |
| `requires.runtime` | string | Required runtime (sdk/cli/both) |
| `requires.env` | string[] | Required environment variables |
| `requires.workspace` | boolean | Needs workspace directory |
| `requires.docker` | boolean | Requires Docker |
| `category` | string | Primary category |
| `tags` | string[] | Additional categorization |

---

## Agent Configuration Template (agent.yaml)

The agent configuration supports template variables for customization during installation.

### Example Template

```yaml
# Template variables are replaced during installation
name: ${AGENT_NAME}
description: "Competitive intelligence for ${PRODUCT_NAME}"

runtime: cli
workspace: ${WORKSPACE_PATH}

# Environment variables (prompted during install)
env:
  - COMPETITOR_WEBSITES      # Required
  - DISCORD_WEBHOOK_URL      # Required
  - SLACK_CHANNEL            # Optional

schedules:
  - name: daily-competitive-scan
    trigger:
      type: cron
      expression: "${CRON_SCHEDULE}"  # Default: "0 9 * * *"
    prompt: |
      Check competitor websites: ${COMPETITOR_WEBSITES}

      Analyze for changes:
      - New features or product updates
      - Pricing changes
      - Blog posts and announcements
      - UI/UX changes
      - Job postings (hiring signals)

      Generate competitive intelligence report and post to:
      Discord: ${DISCORD_WEBHOOK_URL}
      ${SLACK_CHANNEL:+Slack: $SLACK_CHANNEL}

identity:
  claude_md: inherit  # Use CLAUDE.md from agent directory
  knowledge_dir: ./knowledge/

permissions:
  mode: acceptEdits
  allowed_tools:
    - Read
    - Write
    - WebFetch
    - Bash

docker:
  enabled: ${DOCKER_ENABLED}  # Default: false
  network: none
```

### Template Variables

Variables use bash-style syntax:

| Syntax | Meaning | Example |
|--------|---------|---------|
| `${VAR}` | Required variable | `${AGENT_NAME}` |
| `${VAR:-default}` | Variable with default | `${CRON_SCHEDULE:-0 9 * * *}` |
| `${VAR:+text}` | Conditional (if set) | `${SLACK:+Slack: $SLACK}` |

---

## Installation Flow

### Command

```bash
herdctl agent add github:user/repo [options]
```

### Options

```bash
--name <name>          # Custom agent name (default: repo name)
--path <path>          # Install location (default: ./agents/<name>)
--workspace <path>     # Workspace directory (default: ./workspace/<name>)
--skip-prompts         # Use defaults for all variables
--dry-run              # Show what would be installed without installing
```

### Step-by-Step Flow

#### 1. Source Resolution

```bash
# User runs
herdctl agent add github:edspencer/competitive-analysis-agent

# CLI parses source
{
  type: 'github',
  owner: 'edspencer',
  repo: 'competitive-analysis-agent',
  ref: 'main'  // or specific tag/branch
}
```

#### 2. Clone Repository

```bash
# Clone to temporary directory
git clone https://github.com/edspencer/competitive-analysis-agent.git /tmp/herdctl-agent-xyz

# Or for specific version
git clone --branch v1.0.0 --depth 1 https://github.com/...
```

#### 3. Validate Structure

```typescript
// Check required files exist
const hasAgentYaml = existsSync(join(tempDir, 'agent.yaml'));
if (!hasAgentYaml) {
  throw new Error('Invalid agent repository: missing agent.yaml');
}

// Parse and validate herdctl.json
const metadata = await loadAndValidateMetadata(tempDir);

// Validate agent.yaml schema
const agentConfig = await loadAndValidateAgent(tempDir);
```

#### 4. Interactive Prompts

```bash
Installing: competitive-analysis (v1.0.0)
Description: Daily competitive intelligence agent

Configuration:
  Agent name? (competitive-analysis): competitor-tracker
  Product name? (My Product): Acme SaaS Platform
  Workspace path? (./workspace/competitor-tracker):

Environment Variables:
  COMPETITOR_WEBSITES (required): acme.com,widgetco.com,example.com
  DISCORD_WEBHOOK_URL (required): https://discord.com/api/webhooks/...
  SLACK_CHANNEL (optional): #competitive-intel

Schedule:
  CRON_SCHEDULE (0 9 * * *): 0 8 * * *  # 8am instead of 9am

Docker:
  Enable Docker? (n): y

Review configuration:
  Name: competitor-tracker
  Workspace: ./workspace/competitor-tracker
  Schedule: Daily at 8am
  Docker: Enabled

Proceed with installation? (Y/n):
```

#### 5. Template Substitution

```typescript
// Apply template variables
const variables = {
  AGENT_NAME: 'competitor-tracker',
  PRODUCT_NAME: 'Acme SaaS Platform',
  WORKSPACE_PATH: './workspace/competitor-tracker',
  COMPETITOR_WEBSITES: 'acme.com,widgetco.com,example.com',
  DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/...',
  SLACK_CHANNEL: '#competitive-intel',
  CRON_SCHEDULE: '0 8 * * *',
  DOCKER_ENABLED: 'true',
};

// Process agent.yaml
const agentYaml = readFileSync('agent.yaml', 'utf-8');
const resolved = substituteTemplate(agentYaml, variables);
writeFileSync('agent.yaml', resolved);
```

#### 6. Copy Files

```bash
# Copy agent files to project
cp -r /tmp/herdctl-agent-xyz ./agents/competitive-analysis/

# Remove git metadata
rm -rf ./agents/competitive-analysis/.git
```

#### 7. Update Configuration

```yaml
# Append to herdctl.yaml
agents:
  - path: ./agents/competitive-analysis/agent.yaml
```

```bash
# Append to .env
COMPETITOR_WEBSITES=acme.com,widgetco.com,example.com
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
SLACK_CHANNEL=#competitive-intel
```

#### 8. Initialize Workspace

```bash
# Create workspace directory
mkdir -p ./workspace/competitor-tracker

# Initialize git (optional)
cd ./workspace/competitor-tracker
git init
git add .
git commit -m "Initial workspace for competitor-tracker"
```

#### 9. Post-Install Summary

```bash
✅ Agent 'competitor-tracker' installed successfully!

Files installed:
  ./agents/competitive-analysis/
    ├── agent.yaml (configured)
    ├── CLAUDE.md
    ├── knowledge/ (3 files)
    └── README.md

Workspace created:
  ./workspace/competitor-tracker/

Configuration updated:
  herdctl.yaml (added agent reference)
  .env (added 3 environment variables)

Next steps:
  1. Review agent configuration:
     cat ./agents/competitive-analysis/agent.yaml

  2. Customize knowledge files:
     edit ./agents/competitive-analysis/knowledge/*.md

  3. Test the agent:
     herdctl trigger competitor-tracker

  4. Start the fleet:
     herdctl start

Documentation:
  ./agents/competitive-analysis/README.md
  https://github.com/edspencer/competitive-analysis-agent

Need help? Run: herdctl agent help competitor-tracker
```

---

## CLI Commands

### `herdctl agent add`

Install an agent from a source.

```bash
# From GitHub
herdctl agent add github:user/repo

# From GitHub with version
herdctl agent add github:user/repo@v1.0.0

# From local directory (development)
herdctl agent add ./path/to/agent

# From registry (future)
herdctl agent add competitive-analysis

# With custom name
herdctl agent add github:user/repo --name my-custom-name

# Skip interactive prompts
herdctl agent add github:user/repo --skip-prompts

# Dry run
herdctl agent add github:user/repo --dry-run
```

### `herdctl agent list`

List installed agents.

```bash
# List all agents
herdctl agent list

# Output:
# Name                  Source                                      Version  Installed
# competitor-tracker    github:user/competitive-analysis-agent     1.0.0    2 days ago
# content-writer        github:user/content-agent                  0.5.0    1 week ago
# github-triager        ./agents/custom-triager                    -        3 days ago
```

### `herdctl agent info`

Show information about an installed agent.

```bash
herdctl agent info competitor-tracker

# Output:
# Name: competitor-tracker
# Description: Competitive intelligence for Acme SaaS Platform
# Source: github:edspencer/competitive-analysis-agent
# Version: 1.0.0
# Installed: 2 days ago
#
# Files:
#   ./agents/competitive-analysis/
#   ./workspace/competitor-tracker/
#
# Environment variables:
#   COMPETITOR_WEBSITES
#   DISCORD_WEBHOOK_URL
#   SLACK_CHANNEL
#
# Schedules:
#   daily-competitive-scan (0 8 * * *)
```

### `herdctl agent update`

Update an installed agent to latest version.

```bash
# Update specific agent
herdctl agent update competitor-tracker

# Update all agents
herdctl agent update --all

# Check for updates without installing
herdctl agent update --check
```

**Update strategy:**
- Fetch latest version from source
- Show diff of changes
- Prompt for confirmation
- Preserve custom knowledge files (don't overwrite)
- Update agent.yaml template
- Re-prompt for new template variables

### `herdctl agent remove`

Remove an installed agent.

```bash
# Remove agent
herdctl agent remove competitor-tracker

# Keep workspace
herdctl agent remove competitor-tracker --keep-workspace

# Remove without confirmation
herdctl agent remove competitor-tracker --force
```

**Removal process:**
1. Remove agent files (`./agents/competitive-analysis/`)
2. Remove from `herdctl.yaml`
3. Optionally remove workspace
4. Optionally remove env vars from `.env` (prompt)

### `herdctl agent search` (Future)

Search the agent registry.

```bash
# Search by keyword
herdctl agent search competitive

# Filter by category
herdctl agent search --category marketing

# Filter by author
herdctl agent search --author edspencer
```

---

## Directory Structure

### Before Installation

```
my-project/
├── herdctl.yaml
├── .env
├── agents/
│   └── (empty)
└── workspace/
    └── (empty)
```

### After Installing competitive-analysis

```
my-project/
├── herdctl.yaml                    # Updated with agent reference
├── .env                            # Updated with env vars
├── agents/
│   └── competitive-analysis/       # Installed agent files
│       ├── agent.yaml              # Configured template
│       ├── CLAUDE.md
│       ├── README.md
│       ├── knowledge/
│       │   ├── competitive-research-framework.md
│       │   └── market-analysis-guide.md
│       └── .herdctl/
│           └── metadata.json       # Installation metadata
└── workspace/
    └── competitor-tracker/         # Agent workspace
        └── (agent writes here)
```

### Installation Metadata

Each installed agent gets metadata stored in `.herdctl/metadata.json`:

```json
{
  "source": "github:edspencer/competitive-analysis-agent",
  "version": "1.0.0",
  "installedAt": "2026-01-31T12:00:00Z",
  "installedBy": "herdctl agent add",
  "variables": {
    "AGENT_NAME": "competitor-tracker",
    "PRODUCT_NAME": "Acme SaaS Platform",
    "WORKSPACE_PATH": "./workspace/competitor-tracker"
  },
  "customizations": [
    "knowledge/custom-metrics.md"
  ]
}
```

### Multiple Instances

You can install the same agent template multiple times:

```
my-project/
├── agents/
│   ├── competitive-analysis-acme/       # Instance 1
│   │   └── agent.yaml (name: acme-competitor-tracker)
│   └── competitive-analysis-widgets/    # Instance 2
│       └── agent.yaml (name: widget-competitor-tracker)
└── workspace/
    ├── acme-competitor-tracker/
    └── widget-competitor-tracker/
```

---

## Template System

### Variable Syntax

Templates use bash-style variable syntax:

```yaml
# Simple substitution
name: ${AGENT_NAME}

# With default value
schedule: ${CRON_SCHEDULE:-0 9 * * *}

# Conditional (only if variable is set)
${SLACK_CHANNEL:+- Slack: $SLACK_CHANNEL}

# Nested in strings
prompt: |
  Check ${COMPETITOR_COUNT:-5} competitors
  Report to ${NOTIFICATION_CHANNEL}
```

### Variable Types

During installation, variables are prompted with appropriate UI:

```typescript
interface VariablePrompt {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'multiline';
  description: string;
  default?: string;
  required: boolean;
  validation?: RegExp | ((value: string) => boolean);
  options?: string[];  // For select type
}
```

### Example Variable Configuration

In `agent.yaml` comments:

```yaml
# @herdctl-var AGENT_NAME
# @type string
# @description Unique name for this agent instance
# @required true
name: ${AGENT_NAME}

# @herdctl-var CRON_SCHEDULE
# @type string
# @description When to run (cron format)
# @default 0 9 * * *
# @pattern ^[0-9\s\*\-,/]+$
schedules:
  - trigger:
      expression: ${CRON_SCHEDULE:-0 9 * * *}

# @herdctl-var DOCKER_ENABLED
# @type boolean
# @description Run agent in Docker container
# @default false
docker:
  enabled: ${DOCKER_ENABLED:-false}
```

### Variable Extraction

```typescript
// Extract variables from template
function extractVariables(template: string): VariableDefinition[] {
  const variables = [];

  // Find all ${VAR} and ${VAR:-default}
  const varRegex = /\$\{([A-Z_][A-Z0-9_]*)(:-([^}]+))?\}/g;

  for (const match of template.matchAll(varRegex)) {
    variables.push({
      name: match[1],
      default: match[3],
      required: !match[3],  // No default = required
    });
  }

  return variables;
}
```

---

## Registry Design

### Registry Structure

The agent registry is a simple static JSON file hosted at `https://herdctl.dev/registry.json`:

```json
{
  "version": "1.0.0",
  "agents": {
    "competitive-analysis": {
      "name": "competitive-analysis",
      "version": "1.0.0",
      "description": "Daily competitive intelligence agent",
      "author": "edspencer",
      "repository": "github:edspencer/competitive-analysis-agent",
      "category": "marketing",
      "keywords": ["competitive-analysis", "monitoring", "research"],
      "downloads": 1234,
      "stars": 56,
      "updatedAt": "2026-01-15T10:00:00Z"
    },
    "content-writer": {
      "name": "content-writer",
      "version": "2.1.0",
      "description": "Automated content creation and scheduling",
      "author": "contentcrew",
      "repository": "github:contentcrew/content-writer-agent",
      "category": "content",
      "keywords": ["writing", "content", "automation"],
      "downloads": 5678,
      "stars": 123,
      "updatedAt": "2026-01-20T14:30:00Z"
    }
  },
  "categories": {
    "marketing": { "name": "Marketing", "description": "Marketing automation agents" },
    "development": { "name": "Development", "description": "Developer productivity agents" },
    "content": { "name": "Content", "description": "Content creation and management" },
    "operations": { "name": "Operations", "description": "DevOps and infrastructure" },
    "support": { "name": "Support", "description": "Customer support and engagement" }
  }
}
```

### Registry Submission

To submit an agent to the registry:

```bash
# 1. Ensure your repo has herdctl.json
cat herdctl.json

# 2. Submit PR to registry repo
gh repo clone herdctl/registry
cd registry
./scripts/add-agent.sh github:yourname/your-agent

# 3. Creates PR with validation
# - Validates herdctl.json schema
# - Checks repository exists
# - Verifies agent.yaml is valid
# - Adds entry to registry.json
```

### Registry Website

Simple static site at `herdctl.dev/agents`:

```
┌────────────────────────────────────────────────────┐
│ herdctl Agents                          [Search]   │
├────────────────────────────────────────────────────┤
│                                                    │
│ Categories: [All] [Marketing] [Development]       │
│                                                    │
│ ┌──────────────────────────────────────────────┐  │
│ │ Competitive Analysis              ⭐ 56      │  │
│ │ by edspencer                                 │  │
│ │                                              │  │
│ │ Daily competitive intelligence agent that   │  │
│ │ monitors competitor websites and generates  │  │
│ │ reports.                                     │  │
│ │                                              │  │
│ │ [Install] [View Docs] [GitHub]              │  │
│ └──────────────────────────────────────────────┘  │
│                                                    │
│ ┌──────────────────────────────────────────────┐  │
│ │ Content Writer                    ⭐ 123     │  │
│ │ by contentcrew                               │  │
│ │                                              │  │
│ │ Automated content creation and scheduling   │  │
│ │ with AI-powered writing assistance.         │  │
│ │                                              │  │
│ │ [Install] [View Docs] [GitHub]              │  │
│ └──────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────┘
```

---

## Security Model

### Installation Safety

**What's allowed:**
- ✅ Clone public GitHub repos
- ✅ Copy files to local directory
- ✅ Parse and validate YAML/JSON
- ✅ Prompt user for configuration
- ✅ Update local config files

**What's NOT allowed:**
- ❌ Execute arbitrary code during installation
- ❌ Network requests except git clone
- ❌ Modify files outside project directory
- ❌ Auto-populate secrets without user input

### Repository Validation

```typescript
async function validateAgentRepo(repoPath: string): Promise<ValidationResult> {
  const checks = [
    // Required files
    () => checkFileExists(repoPath, 'agent.yaml'),

    // Valid YAML syntax
    () => validateYamlSyntax(join(repoPath, 'agent.yaml')),

    // Valid schema
    () => validateAgentSchema(join(repoPath, 'agent.yaml')),

    // No malicious patterns
    () => checkForMaliciousContent(repoPath),

    // Metadata validation (if present)
    () => validateMetadata(join(repoPath, 'herdctl.json')),
  ];

  for (const check of checks) {
    const result = await check();
    if (!result.valid) {
      return result;
    }
  }

  return { valid: true };
}
```

### Malicious Content Detection

```typescript
function checkForMaliciousContent(repoPath: string): ValidationResult {
  const dangerousPatterns = [
    // Command injection attempts
    /\$\(.*\)/g,
    /`.*`/g,

    // Suspicious bash commands
    /rm\s+-rf/g,
    /curl.*\|.*bash/g,

    // Credential harvesting
    /aws_secret_access_key/gi,
    /password\s*=\s*['"].*['"]/gi,
  ];

  // Scan all text files
  const files = glob.sync('**/*.{yaml,yml,md,sh}', { cwd: repoPath });

  for (const file of files) {
    const content = readFileSync(join(repoPath, file), 'utf-8');

    for (const pattern of dangerousPatterns) {
      if (pattern.test(content)) {
        return {
          valid: false,
          error: `Suspicious pattern found in ${file}`,
          pattern: pattern.source,
        };
      }
    }
  }

  return { valid: true };
}
```

### Environment Variable Safety

**Never auto-populate secrets:**

```typescript
function promptForEnvVar(varName: string): string {
  // Check if it looks like a secret
  const secretPatterns = [
    /key/i,
    /token/i,
    /secret/i,
    /password/i,
    /credential/i,
  ];

  const isSecret = secretPatterns.some(p => p.test(varName));

  if (isSecret) {
    console.warn(`⚠️  ${varName} appears to be sensitive`);
    console.warn('   Never commit this value to version control');
  }

  // Always prompt, never use defaults for secrets
  const value = readlineSync.question(`${varName}: `, {
    hideEchoBack: isSecret,  // Hide input for secrets
  });

  return value;
}
```

### Sandboxing Recommendations

```yaml
# Recommended: Install agents with Docker enabled by default
agents:
  installed-agent:
    docker:
      enabled: true  # Sandboxed by default
      network: none  # No network access
```

---

## Implementation Plan

### Phase 1: Core Installation (MVP)

**Goal**: `herdctl agent add github:user/repo` works

**Tasks**:
- [ ] CLI command: `herdctl agent add`
- [ ] GitHub repo cloning
- [ ] Template variable extraction
- [ ] Interactive prompts
- [ ] Template substitution
- [ ] File copying to `./agents/`
- [ ] Update `herdctl.yaml`
- [ ] Update `.env`
- [ ] Workspace initialization

**Deliverable**: Can install agents from GitHub

### Phase 2: Management Commands

**Goal**: Full agent lifecycle management

**Tasks**:
- [ ] CLI command: `herdctl agent list`
- [ ] CLI command: `herdctl agent info`
- [ ] CLI command: `herdctl agent remove`
- [ ] CLI command: `herdctl agent update`
- [ ] Installation metadata tracking
- [ ] Update detection

**Deliverable**: Can manage installed agents

### Phase 3: Validation & Safety

**Goal**: Safe installation with validation

**Tasks**:
- [ ] Agent schema validation
- [ ] Metadata schema validation
- [ ] Malicious content detection
- [ ] Environment variable classification
- [ ] Dry-run mode
- [ ] Installation rollback on error

**Deliverable**: Safe, validated installations

### Phase 4: Registry

**Goal**: Discoverable agent ecosystem

**Tasks**:
- [ ] Registry JSON schema
- [ ] Registry submission process
- [ ] CLI command: `herdctl agent search`
- [ ] Registry website (static site)
- [ ] Registry validation CI
- [ ] Agent analytics (downloads, stars)

**Deliverable**: herdctl.dev/agents registry

### Phase 5: Developer Experience

**Goal**: Easy agent authoring

**Tasks**:
- [ ] CLI command: `herdctl agent init` (scaffold new agent)
- [ ] Agent template validator
- [ ] Local testing tools
- [ ] Publishing guide
- [ ] Example agent templates
- [ ] Documentation

**Deliverable**: Great DX for creating agents

---

## Use Cases

### Use Case 1: Install Competitive Analysis Agent

**Scenario**: User wants to monitor competitors

```bash
# Discover agent
herdctl agent search competitive

# Install
herdctl agent add github:marketingtools/competitive-analysis

# Prompted for:
# - Agent name
# - Product name
# - Competitor websites
# - Discord webhook
# - Schedule

# Result: Daily competitive intelligence reports
```

### Use Case 2: Share Internal Agent

**Scenario**: Company wants to share agent across teams

```bash
# Developer creates agent
cd ~/agents
herdctl agent init sales-intelligence
# ... configure agent ...

# Push to private GitHub
gh repo create acme-corp/sales-intelligence-agent --private
git push origin main

# Other teams install
herdctl agent add github:acme-corp/sales-intelligence-agent
# Requires GitHub auth for private repo
```

### Use Case 3: Agent Collection

**Scenario**: Install complete marketing automation suite

```bash
# Install full marketing suite
herdctl agent add github:marketing-suite/competitor-monitor
herdctl agent add github:marketing-suite/content-calendar
herdctl agent add github:marketing-suite/social-media-scheduler
herdctl agent add github:marketing-suite/analytics-reporter

# Result: 4 agents working together
```

### Use Case 4: Customize Community Agent

**Scenario**: Install agent and customize for specific needs

```bash
# Install base agent
herdctl agent add github:community/seo-monitor

# Customize knowledge files
edit ./agents/seo-monitor/knowledge/custom-metrics.md

# Add custom skills
cp my-seo-analyzer.md ./agents/seo-monitor/skills/

# Agent now uses custom knowledge and skills
```

### Use Case 5: Agent Development Workflow

**Scenario**: Developer creates and publishes agent

```bash
# 1. Initialize new agent
herdctl agent init my-awesome-agent
cd my-awesome-agent

# 2. Configure
edit agent.yaml
edit CLAUDE.md
edit herdctl.json

# 3. Test locally
herdctl agent add ./
herdctl trigger my-awesome-agent

# 4. Publish to GitHub
gh repo create my-awesome-agent --public
git push origin main

# 5. Submit to registry
gh repo clone herdctl/registry
./scripts/add-agent.sh github:myname/my-awesome-agent

# 6. Others can now install
# herdctl agent add my-awesome-agent
```

---

## Comparison to Similar Systems

### vs. ShadCN UI

| Aspect | ShadCN | herdctl agents |
|--------|--------|----------------|
| **Source** | Registry + GitHub | GitHub (registry future) |
| **Install command** | `npx shadcn-ui add button` | `herdctl agent add name` |
| **Customization** | Copy source, edit freely | Template vars + knowledge files |
| **Updates** | Re-run add (overwrites) | `herdctl agent update` (merge strategy) |
| **Language** | React/TypeScript | YAML + Markdown |
| **Ownership** | Yours after copy | Reference to source |

### vs. npm packages

| Aspect | npm | herdctl agents |
|--------|-----|----------------|
| **Dependencies** | Complex graph | None (flat) |
| **Versioning** | Semver with ranges | Simple semver |
| **Installation** | `npm install` | `herdctl agent add` |
| **Registry** | npmjs.com | herdctl.dev (future) |
| **Code execution** | install scripts | ❌ Never |
| **Customization** | Fork + publish | Template + local files |

### vs. Docker Hub

| Aspect | Docker Hub | herdctl agents |
|--------|------------|----------------|
| **Distribution** | Container images | GitHub repos |
| **Size** | Can be large | Small (text files) |
| **Security** | Image scanning | Content validation |
| **Versioning** | Tags | Git tags |
| **Customization** | Dockerfile extend | Template variables |

---

## Future Enhancements

### Agent Packs

Bundle multiple related agents:

```bash
herdctl pack add marketing-automation
# Installs: competitor-monitor, content-calendar, social-scheduler
```

### Agent Marketplace

Paid/premium agents with licensing:

```yaml
# herdctl.json
"pricing": {
  "model": "subscription",
  "price": "$20/month",
  "trial": "14 days"
}
```

### Agent Dependencies

Agents that build on other agents:

```yaml
# herdctl.json
"dependencies": {
  "base-reporter": "^1.0.0"
}
```

### Visual Agent Builder

Web UI for creating agents without YAML:

```
herdctl.dev/builder
- Drag-and-drop schedule configuration
- Visual prompt builder
- Knowledge file editor
- One-click publish
```

---

## Open Questions

1. **Agent updates**: How to handle when agent.yaml changes?
   - Preserve user customizations
   - Merge strategy or full replace?

2. **Knowledge file customization**: Should users edit in place or overlay?
   - Option A: Edit directly in `./agents/agent-name/knowledge/`
   - Option B: Create `./knowledge-overrides/` for custom files

3. **Multi-instance naming**: Enforce naming convention?
   - `agent-name-1`, `agent-name-2`?
   - User picks arbitrary names?

4. **Registry moderation**: How to prevent malicious agents?
   - Manual review?
   - Automated scanning?
   - Community reporting?

---

## Success Metrics

- **Adoption**: Number of agents installed
- **Creation**: Number of agents published
- **Quality**: Average stars/downloads per agent
- **Diversity**: Number of categories covered
- **Community**: Number of contributors

**Target (6 months post-launch)**:
- 50+ agents in registry
- 1000+ installations
- 20+ contributors
- 5+ categories

---

## Appendix: Example Agent Repository

See: [github.com/herdctl/agent-template](https://github.com/herdctl/agent-template)

Full example showing:
- Complete directory structure
- Template variables
- Knowledge files
- Custom skills
- Documentation
- Testing approach
