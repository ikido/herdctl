# Price Checker Example

Demonstrates an agent that tracks product prices across multiple retailers by **actually fetching and parsing web pages** - not just calling an API.

## What It Does

- Fetches real product pages from Staples and IKEA
- Extracts prices from HTML using agentic reasoning
- Compares prices across retailers
- Notifies via Discord when price drops below target

## Quick Start

```bash
cd examples/price-checker
export ANTHROPIC_API_KEY="your-key"

# Run price check
herdctl trigger price-checker
```

## Features Demonstrated

- **Real web scraping** - fetches actual retailer pages
- **Agentic reasoning** - extracts prices from different page layouts
- **Conditional notifications** - `when: "metadata.shouldNotify"`
- **Persistent memory** - tracks price history in `context.md`

## Configuration

Edit `agents/price-checker.yaml` to track different products. The key is finding retailers that don't block web requests (Staples and IKEA work).

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `DISCORD_BOT_TOKEN` | For Discord | Bot token |
| `DISCORD_CHANNEL_ID` | For Discord | Channel ID |
