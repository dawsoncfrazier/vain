# vAIn unified chat: deploy

One page, one chat. Panels (memory, research, lab, proposed changes, engines) open beside it when you talk about them.

## Quickest path (Terminal, no dashboard menus)
`./deploy_mac.sh` signs in through Cloudflare's own login (no tokens pasted), creates the tables in your `vain-memory` D1 database, and lists them. `./deploy_mac.sh --direct` also deploys to a new Pages project `vain-unified`.
Do NOT apply PR #3's migration: it uses a different table layout (text ids, `conversations`) that this code does not use.

## Steps
1. Pages project settings: build output directory `public` (already set in wrangler.toml). Keep bindings `AI` (Workers AI) and `DB` (D1 `vain-memory`).
2. Apply `migrations/0001_initial.sql` if not yet applied (other tables are created on first use).
3. **Protect the site with Cloudflare Access before saving personal data** and set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`. The middleware refuses requests (503) when they are missing.
4. Optional variables: `AI_MODELS` / `AI_LIGHT_MODELS` (comma lists, biggest first), `QUESTION_HOURS` (default 1).
5. Optional Mac node: see `bridge/README_BRIDGE.md`.
6. Check `/api/health?deep=1` (runs one real inference) and the Engines panel ("Which engine are you using?").

## Engine order
The page is chat-only: design previews (Accept / Deny / Amend), memory, research, lab data and engine status all appear as bubbles; "open the lab" turns the whole page into a simulation of your words. Background drawings are SVG filtered to a safe subset.

Mac (if online) -> gpt-oss-120b -> llama-3.3-70b -> qwen3-30b -> 8b -> 1b. A failing engine cools down (until UTC midnight for quota-type errors, 60 s for the Mac) and is skipped. Model names and free-tier limits are unverified; adjust `AI_MODELS` to what your account lists.

## Tests
`npm test` (Node 22+: backend with a fake D1/AI/Mac, plus the page) and `python3 test/bridge_test.py`.
These run against fakes, not live Cloudflare.

## Not in this version
Code-level site editing from the cloud chat (needs the Mac studio + GitHub PR flow) and syncing local Mac memory into D1.
