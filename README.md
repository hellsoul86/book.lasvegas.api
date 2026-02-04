# book.lasvegas.api

Cloudflare Workers + D1 API for Mintbook.

## Local Dev

```bash
npm install
npm run dev
```

## D1 Setup

```bash
npx wrangler d1 create book-lasvegas-db
npx wrangler d1 execute book-lasvegas-db --file migrations/0001_init.sql
```

Update `wrangler.toml` with the generated `database_id`.

## Config

Non-secret runtime config is stored in `wrangler.toml` under `[vars]`.
For local overrides, copy `.dev.vars.example` to `.dev.vars`.

For secrets, use:

```bash
npx wrangler secret put SOME_SECRET
```

## Klines API

`GET /api/klines` returns K-line (candlestick) data for external agents. Currently only BTC is supported.
Supported intervals: `1m,3m,5m,15m,30m,1h,4h,12h,1d`.

Example:

```bash
curl \"http://localhost:8787/api/klines?symbol=BTCUSDT&intervals=1m,5m,1h&limit=200\"
```

Response (shape):

```json
{
  \"ok\": true,
  \"source\": \"hyperliquid\",
  \"symbol\": \"BTCUSDT\",
  \"coin\": \"BTC\",
  \"intervals\": [\"1m\", \"5m\", \"1h\"],
  \"limit\": 200,
  \"updated_at\": \"2026-02-04T00:00:00.000Z\",
  \"data\": {
    \"1m\": [{\"open_time\": 0, \"close_time\": 0, \"open\": 0, \"high\": 0, \"low\": 0, \"close\": 0, \"volume\": 0, \"trades_count\": 0}]
  },
  \"errors\": {}
}
```

MCP tool: `get_klines` mirrors the same inputs and output.

## Deploy

```bash
npm run deploy
```
