# vAIn Ϙ

A persistent AI research workspace built for Cloudflare Pages, Workers AI, and D1.

## Current capabilities

- Persistent chat history and D1-backed memory.
- Memory entries preserve category and provenance. User statements are labeled as user-reported, not independently verified.
- Direct personal-fact recall is grounded in stored entries; missing graduation or other personal facts must return a clear “no saved record” answer rather than a guess.
- Private API boundary using Cloudflare Access JWT validation.
- Research desk that gathers free public-feed metadata from arXiv, NASA, and Hacker News, then creates a concise briefing and a consequential open question.
- Six-hour scheduled research Worker configuration.
- Website evolution studio: request a visual change, receive a generated preview, and explicitly approve or reject it. Only supported design settings are applied.
- Reviewable project plans and control/evolution status endpoints.

## Required Cloudflare setup

### 1. Pages project bindings

Attach these bindings to the Pages project:

- Workers AI binding: `AI`
- D1 binding: `DB`, database `vain-memory`

Apply `migrations/0001_initial.sql` to the D1 database. Runtime schema checks add newer memory provenance fields and create research/proposal tables as needed.

### 2. Protect private APIs with Cloudflare Access

The website shell can be public, but all `/api/*` endpoints expose private chat, memory, research, and proposal data. Do not use personal data until Access is configured.

In Cloudflare Zero Trust:

1. Create a self-hosted Access application for the Pages hostname and protect the path `/api/*`.
2. Add an allow policy for your own authenticated identity.
3. Copy the application's AUD tag.
4. In Pages project Settings → Variables and Secrets, add:
   - `ACCESS_TEAM_DOMAIN`: your Zero Trust team slug, without `.cloudflareaccess.com`
   - `ACCESS_AUD`: the Access application's AUD tag
5. Redeploy the Pages project.

The API middleware verifies the signed `Cf-Access-Jwt-Assertion` token. It deliberately fails closed with HTTP 503 until both values are configured. Never put an Access secret or service token in browser JavaScript.

### 3. Deploy the scheduled research Worker

Pages Functions do not run scheduled triggers. Deploy the separate Worker configuration to enable background research every six hours:

```sh
npx wrangler deploy --config wrangler.research.toml
```

The Worker uses the same Workers AI and D1 bindings. Verify the deployment and its Cron trigger in the Cloudflare dashboard. Research is also refreshed on workspace entry when the latest briefing is older than six hours. The briefings are stored and shown the next time the workspace is opened; no email or push notification is configured.

## Website editor scope and approval boundary

The current editor supports a generated design proposal for site name, tagline, accent/background/panel colors, and description. It renders a sandboxed preview. A proposal is not applied until the user selects **Approve and apply**; rejection is recorded separately.

This is not yet a general-purpose source-code editor. It does not rewrite arbitrary HTML/JavaScript, commit code to GitHub, or publish a new Pages deployment. A future code-edit workflow must show a complete diff, run tests/build checks, and require a second explicit approval before deployment.

## Evolution and autonomy limits

Research collection and summarization are automated. Project plans are stored as drafts. The system does not autonomously execute shell commands, change model weights, modify its own source code, spend money, or deploy production changes. The evolution dashboard intentionally reports that benchmarks have not yet been measured; create fixed evaluation sets before claiming improvement.

## Deployment safety

Keep the feature branch and preview separate from production until:

- Access protection is configured and verified.
- Pages and Cron Worker deployments succeed.
- Chat, history, memory, proposal preview/approval/rejection, and research refresh are tested while authenticated.
- The no-memory personal-recall case returns “no saved record.”
- The site remains unchanged after rejecting a proposal.
