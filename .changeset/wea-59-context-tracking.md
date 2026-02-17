---
"@herdctl/slack": minor
"@herdctl/core": minor
---

Enhanced !status command with context window tracking and session analytics (WEA-59)

**New Features:**
- **Context Window Tracking**: Real-time token usage monitoring with percentage remaining
- **Enhanced Session State (v3)**: Session start time, message count, and agent configuration snapshots
- **Smart Warnings**: Automatic alerts at 75%, 90%, and 95% context usage thresholds
- **Improved Status Command**: Comprehensive session info including duration, token usage, and configuration

**Changes:**
- Session state files migrated from v2 to v3 format automatically
- Added `updateContextUsage()`, `incrementMessageCount()`, and `setAgentConfig()` to SessionManager
- SlackManager now tracks context usage from SDK assistant messages
- Status command shows detailed breakdown: connection, session, context window, and configuration

**For Users:**
Type `!status` in any Slack channel to see:
- Connection status and uptime
- Session duration and message count
- Context window usage with warnings
- Model, permissions, and MCP servers
- Critical alerts when approaching context limits

**Migration:**
Existing v2 session state files are automatically migrated to v3 on first load. No action required.
