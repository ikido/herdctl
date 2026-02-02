# herdctl CLI Manual QA Test Plan

This document provides a comprehensive test plan for manually testing the herdctl CLI. Testers should have herdctl installed and linked globally via `pnpm dev` and `pnpm link`.

## Prerequisites

- Node.js 18+
- herdctl installed globally (`herdctl --version` works)
- A clean directory for testing
- Terminal with color support (for visual tests)

## Quick Reference: Available Commands

| Command | Description |
|---------|-------------|
| `herdctl init` | Initialize a new fleet project |
| `herdctl start` | Start the fleet |
| `herdctl stop` | Stop the fleet |
| `herdctl status [agent]` | Show fleet or agent status |
| `herdctl logs [agent]` | View logs |
| `herdctl trigger <agent>` | Manually trigger an agent |
| `herdctl jobs` | List recent jobs |
| `herdctl job <id>` | Show job details |
| `herdctl cancel <id>` | Cancel a running job |
| `herdctl config validate` | Validate configuration |
| `herdctl config show` | Display resolved configuration |

---

## Part 1: Initialization Tests

### Setup
```bash
mkdir herdctl-qa-test && cd herdctl-qa-test
```

### Test Cases

| # | Test | Command | Expected |
|---|------|---------|----------|
| 1.1 | Init with defaults | `herdctl init -y` | Creates `herdctl.yaml`, `agents/`, `.herdctl/` |
| 1.2 | Init with custom name | `rm -rf * .* 2>/dev/null; herdctl init -n test-fleet -y` | Config has `name: test-fleet` |
| 1.3 | Init simple template | `rm -rf * .* 2>/dev/null; herdctl init -e simple -y` | Creates agent with 5m interval |
| 1.4 | Init quickstart template | `rm -rf * .* 2>/dev/null; herdctl init -e quickstart -y` | Creates hello-agent with 30s interval |
| 1.5 | Init github template | `rm -rf * .* 2>/dev/null; herdctl init -e github -y` | Creates github-agent for issues |
| 1.6 | Init duplicate error | `herdctl init -y` then `herdctl init -y` | Error: "already exists" |
| 1.7 | Init with --force | After init: `herdctl init --force -y` | Overwrites without error |
| 1.8 | Init interactive | `herdctl init` (no flags) | Prompts for name, description, template |
| 1.9 | Gitignore updated | Check `.gitignore` | Contains `.herdctl/` |

**Verification Commands:**
```bash
cat herdctl.yaml           # Check fleet name
ls -la agents/             # Check agents directory
ls -la .herdctl/           # Check state directory
cat .gitignore             # Check gitignore entry
```

---

## Part 2: Configuration Tests

### Test Cases

| # | Test | Command | Expected |
|---|------|---------|----------|
| 2.1 | Validate valid config | `herdctl config validate` | "Configuration is valid" |
| 2.2 | Show config text | `herdctl config show` | Human-readable output |
| 2.3 | Show config JSON | `herdctl config show --json` | Valid JSON |
| 2.4 | Validate with fix hints | `herdctl config validate --fix` | Shows fix suggestions (if errors) |
| 2.5 | Validate bad YAML | Break YAML syntax, validate | Shows line number + error |
| 2.6 | Validate missing field | Remove required field, validate | Shows which field is missing |
| 2.7 | Custom config path | `herdctl config validate -c ./path/to/config` | Uses specified path |

**Break YAML for testing:**
```bash
# Backup then corrupt
cp herdctl.yaml herdctl.yaml.bak
echo "invalid: yaml: syntax:" >> herdctl.yaml
herdctl config validate
# Restore
mv herdctl.yaml.bak herdctl.yaml
```

---

## Part 3: Fleet Lifecycle Tests

### Setup
Use a working configuration (quickstart template recommended for fast cycles):
```bash
rm -rf * .* 2>/dev/null
herdctl init -e quickstart -y
```

### Test Cases

| # | Test | Command | Expected |
|---|------|---------|----------|
| 3.1 | Start fleet | `herdctl start` | Shows status, streams logs |
| 3.2 | Start creates PID file | Check `.herdctl/herdctl.pid` | Contains process ID |
| 3.3 | Graceful shutdown | Press `Ctrl+C` during start | Shuts down within 30s |
| 3.4 | Stop running fleet | Start in background, then `herdctl stop` | Fleet stops, PID file removed |
| 3.5 | Stop with timeout | `herdctl stop -t 5` | Waits max 5 seconds |
| 3.6 | Stop force | `herdctl stop --force` | Immediate SIGKILL |
| 3.7 | Stop not running | `herdctl stop` (no fleet running) | Error: fleet not running |
| 3.8 | Start no config | In empty dir: `herdctl start` | Error: no configuration found |

