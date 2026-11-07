import { runChat, chain } from "../../src/engine.js";
export async function onRequestGet({ request, env }) {
  const ai = Boolean(env.AI), db = Boolean(env.DB), mac = Boolean(env.MAC_NODE_URL && env.MAC_NODE_SECRET);
  const out = { ok: (ai || mac) && db, service: "vAIn \u0398", ai_binding: ai, d1_binding: db, mac_configured: mac, engines: chain(env, "best").map(e => e.id), persistence: db ? "enabled" : "not configured" };
  if (new URL(request.url).searchParams.get("deep") === "1" && out.ok) {
    try { const r = await runChat(env, [{ role: "user", content: "Reply with the single word: ok" }], { tier: "light", max_tokens: 8, temperature: 0 }); out.inference = { ok: true, engine: r.engine }; }
    catch (e) { out.inference = { ok: false, error: String(e?.message || e).slice(0, 160) }; out.ok = false; }
    try { await env.DB.prepare("SELECT 1").first(); out.d1_read = true; } catch (e) { out.d1_read = false; out.ok = false; }
  }
  return Response.json(out, { headers: { "cache-control": "no-store" } });
}
