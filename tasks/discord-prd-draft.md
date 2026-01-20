# Discord Bot PRD Prompt Draft

Use this prompt with ralph-tui to generate the Discord Bot PRD.

---

## Prompt

Create a PRD for `herdctl-discord` - a Discord bot connector that allows agents to respond to messages in Discord channels and DMs.

### Context

herdctl is a TypeScript-based system for managing fleets of autonomous Claude Code agents. The core library (`@herdctl/core`) provides FleetManager for orchestration. The Discord connector (`@herdctl/discord`) enables chat-based interaction with agents via Discord.

**Architecture**: The Discord bot is another thin client over FleetManager, similar to CLI. It:
- Connects to Discord via discord.js
- Routes messages to appropriate agents
- Maintains per-channel/per-DM sessions
- Streams Claude responses back to Discord

### Package Location

The package exists at `packages/discord/` (currently empty `.gitkeep`).

### Discord Bot Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Discord Gateway                           │
│                   (discord.js bot)                           │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │ Messages
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                   Message Router                             │
│                                                              │
│  • Check if bot mentioned (group) or DM                     │
│  • Route to appropriate agent based on channel config       │
│  • Maintain channel → session ID mapping                    │
└──────────────────────┬──────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
   ┌─────────┐   ┌─────────┐   ┌─────────┐
   │ Agent A │   │ Agent B │   │ Agent C │
   │Session 1│   │Session 2│   │Session 3│
   └─────────┘   └─────────┘   └─────────┘
```

### User Stories

#### US-1: Discord Bot Setup
**As a** developer setting up herdctl with Discord
**I want** to configure a Discord bot token
**So that** herdctl can connect to my Discord server

**Implementation**:
- Create Discord.js client in `packages/discord/`
- Read bot token from environment variable `DISCORD_BOT_TOKEN`
- Connect to Discord gateway
- Handle connection events (ready, disconnect, error)
- Graceful shutdown on SIGINT/SIGTERM

**Configuration** (fleet config):
```yaml
# herdctl.yaml
discord:
  enabled: true
  token: ${DISCORD_BOT_TOKEN}
```

#### US-2: Message Router
**As a** Discord user
**I want** my messages routed to the correct agent
**So that** I get responses from the appropriate agent for each channel

**Implementation**:
- Create `MessageRouter` class
- Match incoming messages to agent config (guild ID + channel ID)
- Support multiple agents on same server (different channels)
- Ignore messages from bots (including self)
- Log unrouted messages for debugging

**Agent configuration**:
```yaml
# agents/support.yaml
name: support
chat:
  discord:
    guilds:
      - id: "123456789012345678"
        channels:
          - id: "987654321098765432"
            name: "#support"  # Optional, for clarity
            mode: mention
```

#### US-3: Mention Mode (Group Channels)
**As a** Discord server admin
**I want** the bot to only respond when @mentioned
**So that** it doesn't interrupt normal conversations

**Implementation**:
- Check if bot is mentioned in message
- If not mentioned and mode is "mention", ignore
- When mentioned, strip the mention from prompt
- Read recent message history for context (configurable, default 10 messages)
- Respond in the same channel

**Behavior**:
```
User: @herdctl what's the status of issue #123?
Bot: Let me check... [Claude response]
```

#### US-4: Auto Mode (DMs and Dedicated Channels)
**As a** Discord user
**I want** the bot to respond to all my DMs
**So that** I don't have to @mention it every time

**Implementation**:
- DMs default to auto mode
- Channels can be configured as auto mode
- No mention required in auto mode
- Full conversation context maintained

**Configuration**:
```yaml
chat:
  discord:
    guilds:
      - id: "123456789012345678"
        channels:
          - id: "111222333444555666"
            mode: auto  # Respond to all messages
        dm:
          enabled: true
          mode: auto
```

#### US-5: Per-Channel Session Management
**As a** user chatting with an agent
**I want** my conversation context preserved
**So that** the agent remembers what we discussed

**Implementation**:
- Create `SessionManager` class
- Store session ID per channel/DM in state
- Resume existing session when user sends message
- Persist session mappings to `.herdctl/discord-sessions.yaml`
- Handle session expiry gracefully (create new if expired)

**State structure**:
```yaml
# .herdctl/discord-sessions.yaml
sessions:
  "guild:123456789:channel:987654321":
    agentName: support
    sessionId: "session-abc123"
    lastMessageAt: "2024-01-15T10:30:00Z"
  "dm:user:111222333":
    agentName: support
    sessionId: "session-def456"
    lastMessageAt: "2024-01-15T11:00:00Z"