**Running in background (for stop tests):**
```bash
# Start in background
herdctl start &
FLEET_PID=$!

# Test stop
herdctl stop

# Or test force stop
herdctl stop --force
```

---

## Part 4: Status Tests

### Setup
Start a fleet and let it run:
```bash
herdctl start &
sleep 2
```

### Test Cases

| # | Test | Command | Expected |
|---|------|---------|----------|
| 4.1 | Fleet status overview | `herdctl status` | Shows agents, schedules, job counts |
| 4.2 | Specific agent status | `herdctl status hello-agent` | Shows agent details + schedules |
| 4.3 | Status JSON | `herdctl status --json` | Valid JSON structure |
| 4.4 | Agent status JSON | `herdctl status hello-agent --json` | Valid JSON for agent |
| 4.5 | Status nonexistent agent | `herdctl status fake-agent` | Error: agent not found |
| 4.6 | Status colors | Check terminal output | Green=running, Yellow=idle, Red=error |
| 4.7 | Status NO_COLOR | `NO_COLOR=1 herdctl status` | No ANSI color codes |
| 4.8 | Status uptime | After 2+ minutes | Shows uptime like "2m 30s" |

**JSON validation:**
```bash
herdctl status --json | jq .
herdctl status hello-agent --json | jq .
```

---

## Part 5: Trigger Tests

### Setup
Ensure fleet is running:
```bash
herdctl start &
sleep 2
```

### Test Cases

| # | Test | Command | Expected |
|---|------|---------|----------|
| 5.1 | Trigger agent | `herdctl trigger hello-agent` | Returns job ID, shows output |
| 5.2 | Trigger specific schedule | `herdctl trigger hello-agent -S greet` | Triggers that schedule |
| 5.3 | Trigger custom prompt | `herdctl trigger hello-agent -p "Say hi"` | Uses custom prompt |
| 5.4 | Trigger wait mode | `herdctl trigger hello-agent -w` | Waits for completion, streams output |
| 5.5 | Trigger quiet mode | `herdctl trigger hello-agent -q` | Only shows job info, no output |
| 5.6 | Trigger JSON | `herdctl trigger hello-agent --json` | JSON job info |
| 5.7 | Trigger nonexistent agent | `herdctl trigger fake-agent` | Error: agent not found |
| 5.8 | Trigger bad schedule | `herdctl trigger hello-agent -S fake` | Error: schedule not found |
| 5.9 | Interrupt trigger wait | `herdctl trigger hello-agent -w` then Ctrl+C | Shows "Job continues in background" |

**Note the job ID from triggers for subsequent tests.**

---

## Part 6: Jobs & Logs Tests

### Setup
Trigger several jobs first:
```bash
herdctl trigger hello-agent -q
herdctl trigger hello-agent -q
herdctl trigger hello-agent -q
```

### Jobs List Tests

| # | Test | Command | Expected |
|---|------|---------|----------|
| 6.1 | List all jobs | `herdctl jobs` | Shows last 20 jobs |
| 6.2 | Filter by agent | `herdctl jobs -a hello-agent` | Only that agent's jobs |
| 6.3 | Filter by status | `herdctl jobs -S completed` | Only completed jobs |
| 6.4 | Custom limit | `herdctl jobs -l 5` | Shows max 5 jobs |
| 6.5 | Jobs JSON | `herdctl jobs --json` | Valid JSON array |
| 6.6 | Combined filters | `herdctl jobs -a hello-agent -S completed` | Both filters applied |

### Job Details Tests

| # | Test | Command | Expected |
|---|------|---------|----------|
| 6.7 | Job details | `herdctl job <job-id>` | Complete job info |
| 6.8 | Job with logs | `herdctl job <job-id> --logs` | Shows job output |
| 6.9 | Job JSON | `herdctl job <job-id> --json` | JSON job details |
| 6.10 | Nonexistent job | `herdctl job invalid-id` | Error: job not found |

### Logs Tests

| # | Test | Command | Expected |
|---|------|---------|----------|
| 6.11 | All logs | `herdctl logs` | Last 50 lines from all agents |
| 6.12 | Agent logs | `herdctl logs hello-agent` | Logs from that agent |
| 6.13 | Follow mode | `herdctl logs -f` | Streams continuously (Ctrl+C to stop) |
| 6.14 | Custom line count | `herdctl logs -n 100` | Shows 100 lines |
| 6.15 | Job logs | `herdctl logs --job <job-id>` | Logs from specific job |
| 6.16 | Logs JSON | `herdctl logs --json` | NDJSON format |

