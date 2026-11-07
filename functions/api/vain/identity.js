import { exportBundle, importBundle } from "../../../src/identity_bundle.js";
const json = (x, s = 200, h = {}) => new Response(JSON.stringify(x), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store", ...h } });
export async function onRequestGet({ env }) {
  if (!env.DB) return json({ error: "D1 unavailable" }, 503);
  try { const b = await exportBundle(env.DB); return json(b, 200, { "content-disposition": "attachment; filename=vain-identity.json" }); }
  catch (e) { return json({ error: "Export failed", detail: String(e?.message || e).slice(0, 200) }, 500); }
}
export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: "D1 unavailable" }, 503);
  if (Number(request.headers.get("content-length") || 0) > 1_500_000) return json({ error: "That file is too large." }, 413);
  let b; try { b = await request.json(); } catch { return json({ error: "That isn't valid JSON." }, 400); }
  try { return json({ ok: true, ...(await importBundle(env.DB, b)) }); } catch (e) { return json({ error: e.status ? e.message : "Import failed" }, e.status || 500); }
}
