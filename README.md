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

## Deploy

```bash
npm run deploy
```
