# PRD 3: herdctl Documentation Site

## Overview

Build the documentation site for herdctl using Astro + Starlight in the `docs/` directory. This PRD establishes the documentation foundation early, enabling all subsequent PRDs to incrementally update documentation as features are implemented.

The documentation site will:
1. Provide a comprehensive reference for all herdctl concepts
2. Document the configuration system (from PRD 1)
3. Document the state management system (from PRD 2)
4. Serve as the canonical source for herdctl usage and reference

---

## User Stories

### US-1: Initialize Astro with Starlight
**As a** documentation contributor
**I want to** have a working Astro/Starlight project in `docs/`
**So that** I can create and preview documentation locally

**Acceptance Criteria:**
- Astro 4.x with `@astrojs/starlight` installed in `docs/`
- Package configured for pnpm workspace (already in `pnpm-workspace.yaml`)
- `pnpm dev` starts local development server on port 4321
- `pnpm build` produces static site in `dist/`
- Site title: "herdctl"
- Site tagline: "Autonomous Agent Fleet Management for Claude Code"
- Configured for eventual deployment to herdctl.dev

**Files:**
```
docs/
├── astro.config.mjs
├── package.json
├── tsconfig.json
└── src/
    └── content/
        └── config.ts
```

---

### US-2: Create Landing Page and Structure
**As a** visitor to the documentation
**I want to** see a welcoming overview page
**So that** I understand what herdctl is and how to navigate the docs

**Acceptance Criteria:**
- Welcome page (`index.mdx`) with project overview
- Clear tagline: "Autonomous Agent Fleet Management for Claude Code"
- Brief description of what herdctl does (from SPEC.md Vision section)
- Quick navigation to key sections
- Feature highlights (Fleet Management, Declarative Config, Multiple Triggers, Work Sources)

**Files:**
```
docs/src/content/docs/index.mdx
```

---

### US-3: Configure Sidebar Navigation
**As a** documentation reader
**I want to** navigate between sections easily
**So that** I can find information quickly

**Acceptance Criteria:**
- Starlight sidebar configured with hierarchical structure:
  - Welcome
  - Getting Started (placeholder)
  - Concepts (Agents, Schedules, Triggers, Jobs, Workspaces, Sessions)
  - Configuration (Fleet Config, Agent Config, Permissions, MCP Servers, Environment)
  - Internals (State Management)
  - CLI Reference (placeholder)
- Sections collapsed by default for cleaner navigation
- Badge for "Placeholder" sections

**Files:**
```
docs/astro.config.mjs (sidebar configuration)
```

---

### US-4: Create Concepts Section - Agents
**As a** fleet operator
**I want to** understand what an Agent is
**So that** I can configure my agents correctly

**Acceptance Criteria:**
- Explains Agent concept (configured Claude instance with identity, workspace, permissions, schedules)
- Includes ASCII diagram from SPEC.md showing Agent structure
- Documents key agent properties: name, description, workspace, repo, identity, schedules
- Links to Configuration Reference for detailed schema
- Example agent YAML snippet

**Files:**
```
docs/src/content/docs/concepts/agents.mdx
```

---

### US-5: Create Concepts Section - Schedules
**As a** fleet operator
**I want to** understand how Schedules work
**So that** I can configure when my agents run

**Acceptance Criteria:**
- Explains Schedule concept (trigger + prompt combination)
- Documents that agents can have multiple schedules
- Shows examples: hourly scan + daily analytics + weekly report
- Links to Triggers concept
- Example schedule YAML

**Files:**
```
docs/src/content/docs/concepts/schedules.mdx
```

---

### US-6: Create Concepts Section - Triggers
**As a** fleet operator
**I want to** understand trigger types
**So that** I can choose the right trigger for my use case

**Acceptance Criteria:**
- Documents all trigger types:
  - **Interval**: "Every X minutes/hours after last completion"
  - **Cron**: Standard cron expressions
  - **Webhook**: HTTP POST endpoints (future)
  - **Chat**: Discord/Slack messages (future)
- Shows syntax for each trigger type
- Examples for common patterns

**Files:**
```
docs/src/content/docs/concepts/triggers.mdx
```

---

### US-7: Create Concepts Section - Jobs
**As a** fleet operator
**I want to** understand what Jobs are
**So that** I can track and monitor agent executions

**Acceptance Criteria:**
- Explains Job concept (single execution of an agent)
- Documents job properties: id, agent, schedule, status, session_id, timestamps, output
- Documents job statuses: running, completed, failed, cancelled
- Documents exit reasons: success, error, timeout, manual_cancel
- Explains job output format (JSONL)
- Links to State Management for storage details

**Files:**
```
docs/src/content/docs/concepts/jobs.mdx
```

---

### US-8: Create Concepts Section - Workspaces
**As a** fleet operator
**I want to** understand workspace isolation
**So that** my agents don't interfere with my development clones

