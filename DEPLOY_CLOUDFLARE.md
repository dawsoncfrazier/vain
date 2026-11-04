# vAIn Ϙ — Cloudflare Pages deployment

This repository is configured for Cloudflare Pages Functions with two bindings:

- **Workers AI**: `AI` (configured in `wrangler.toml`)
- **Cloudflare D1**: `DB`, targeting the existing `vain-memory` database (configured in `wrangler.toml`)

## Bindings and migration

1. In Cloudflare Pages, open the vAIn project → **Settings → Bindings**.
2. Confirm a Workers AI binding named exactly `AI`.
3. Confirm a D1 database binding named exactly `DB`, selecting the existing `vain-memory` database.
4. Ensure the production and preview environments have the intended bindings. Save changes and redeploy.
5. Apply the checked-in migration with Wrangler from the repository root:
   `npx wrangler d1 migrations apply vain-memory --remote`
6. Check `/api/health`. It reports binding presence separately from database reachability.

The checked-in migration creates the core tables with `IF NOT EXISTS`; it does not drop or rewrite existing tables. Review the migration output before applying it to a database containing important data.

## Deployment

- Framework preset: **None**
- Build command: leave blank
- Build output directory: `/` (repository root)
- Production branch: `main`

A branch preview can be used to test changes before merging. Do not merge or deploy to production until the configured bindings and migration have been verified.

## Model and cost

The chat endpoint currently uses a small Workers AI model. Model selection should be changed only after checking current availability, account quotas, and pricing. Do not add paid-provider keys to the frontend or commit secrets.

## Security

D1 binding configuration is not an authentication mechanism. Before exposing personal memory or chat history, enforce a verified owner identity (for example, Cloudflare Access JWT validation) on every data endpoint. Never trust an owner ID supplied by the browser.
