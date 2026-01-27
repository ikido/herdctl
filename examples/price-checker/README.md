# Price Checker Example

This example demonstrates a **price monitoring agent** that tracks Bitcoin prices and alerts on significant price movements. It showcases:

- **Conditional hook execution** with the `when` field
- **Agent-provided metadata** via `metadata.json`
- **Persistent memory** via `context.md`
- **Discord notifications** triggered only when conditions are met

## Features

- **Cryptocurrency price tracking** - monitors BTC price from CoinGecko
- **Target price alerts** - notifies when price drops below $90,000
- **Persistent memory** via `context.md` - tracks price history across runs
- **Conditional notifications** - Discord alerts only fire when `metadata.shouldNotify` is true
- **Scheduled checks** every hour

## Quick Start

### 1. Clone and Build

```bash
git clone https://github.com/edspencer/herdctl.git
cd herdctl
pnpm install
pnpm build
```

### 2. Set Your API Key

```bash
export ANTHROPIC_API_KEY="sk-ant-your-key-here"
```

### 3. Run the Price Check

```bash
cd examples/price-checker

# Run a price check
../../packages/cli/bin/herdctl.js trigger price-checker
```

### 4. Check the Results

After running, the agent updates:
- `context.md` - price history and current status
- `metadata.json` - structured data for hook conditions

```bash
cat context.md
cat metadata.json
```

## How It Works

1. **Agent reads context.md** to get price history
2. **Fetches current BTC price** from CoinGecko (or WebSearch as backup)
3. **Updates context.md** with new price data
4. **Writes metadata.json** with structured findings
5. **Outputs a text summary** of current price and alert status

## Conditional Notifications

The key feature of this example is **conditional hook execution**:

```yaml
hooks:
  after_run:
    - type: discord
      bot_token_env: DISCORD_BOT_TOKEN
      channel_id: "${DISCORD_CHANNEL_ID}"
      when: "metadata.shouldNotify"  # Only fires when true!
```

The agent writes `metadata.json` with:

```json
{
  "shouldNotify": true,
  "currentPrice": 89500,
  "change24h": -3.2,
  "meetsTarget": true,
  "source": "CoinGecko",
  "notes": "Price below $90k target"
}
```

The Discord hook only executes when `metadata.shouldNotify` is `true`.

## Discord Setup

To receive Discord notifications:

1. Create a Discord bot at https://discord.com/developers/applications
2. Add the bot to your server with "Send Messages" permission
3. Set environment variables:
   ```bash
   export DISCORD_BOT_TOKEN="your-bot-token"
   export DISCORD_CHANNEL_ID="your-channel-id"
   ```

## Customizing

### Different Asset

Edit `agents/price-checker.yaml` system prompt:

```yaml
system_prompt: |
  **Asset**: Ethereum (ETH)
  **Target Price**: $3,000 or lower
  **Sources to Check**:
  - CoinGecko (coingecko.com)
```

### Different Target

Change the target price in the system prompt and update the metadata conditions accordingly.

## Running on a Schedule

To run price checks every hour automatically:

```bash
../../packages/cli/bin/herdctl.js start
```

The schedule is defined in the agent config:

```yaml
schedules:
  check:
    type: interval
    interval: 1h
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `DISCORD_BOT_TOKEN` | For Discord | Discord bot token |
| `DISCORD_CHANNEL_ID` | For Discord | Discord channel ID |

## Why Cryptocurrency?

This example uses Bitcoin because:
- **Reliable data sources** - CoinGecko doesn't block web requests
- **Frequently changing prices** - interesting to monitor
- **No authentication needed** - public price data
- **Good for demonstrating alerts** - volatility triggers notifications

For tracking other products, consider sources that don't block automated requests (check the site's robots.txt and terms of service).