```

#### US-6: Chat Commands
**As a** Discord user
**I want** slash commands to control the bot
**So that** I can reset context or check status

**Commands**:
```
/herdctl help     - Show available commands
/herdctl reset    - Clear conversation context (start fresh session)
/herdctl status   - Show agent status and session info
```

**Implementation**:
- Register slash commands with Discord
- Handle command interactions
- Respond ephemerally (only visible to user) for status/help
- Confirm reset action

#### US-7: Response Streaming
**As a** Discord user
**I want** to see the bot "typing" while it thinks
**So that** I know it's processing my message

**Implementation**:
- Send typing indicator while Claude is processing
- For long responses, edit message incrementally (optional)
- Handle Discord message length limits (2000 chars)
- Split long responses into multiple messages if needed

#### US-8: Error Handling
**As a** Discord user
**I want** friendly error messages
**So that** I know when something goes wrong

**Implementation**:
- Catch and handle common errors
- User-friendly error messages (not stack traces)
- Log detailed errors for debugging
- Retry transient failures (rate limits, network)

**Error responses**:
```
"Sorry, I encountered an error processing your request. Please try again."
"I'm having trouble connecting right now. Please try again in a moment."
```

#### US-9: Documentation
**As a** user setting up Discord integration
**I want** clear documentation
**So that** I can configure everything correctly

**Documentation to create** (`docs/src/content/docs/integrations/discord.mdx`):

1. **Prerequisites**
   - Discord account
   - Discord server with admin permissions

2. **Creating a Discord Application**
   - Go to Discord Developer Portal
   - Create new application
   - Add bot to application
   - Copy bot token

3. **Bot Permissions & Intents**
   - Required intents: Message Content, Guild Messages, Direct Messages
   - Required permissions: Send Messages, Read Message History, View Channels

4. **Inviting the Bot**
   - OAuth2 URL generator
   - Required scopes and permissions
   - Invite link generation

5. **Configuration**
   - Fleet config (token)
   - Agent config (guilds, channels, modes)
   - Environment variables

6. **Getting Discord IDs**
   - Enable Developer Mode
   - Copy server/channel/user IDs

7. **Testing the Integration**
   - Start herdctl
   - Send test message
   - Verify response

8. **Troubleshooting**
   - Common errors and solutions
   - Debug logging

### Package Structure

```
packages/discord/
├── src/
│   ├── index.ts              # Package exports
│   ├── bot.ts                # Discord.js client setup
│   ├── router.ts             # Message routing logic
│   ├── session-manager.ts    # Per-channel session management
│   ├── commands/
│   │   ├── index.ts          # Command registration
│   │   ├── help.ts           # /herdctl help
│   │   ├── reset.ts          # /herdctl reset
│   │   └── status.ts         # /herdctl status
│   ├── handlers/
│   │   ├── message.ts        # Message event handler
│   │   └── interaction.ts    # Slash command handler
│   └── utils/
│       ├── discord.ts        # Discord utilities
│       └── formatting.ts     # Message formatting
├── __tests__/
│   ├── router.test.ts
│   ├── session-manager.test.ts
│   └── commands.test.ts
├── package.json
└── tsconfig.json
```

### Dependencies

```json
{
  "name": "@herdctl/discord",
  "dependencies": {
    "@herdctl/core": "workspace:*",
    "discord.js": "^14"
  },
  "devDependencies": {
    "typescript": "^5",
    "vitest": "^4"
  }
}
```

### Configuration Schema Updates

**Fleet config schema** (add to existing):
```typescript
const DiscordConfigSchema = z.object({
  enabled: z.boolean().default(false),
  token: z.string().optional(), // From env var
});
```

**Agent chat schema** (already exists, verify):
```typescript
const AgentChatDiscordSchema = z.object({
  guilds: z.array(z.object({
    id: z.string(),
    channels: z.array(z.object({
      id: z.string(),
      name: z.string().optional(),
      mode: z.enum(["mention", "auto"]).default("mention"),
    })).optional(),
    dm: z.object({
      enabled: z.boolean().default(true),
      mode: z.enum(["mention", "auto"]).default("auto"),
    }).optional(),
  })),
});
```

### Quality Gates

- `pnpm typecheck` passes
- `pnpm test` passes (mock Discord.js for unit tests)
- Manual testing with real Discord server
- Bot connects and responds to messages
- Session persistence works across restarts
- Slash commands work
- Documentation is complete and accurate
- Documentation builds successfully

### Testing Strategy

**Unit tests** (mocked):
- Message routing logic
- Session manager
- Command handlers

**Integration test** (manual):
- Connect to real Discord server
- Send test messages
- Verify responses
- Test session persistence

### Environment Variables

```bash
DISCORD_BOT_TOKEN=your-bot-token-here
```

### Constraints

- Use discord.js v14 (latest stable)
- Messages limited to 2000 characters (Discord limit)
- Rate limiting handled by discord.js
- Bot token NEVER logged or stored in config files

### Out of Scope

- Voice channel support
- Reactions/emoji responses
- Threads support (future enhancement)
- Multiple bot tokens (one bot per fleet)
- Discord server creation/management

---

## Notes for PRD Generation

- This is a new package, not modifying existing code much
- Focus on clean separation: bot ↔ router ↔ FleetManager
- Session management is key for good UX
- Documentation is critical - users need to set up Discord app
- Error messages should be helpful, not technical
- Consider rate limits and Discord's API constraints