**Acceptance Criteria:**
- Explains workspace concept (directory where agent operates)
- Documents the isolation problem (agents shouldn't touch dev clones)
- Explains workspace root configuration
- Shows directory structure example from SPEC.md
- Documents auto-clone behavior
- Notes that multiple agents can share a workspace

**Files:**
```
docs/src/content/docs/concepts/workspaces.mdx
```

---

### US-9: Create Concepts Section - Sessions
**As a** fleet operator
**I want to** understand session management
**So that** I can control agent context persistence

**Acceptance Criteria:**
- Explains Session concept (Claude context)
- Documents session modes:
  - `fresh_per_job`: New session each job
  - `persistent`: Maintain context across jobs
  - `per_channel`: For chat integrations
- Documents resume/fork capabilities
- Example configuration

**Files:**
```
docs/src/content/docs/concepts/sessions.mdx
```

---

### US-10: Create Configuration Reference - Fleet Config
**As a** fleet operator
**I want to** know all fleet configuration options
**So that** I can configure my fleet correctly

**Acceptance Criteria:**
- Documents `herdctl.yaml` complete schema
- All fields documented with:
  - Type (from Zod schema)
  - Default value (if any)
  - Description
  - Example
- Fields to document (from `FleetConfigSchema`):
  - `version`: Config version (default: 1)
  - `fleet.name`, `fleet.description`: Fleet metadata
  - `defaults`: Default agent settings
  - `workspace.root`, `workspace.auto_clone`, `workspace.clone_depth`, `workspace.default_branch`
  - `agents`: Array of agent references
  - `chat.discord`: Discord configuration
  - `webhooks`: Webhook configuration
  - `docker`: Docker configuration
- Complete example YAML

**Files:**
```
docs/src/content/docs/configuration/fleet-config.mdx
```

---

### US-11: Create Configuration Reference - Agent Config
**As a** fleet operator
**I want to** know all agent configuration options
**So that** I can configure my agents correctly

**Acceptance Criteria:**
- Documents complete agent YAML schema
- All fields documented (from `AgentConfigSchema`):
  - `name` (required), `description`
  - `workspace`, `repo`
  - `identity.name`, `identity.role`, `identity.personality`
  - `system_prompt`
  - `work_source.type`, `work_source.labels`
  - `schedules` (map of schedule configs)
  - `session.max_turns`, `session.timeout`, `session.model`
  - `permissions` (see Permissions page)
  - `mcp_servers` (see MCP Servers page)
  - `chat.discord`
  - `docker`
  - `model`, `max_turns`, `permission_mode`
- Multiple examples: coder agent, marketer agent, support agent

**Files:**
```
docs/src/content/docs/configuration/agent-config.mdx
```

---

### US-12: Create Configuration Reference - Permissions
**As a** fleet operator
**I want to** control what tools my agents can use
**So that** I can ensure appropriate access levels

**Acceptance Criteria:**
- Documents permission modes (from `PermissionModeSchema`):
  - `default`: Requires approval for everything
  - `acceptEdits`: Auto-approve file operations
  - `bypassPermissions`: Auto-approve everything
  - `plan`: Planning only, no execution
- Documents `allowed_tools` and `denied_tools` arrays
- Documents bash restrictions: `allowed_commands`, `denied_patterns`
- Examples for common permission patterns
- Security recommendations

**Files:**
```
docs/src/content/docs/configuration/permissions.mdx
```

---

### US-13: Create Configuration Reference - MCP Servers
**As a** fleet operator
**I want to** configure MCP servers for my agents
**So that** agents can access external services

**Acceptance Criteria:**
- Explains MCP concept briefly
- Documents `mcp_servers` configuration (from `McpServerSchema`):
  - HTTP-based: `url`
  - Process-based: `command`, `args`, `env`
- Documents tool naming: `mcp__<server>__<tool>`
- Documents wildcard support: `mcp__posthog__*`
- Examples: PostHog, GitHub, filesystem MCP servers
- Shows how to combine with `allowed_tools`

**Files:**
```
docs/src/content/docs/configuration/mcp-servers.mdx
```

---

### US-14: Create Configuration Reference - Environment Variables
**As a** fleet operator
**I want to** use environment variables in my config
**So that** I can inject secrets safely

**Acceptance Criteria:**
- Documents interpolation syntax:
  - `${VAR_NAME}`: Required variable
  - `${VAR_NAME:-default}`: With default value
- Documents where interpolation works (any string value)
- Documents error behavior for undefined variables
- Security recommendations (never commit secrets)
- Common patterns: API tokens, URLs, paths

**Files:**
```
docs/src/content/docs/configuration/environment.mdx
```

---

### US-15: Create State Management Reference
**As a** developer or operator
**I want to** understand how herdctl stores state
**So that** I can debug issues or integrate tooling

**Acceptance Criteria:**
- Documents `.herdctl/` directory structure:
  - `state.yaml`: Fleet state
  - `jobs/`: Job files
  - `sessions/`: Session info
  - `logs/`: Agent logs
- Documents `state.yaml` format (from `FleetStateSchema`):
  - `fleet.started_at`
  - `agents.<name>.status`, `current_job`, `last_job`, `next_schedule`, etc.
- Documents job file formats:
  - `job-<id>.yaml`: Metadata
  - `job-<id>.jsonl`: Streaming output
- Documents JSONL message types from SPEC.md
- Notes on atomic writes for safety

**Files:**
```
docs/src/content/docs/internals/state.mdx
```

---

### US-16: Create Getting Started Placeholder
**As a** new user
**I want to** see a getting started guide
**So that** I know how to begin using herdctl

**Acceptance Criteria:**
- Placeholder page with clear "Coming Soon" message
- Brief outline of what will be covered:
  - Installation
  - Creating your first agent
  - Running your fleet
  - Monitoring output
- Links to Concepts section for background reading
- Badge indicating placeholder status

**Files:**
```
docs/src/content/docs/getting-started.mdx
```

---

### US-17: Create CLI Reference Placeholder
**As a** user
**I want to** see the CLI commands available
**So that** I can operate my fleet

**Acceptance Criteria:**
- Placeholder page with clear "Coming Soon" message
- Lists planned commands from SPEC.md:
  - `herdctl start [agent]`
  - `herdctl stop [agent]`
  - `herdctl restart`
  - `herdctl status [agent]`
  - `herdctl logs [agent]`
  - `herdctl trigger <agent>`
  - `herdctl config validate`
  - `herdctl web`
- Badge indicating placeholder status

**Files:**
```
docs/src/content/docs/cli/reference.mdx
```

---

### US-18: Add Favicon and Assets
**As a** site visitor
**I want to** see proper branding
**So that** the site looks professional

**Acceptance Criteria:**
- Favicon in `docs/public/`
- Site logo configured (if available)
- OpenGraph meta tags for social sharing

**Files:**
```
docs/public/favicon.svg
```

---

## Technical Specifications

### File Structure

```
docs/
├── astro.config.mjs          # Astro + Starlight configuration
├── package.json              # Package with astro, starlight deps
├── tsconfig.json             # TypeScript config
├── src/
│   ├── content/
│   │   ├── config.ts         # Content collection config
│   │   └── docs/
│   │       ├── index.mdx                     # Welcome/overview
│   │       ├── getting-started.mdx           # Placeholder
│   │       ├── concepts/
│   │       │   ├── agents.mdx
│   │       │   ├── schedules.mdx
│   │       │   ├── triggers.mdx
│   │       │   ├── jobs.mdx
│   │       │   ├── workspaces.mdx
│   │       │   └── sessions.mdx
│   │       ├── configuration/
│   │       │   ├── fleet-config.mdx
│   │       │   ├── agent-config.mdx
│   │       │   ├── permissions.mdx
│   │       │   ├── mcp-servers.mdx
│   │       │   └── environment.mdx
│   │       ├── internals/
│   │       │   └── state.mdx
│   │       └── cli/
│   │           └── reference.mdx             # Placeholder
│   └── env.d.ts                              # Astro type definitions
└── public/
    └── favicon.svg
```

### Key Configuration

**astro.config.mjs:**
```javascript
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  integrations: [
    starlight({
      title: 'herdctl',
      tagline: 'Autonomous Agent Fleet Management for Claude Code',
      social: {
        github: 'https://github.com/edspencer/herdctl',
      },
      sidebar: [
        { label: 'Welcome', link: '/' },
        { label: 'Getting Started', link: '/getting-started/', badge: 'Placeholder' },
        {
          label: 'Concepts',
          collapsed: false,
          items: [
            { label: 'Agents', link: '/concepts/agents/' },
            { label: 'Schedules', link: '/concepts/schedules/' },
            { label: 'Triggers', link: '/concepts/triggers/' },
            { label: 'Jobs', link: '/concepts/jobs/' },
            { label: 'Workspaces', link: '/concepts/workspaces/' },
            { label: 'Sessions', link: '/concepts/sessions/' },
          ],
        },
        {
          label: 'Configuration',
          collapsed: true,
          items: [
            { label: 'Fleet Config', link: '/configuration/fleet-config/' },
            { label: 'Agent Config', link: '/configuration/agent-config/' },
            { label: 'Permissions', link: '/configuration/permissions/' },
            { label: 'MCP Servers', link: '/configuration/mcp-servers/' },
            { label: 'Environment Variables', link: '/configuration/environment/' },
          ],
        },
        {
          label: 'Internals',
          collapsed: true,
          items: [
            { label: 'State Management', link: '/internals/state/' },
          ],
        },
        {
          label: 'CLI',
          collapsed: true,
          items: [
            { label: 'Command Reference', link: '/cli/reference/', badge: 'Placeholder' },
          ],
        },
      ],
      customCss: [],
    }),
  ],
  site: 'https://herdctl.dev',
});
```

**package.json:**
```json
{
  "name": "@herdctl/docs",
  "type": "module",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "astro dev",
    "start": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "astro": "astro"
  },
  "dependencies": {
    "astro": "^4.16.0",
    "@astrojs/starlight": "^0.28.0",
    "sharp": "^0.33.0"
  }
}
```

### Content Guidelines

1. **Extract from SPEC.md**: All concepts and configurations should be extracted from the specification, not invented. Maintain consistency with SPEC.md wording.

2. **Include ASCII Diagrams**: Where SPEC.md has ASCII diagrams, include them in code blocks.

3. **YAML Examples**: Include complete, runnable YAML examples from SPEC.md. Every configuration option should have an example.

4. **Accurate to Implementation**: Configuration reference MUST match the actual Zod schemas in `packages/core/src/config/schema.ts`. Document:
   - Exact field names
   - Actual types
   - Real default values
   - Validation rules

5. **Cross-Reference Links**: Use Starlight's linking to connect related concepts. For example, Agents links to Schedules links to Triggers.

---

## Test Plan

### Manual Testing

For each user story:

1. **Development Server**
   ```bash
   cd docs
   pnpm install
   pnpm dev
   ```
   - Verify page loads correctly
   - Verify navigation works
   - Verify content renders properly

2. **Production Build**
   ```bash
   cd docs
   pnpm build
   pnpm preview
   ```
   - Verify build succeeds with no errors
   - Verify all pages accessible in preview

### Content Verification

- [ ] All 6 concepts from SPEC.md are documented
- [ ] Fleet config reference matches `FleetConfigSchema`
- [ ] Agent config reference matches `AgentConfigSchema`
- [ ] Permission modes match `PermissionModeSchema`
- [ ] MCP server options match `McpServerSchema`
- [ ] State directory structure matches PRD 2 implementation
- [ ] All internal links resolve correctly
- [ ] No broken external links

### Cross-Reference Checklist

Verify these specific details match implementation:

| Documentation | Source File | Fields to Verify |
|---------------|-------------|------------------|
| Fleet Config | `schema.ts:FleetConfigSchema` | version, fleet, defaults, workspace, agents, chat, webhooks, docker |
| Agent Config | `schema.ts:AgentConfigSchema` | name, description, workspace, repo, identity, system_prompt, work_source, schedules, session, permissions, mcp_servers, chat, docker, model, max_turns, permission_mode |
| Permissions | `schema.ts:PermissionsSchema` | mode, allowed_tools, denied_tools, bash |
| Permission Modes | `schema.ts:PermissionModeSchema` | default, acceptEdits, bypassPermissions, plan |
| Schedule Types | `schema.ts:ScheduleTypeSchema` | interval, cron, webhook, chat |
| State Directory | `state/types.ts` | jobs, sessions, logs, stateFile |

---

## Dependencies

- **PRD 1 (herdctl-core-config)**: Complete - provides schemas to document
- **PRD 2 (herdctl-core-state)**: In Progress - provides state structure to document

---

## Out of Scope

- Deployment to Cloudflare Pages (PRD 8)
- Search functionality (configured in Starlight but deployment required)
- Custom CSS theming beyond Starlight defaults
- Interactive examples (future enhancement)
- API documentation (no API yet)
- Video tutorials

---

## Quality Gates

These must pass for every user story:

1. **Build Success**
   ```bash
   cd docs && pnpm build
   ```
   Must complete without errors or warnings.

2. **Local Preview**
   ```bash
   cd docs && pnpm dev
   ```
   Site must render correctly, all navigation works.

3. **Content Accuracy**
   - Concepts match SPEC.md definitions
   - Config references match actual Zod schemas
   - State management matches PRD 2 implementation

4. **No Broken Links**
   - All internal links resolve
   - All cross-references work

---

## Acceptance Criteria Summary

1. `pnpm build` succeeds in `docs/` directory
2. `pnpm dev` starts local server showing documentation site
3. All 6 concepts from SPEC.md (Agents, Schedules, Triggers, Jobs, Workspaces, Sessions) are documented
4. Configuration Reference accurately documents all schemas from `packages/core/src/config/schema.ts`
5. State Management reference documents `.herdctl/` structure
6. Sidebar navigation matches specified structure
7. Getting Started and CLI Reference exist as placeholders
8. Site title is "herdctl", tagline is "Autonomous Agent Fleet Management for Claude Code"
9. No broken internal links
10. ASCII diagrams from SPEC.md are included where relevant