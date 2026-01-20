---
title: Schedules
description: Defining when and how agents execute tasks
---

A **Schedule** combines a trigger with a prompt to define when and how an agent executes. Each schedule is a named entry that specifies what event triggers execution and what instructions the agent receives.

## Why Schedules?

Agents need to know:
1. **When** to run (the trigger)
2. **What** to do (the prompt)

A schedule bundles these together. One agent can have multiple schedules for different tasks—checking issues every 5 minutes, generating reports daily, or responding to webhooks.

## Multiple Schedules Per Agent

Agents can have as many schedules as needed. Each schedule operates independently with its own trigger and prompt:

```yaml
# agents/marketing-agent.yaml
name: marketing-agent
description: "Handles analytics, social monitoring, and reports"

schedules:
  hourly-scan:
    type: interval
    interval: 1h
    prompt: |
      Scan social media channels for product mentions.
      Log any notable conversations to mentions.md.

  daily-analytics:
    type: cron
    expression: "0 9 * * *"
    prompt: |
      Analyze yesterday's site traffic and conversion data.
      Update analytics/daily-report.md with findings.

  weekly-report:
    type: cron
    expression: "0 10 * * 1"
    prompt: |
      Generate the weekly marketing summary.
      Include: traffic trends, top content, social engagement.
      Create reports/weekly/{{date}}.md with the full report.
```

This agent runs three independent tasks:
- **hourly-scan**: Checks social media every hour
- **daily-analytics**: Generates analytics report at 9am daily
- **weekly-report**: Creates comprehensive weekly summary on Mondays at 10am

## Schedule Configuration

Schedules are defined as a named map within an agent configuration:

```yaml
schedules:
  schedule-name:
    type: interval | cron | webhook | chat
    interval: "5m"           # For interval triggers
    expression: "0 9 * * *"  # For cron triggers
    prompt: |
      Instructions for what the agent should do.
    work_source:             # Optional: where to get tasks
      type: github
      labels:
        ready: "ready"
        in_progress: "in-progress"
```

### Schedule Properties

| Property | Required | Description |
|----------|----------|-------------|
| `type` | Yes | Trigger type: `interval`, `cron`, `webhook`, or `chat` |
| `interval` | For interval | Duration string like `5m`, `1h`, `30s` |
| `expression` | For cron | Cron expression like `0 9 * * 1-5` |
| `prompt` | No | Instructions for this schedule |
| `work_source` | No | Task source configuration (e.g., GitHub Issues) |

## Trigger Types

### Interval Triggers

Execute at fixed time intervals:

```yaml
schedules:
  check-issues:
    type: interval
    interval: 5m
    prompt: "Check for new issues and triage them."
```

Supported units:
- `s` - seconds (e.g., `30s`)
- `m` - minutes (e.g., `5m`)
- `h` - hours (e.g., `1h`)
- `d` - days (e.g., `1d`)

### Cron Triggers

Execute on a cron schedule for precise timing:

```yaml
schedules:
  morning-standup:
    type: cron
    expression: "0 9 * * 1-5"  # 9am weekdays
    prompt: "Review yesterday's progress and plan today's work."
```

Cron expression format: `minute hour day month weekday`

Common patterns:
- `0 9 * * *` - Daily at 9am
- `0 9 * * 1-5` - Weekdays at 9am
- `0 * * * *` - Every hour
- `0 0 * * 0` - Weekly on Sunday at midnight
- `0 9 1 * *` - Monthly on the 1st at 9am

### Webhook Triggers

Execute when an HTTP request is received:

```yaml
schedules:
  deploy-hook:
    type: webhook
    prompt: |
      A deployment was triggered.
      Run the test suite and report any failures.
```

### Chat Triggers

Execute in response to chat messages:

```yaml
schedules:
  support-response:
    type: chat
    prompt: |
      A user has asked a question in the support channel.
      Provide a helpful response based on the documentation.
```

## Example: Multi-Schedule Agent

Here's a complete example showing an agent with schedules for different purposes:

```yaml
# agents/devops-agent.yaml
name: devops-agent
description: "Monitors infrastructure and handles deployments"

workspace: infrastructure-repo
repo: company/infrastructure

schedules:
  # Quick health checks every 5 minutes
  health-check:
    type: interval
    interval: 5m
    prompt: |
      Run quick health checks on all services.
      Log any issues to monitoring/health.md.

  # Hourly security scan
  security-scan:
    type: cron
    expression: "0 * * * *"
    prompt: |
      Scan for security vulnerabilities in dependencies.
      Update security/scan-results.md with findings.
      Create issues for any critical vulnerabilities.

  # Daily capacity report
  daily-capacity:
    type: cron
    expression: "0 8 * * *"
    prompt: |
      Analyze resource utilization across all environments.
      Generate capacity report in reports/capacity/{{date}}.md.
      Flag any services approaching resource limits.

  # Weekly infrastructure review
  weekly-review:
    type: cron
    expression: "0 10 * * 1"
    prompt: |
      Comprehensive infrastructure review:
      - Resource utilization trends
      - Cost analysis and optimization opportunities
      - Pending maintenance items
      - Security posture summary
      Write report to reports/weekly/{{date}}.md.

  # Deployment webhook
  deploy:
    type: webhook
    prompt: |
      A deployment has been triggered via webhook.
      Validate the deployment and run post-deploy checks.
      Report status to the deployment channel.
```

## Prompts and Work Sources

### Prompt Templates

Prompts can include variables for dynamic content:

```yaml
schedules:
  process-issue:
    type: interval
    interval: 5m
    prompt: |
      Process issue {{issue.number}}: {{issue.title}}

      Description:
      {{issue.body}}

      Implement the requested changes and submit a PR.
```

### Work Source Integration

Schedules can include a work source to pull tasks from external systems:

```yaml
schedules:
  issue-processor:
    type: interval
    interval: 5m
    prompt: "Process the next ready issue."
    work_source:
      type: github
      labels:
        ready: "ready"
        in_progress: "in-progress"
```

When a work source is configured, the schedule will:
1. Check for available work items
2. Claim an item by applying the `in_progress` label
3. Execute with context about the claimed item
4. Mark completion based on work source settings

## Related Concepts

- [Triggers](/concepts/triggers/) - Detailed trigger configuration
- [Agents](/concepts/agents/) - What schedules run
- [Jobs](/concepts/jobs/) - Schedule execution results
