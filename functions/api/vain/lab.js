import { harvest, labState, setStatus, addExample, buildFiles } from "../../../src/lab.js";
const json = (x, s = 200) => new Response(JSON.stringify(x), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ error: "D1 unavailable" }, 503);
  try {
    const which = new URL(request.url).searchParams.get("download");
    if (which) { if (!["train", "valid"].includes(which)) return json({ error: "Unknown file." }, 404); const f = await buildFiles(env.DB); return new Response(f[which], { headers: { "content-type": "application/x-ndjson", "content-disposition": "attachment; filename=" + which + ".jsonl", "cache-control": "no-store" } }); }
    return json(await labState(env.DB));
  } catch (e) { return json({ error: "Lab unavailable", detail: String(e?.message || e).slice(0, 200) }, 500); }
}
export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: "D1 unavailable" }, 503);
  let b; try { b = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  try {
    if (b.action === "harvest") return json({ added: await harvest(env.DB) });
    if (b.action === "mark") { await setStatus(env.DB, Number(b.id), b.status); return json({ ok: true }); }
    if (b.action === "add") { await addExample(env.DB, b.user_text, b.assistant_text); return json({ ok: true }); }
    if (b.action === "build") { const f = await buildFiles(env.DB); return json({ total: f.total, train: f.train_n, valid: f.valid_n }); }
    return json({ error: "Unknown action" }, 400);
  } catch (e) { return json({ error: e.message }, e.status || 500); }
}
