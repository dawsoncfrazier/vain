# vAIn Ϙ — Cloudflare Pages deployment

The public interface is a static site with server-side Pages Functions in `functions/api/`.
Chat inference uses the Cloudflare Workers AI binding; no model files or local Ollama process are required for the hosted chat path.

## Deploy (free-tier path)

1. Sign in to Cloudflare and open **Workers & Pages → Create → Pages → Connect to Git**.
2. Select `dawsoncfrazier/vain`, production branch `main`.
3. Framework preset: **None**. Build command: leave blank. Build output directory: `/` (repository root).
4. In the Pages project, open **Settings → Bindings → Add → Workers AI**. Set the variable/binding name to exactly `AI`. Save and redeploy.
5. Open the deployed `*.pages.dev` URL and check `/api/health`. It should return `"ok": true`.
6. Send a test message in the embedded chat. A working response confirms the API and model binding.

The repository includes `wrangler.toml` with the Pages output directory and Workers AI binding declaration. If the dashboard does not pick up the binding from the config, add it in the dashboard as described above.

## Important

- GitHub Pages cannot execute the functions in `functions/api`; deploy this repository to **Cloudflare Pages** for chat to work.
- The Pages URL is the new canonical site. GitHub Pages can remain as a static mirror, but it will not run the chat API.
- Workers AI has free-plan usage limits and may throttle or change availability. This is not unlimited inference.
- The hosted chat is a small cloud model, not the local Qwen 3 8B model. Your local model and SQLite memory are not automatically copied to the cloud.
- Do not put API tokens or secrets in `index.html` or any public repository file.