---

## Part 7: Cancel Tests

### Setup
Trigger a job and note its ID for cancellation:
```bash
# Trigger without waiting
herdctl trigger hello-agent -q
# Note the job ID from output
```

### Test Cases

| # | Test | Command | Expected |
|---|------|---------|----------|
| 7.1 | Cancel with confirm | `herdctl cancel <job-id>` | Shows confirm prompt |
| 7.2 | Cancel skip confirm | `herdctl cancel <job-id> -y` | Cancels immediately |
| 7.3 | Cancel force | `herdctl cancel <job-id> --force -y` | SIGKILL instead of SIGTERM |
| 7.4 | Cancel JSON | `herdctl cancel <job-id> --json -y` | JSON result |
| 7.5 | Cancel completed job | `herdctl cancel <completed-id>` | Error: not running |
| 7.6 | Cancel nonexistent | `herdctl cancel invalid-id` | Error: job not found |
| 7.7 | Decline cancel | `herdctl cancel <job-id>` then type "n" | Exits without cancelling |

---

## Part 8: Error Handling Tests

| # | Test | Command | Expected |
|---|------|---------|----------|
| 8.1 | No config file | In empty dir: any command | Error: no configuration found |
| 8.2 | Invalid YAML syntax | Corrupt YAML, run command | YAML syntax error with line |
| 8.3 | Missing env var | Use `${UNDEFINED_VAR}` in config | Error: undefined variable |
| 8.4 | Invalid state dir | `herdctl status -s /nonexistent` | Appropriate error |
| 8.5 | Stale PID file | Create fake PID file, run stop | Handles gracefully |

---

## Part 9: Output Format Tests

Run these with various commands to verify consistent formatting:

```bash
# Test NO_COLOR
NO_COLOR=1 herdctl status
NO_COLOR=1 herdctl jobs
NO_COLOR=1 herdctl logs

# Test JSON validity
herdctl status --json | jq .
herdctl jobs --json | jq .
herdctl config show --json | jq .

# Test piped output (should have no colors)
herdctl status | cat
herdctl logs | head -10
```

---

## Part 10: Integration Workflow

Complete this end-to-end workflow:

```bash
# 1. Start fresh
mkdir integration-test && cd integration-test

# 2. Initialize
herdctl init -e quickstart -y

# 3. Validate
herdctl config validate

# 4. Show config
herdctl config show

# 5. Start fleet (background)
herdctl start &
sleep 3

# 6. Check status
herdctl status
herdctl status hello-agent

# 7. Trigger a job
herdctl trigger hello-agent -w

# 8. List jobs
herdctl jobs

# 9. View job details (use ID from step 7)
herdctl job <job-id>
herdctl job <job-id> --logs

# 10. View logs
herdctl logs
herdctl logs -n 20

# 11. Stop fleet
herdctl stop

# 12. Verify stopped
herdctl status  # Should show stopped or error about no running fleet
```

---

## Part 11: Edge Cases & Stress Tests

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 11.1 | Long prompt | `herdctl trigger agent -p "$(python -c 'print("x"*2000)')"` | Handles gracefully |
| 11.2 | Unicode in prompt | `herdctl trigger agent -p "Hello 世界 🌍"` | Displays correctly |
| 11.3 | Special chars | `herdctl trigger agent -p 'Say "hello" & goodbye'` | Properly escaped |
| 11.4 | Many jobs | Trigger 25+ jobs, then `herdctl jobs -l 50` | Pagination works |
| 11.5 | Rapid triggers | Trigger 5 times quickly | Concurrency handled |
| 11.6 | Interrupt follow | `herdctl logs -f` then Ctrl+C | Clean exit |

---

## Cleanup

After testing:
```bash
herdctl stop 2>/dev/null  # Stop if running
cd ..
rm -rf herdctl-qa-test integration-test
```

---

## Test Results Template

| Section | Pass | Fail | Notes |
|---------|------|------|-------|
| 1. Initialization | | | |
| 2. Configuration | | | |
| 3. Fleet Lifecycle | | | |
| 4. Status | | | |
| 5. Trigger | | | |
| 6. Jobs & Logs | | | |
| 7. Cancel | | | |
| 8. Error Handling | | | |
| 9. Output Formats | | | |
| 10. Integration | | | |
| 11. Edge Cases | | | |

**Tested by:** _______________
**Date:** _______________
**herdctl version:** _______________
**Platform:** _______________
