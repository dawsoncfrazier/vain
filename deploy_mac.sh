#!/usr/bin/env bash
# vAIn: sign in to Cloudflare through its official login (a browser window opens), create the tables in your
# D1 database, and optionally deploy this build. You never paste a token anywhere.
#
#   ./deploy_mac.sh            sign in + create/refresh the tables (safe to repeat; never deletes data)
#   ./deploy_mac.sh --direct   ...and also deploy this folder as a NEW Pages project called vain-unified
#                              (your current vain-byr site is not touched)
set -euo pipefail
cd "$(dirname "$0")"
DB="vain-memory"; PROJECT="${VAIN_PAGES_PROJECT:-vain-unified}"
command -v node >/dev/null || { echo "Node.js is missing. Install it from https://nodejs.org (the LTS button), then run this again."; exit 1; }
W="npx --yes wrangler@4"

echo "1/3  Signing in to Cloudflare (a browser window will open; click Allow)..."
if $W whoami 2>&1 | grep -qi "not authenticated"; then $W login; fi
$W whoami

echo; echo "2/3  Creating/refreshing tables in the D1 database '$DB' (existing rows are kept)..."
$W d1 execute "$DB" --remote --file=migrations/0001_initial.sql
$W d1 execute "$DB" --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"

if [ "${1:-}" = "--direct" ]; then
  echo; echo "3/3  Deploying to the Pages project '$PROJECT' (it will offer to create it)..."
  $W pages deploy public --project-name "$PROJECT" --branch main
  echo; echo "Done. Open the https://$PROJECT.pages.dev address printed above."
  echo "If it says 'Private API is not configured', the Cloudflare Access settings are still needed (see DEPLOY_UNIFIED.md)."
else
  echo; echo "3/3  Skipped deploy (run again with --direct, or push the branch to GitHub so vain-byr builds it)."
fi
