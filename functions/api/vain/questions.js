import { ensureQuestion, answerQuestion, skipQuestion } from "../../../src/questions.js";
const json = (x, s = 200) => new Response(JSON.stringify(x), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
export async function onRequestGet({ env }) { if (!env.DB) return json({ error: "D1 unavailable" }, 503); try { return json({ question: await ensureQuestion(env) }); } catch (e) { return json({ error: "Questions unavailable", detail: String(e?.message || e).slice(0, 200) }, 500); } }
export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: "D1 unavailable" }, 503);
  let b; try { b = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const id = Number(b.id); if (!Number.isSafeInteger(id) || id < 1) return json({ error: "Valid question id required" }, 400);
  try { if (b.action === "skip") await skipQuestion(env.DB, id); else await answerQuestion(env.DB, id, b.answer); return json({ ok: true }); }
  catch (e) { return json({ error: e.message }, e.status || 500); }
}
