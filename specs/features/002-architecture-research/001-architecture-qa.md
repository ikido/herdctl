# Architecture Q&A: herdctl Connectors, Scheduling, and Agent Management

## 1. Discord vs Slack Connector Differences

| Aspect | Discord | Slack |
|--------|---------|-------|
| **Connector model** | One connector **per agent** | **Single** connector for all agents |
| **Session key** | `channelId` (one session per channel/DM) | `threadTs` (one session per Slack thread) |
| **Routing** | Agent owns specific channels via config | `channelAgentMap` routes channel → agent |
| **Processing indicator** | Discord typing indicator | Hourglass emoji reaction |
| **Thread model** | Not first-class — entire channel = one conversation | Threads are first-class — each thread = separate conversation |
| **Response limits** | 2000 char split (Discord limit) | Similar chunking via StreamingResponder |
| **Library** | `discord.js` v14 (Gateway/WebSocket) | `@slack/bolt` (Socket Mode) |

The Slack connector is architecturally more flexible for multi-agent workspaces since one Bolt app serves all agents, while Discord needs N gateway connections.

## 2. File Sending from Agents (Discord)

**Not currently implemented.** The Discord connector handles text responses via `StreamingResponder` but has no file attachment support. Discord.js supports it natively via `AttachmentBuilder`, so it would need:

1. A mechanism for the agent (Claude Code) to signal "send this file" — e.g., a tool or hook
2. The connector to pick up that signal and call `channel.send({ files: [{ attachment: filePath, name: 'output.pdf' }] })`

For the `/pdf` skill to work, you'd need a **file output hook** — something like:
- Agent writes file to a known path (e.g., `.herdctl/outputs/`)
- A post-execution hook or file watcher picks it up and sends it to the originating channel/thread
- Or: a new "send_file" event that the connector listens for

## 3. Scheduling and Heartbeat

The scheduler is a **polling loop** running in the main Node.js process:

```
while (!aborted) {
  for each agent → for each schedule:
    - check if due (interval like "5m" or cron like "*/1 * * * *")
    - if due → trigger job execution
  sleep(checkInterval)  // default 1s
```

**For Linear integration**, you'd configure something like:

```yaml
agents:
  - name: linear-agent
    schedules:
      - name: check-linear
        type: interval
        interval: "1m"
        prompt: "Check Linear for new issues assigned to you, new comments, and status changes. Process any actionable items."
```

State is persisted in `.herdctl/schedules/<agent>/<schedule>.yaml` so it survives restarts and tracks `last_run_at` / `next_run_at`.

## 4. Webhook-Triggered Agents

**Inbound webhooks are NOT implemented.** The current webhook support is **outbound only** (post-execution notifications). There's no HTTP server listening for incoming events.

To add webhook routing (e.g. for Linear), you'd need:

1. **An HTTP server** in herdctl that receives webhook events
2. **Event routing logic** — map events to agents/sessions
3. **Session resolution** — map external IDs (e.g., Linear issue ID) → herdctl session ID

The `FleetManager` and `JobExecutor` already support triggering jobs with session resume — the missing piece is the inbound HTTP endpoint and the routing logic.

## 5. Agent Git Push — Authentication

Agents run as child processes (or Docker containers) and inherit the environment. For git push:

**Native mode:**
- If the host has SSH keys or git credential helpers configured, the agent inherits them
- Set `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL` in the agent's env config

**Docker mode:**
- Mount SSH keys: `volumes: ["~/.ssh:/home/user/.ssh:ro"]`
- Or use HTTPS with a token: `env: { GH_TOKEN: "${GH_TOKEN}" }` and configure git to use it

```yaml
agents:
  - name: coder
    env:
      GH_TOKEN: "${GH_TOKEN}"
      GIT_AUTHOR_NAME: "herdctl-agent"
      GIT_AUTHOR_EMAIL: "agent@example.com"
    docker:
      volumes:
        - "${HOME}/.gitconfig:/home/user/.gitconfig:ro"
```

## 6. Worktree-Based Linear Workflow

**Git worktree support is NOT built.** The ideal flow would be:

```
1. Agent picks up Linear issue LIN-123
2. herdctl creates worktree: git worktree add .worktrees/lin-123 -b lin-123
3. Agent's working_directory is set to .worktrees/lin-123
4. Agent works, commits, pushes
5. Agent creates PR (via gh cli)
6. On completion: merge PR, clean up worktree
```

**What exists today:** You can set `working_directory` per agent, but it's static. No dynamic worktree creation per job/issue.

## 7. Memory, Subagents, and Context Handoff

| Feature | Status |
|---------|--------|
| Session resume | **Works** — Claude Code sessions persist conversation history |
| Subagent spawning | Handled by Claude Code internally (Task tool) — herdctl doesn't manage this |
| Cross-agent memory | **Not implemented** |
| Context window monitoring | **Not implemented** |
| Automatic handoff | **Not implemented** |

The "context reaches 10%, do /handoff, start new session" flow would require:

1. **Context monitoring** — Watch the Claude API's token usage from SDK messages
2. **Handoff trigger** — When threshold hit, inject a "create handoff document" prompt
3. **Session rotation** — Start a fresh session, feeding the handoff doc as the initial prompt
4. **Worktree continuity** — New session picks up same worktree/branch

## Summary: What Exists vs What Needs Building

| Capability | Status |
|-----------|--------|
| Scheduled polling (for Linear) | **Works** — interval/cron schedules |
| Chat-triggered jobs (Slack/Discord) | **Works** |
| Session resume across jobs | **Works** |
| Inbound webhooks (Linear events) | **Needs building** |
| File sending to channels | **Needs building** |
| Git worktree per job/issue | **Needs building** |
| Context window monitoring + handoff | **Needs building** |
| Agent self-merge workflow | **Partially works** — agent can do it via tools, but no orchestration |
| Git auth for agents | **Works** — via env/volume config |
