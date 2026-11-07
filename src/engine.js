// Engine router: tries the owner's Mac first (largest local model), then hosted open models from biggest to smallest.
// Failures put an engine on cooldown (until the next UTC midnight for quota-like errors) so later requests skip it.
export const DEFAULT_BEST = [
  "@cf/openai/gpt-oss-120b",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/qwen/qwen3-30b-a3b-fp8",
  "@cf/meta/llama-3.1-8b-instruct-fp8",
  "@cf/meta/llama-3.2-1b-instruct",
];
export const DEFAULT_LIGHT = ["@cf/meta/llama-3.1-8b-instruct-fp8", "@cf/meta/llama-3.2-3b-instruct", "@cf/meta/llama-3.2-1b-instruct"];
const QUOTA = /neuron|quota|rate.?limit|too many|5035|not available on the workers free|\b(402|403|429)\b|capacity/i;

const list = (v, dflt) => (typeof v === "string" && v.trim() ? v.split(",").map(s => s.trim()).filter(Boolean) : dflt);
export function chain(env, tier = "best") {
  const out = [];
  if (tier === "best" && env.MAC_NODE_URL && env.MAC_NODE_SECRET) out.push({ id: "mac", kind: "mac" });
  const models = tier === "light" ? list(env.AI_LIGHT_MODELS, DEFAULT_LIGHT) : list(env.AI_MODELS, DEFAULT_BEST);
  if (env.AI) for (const m of models) out.push({ id: m, kind: "ai" });
  return out;
}

export function extractText(r) {
  let t = "";
  if (typeof r === "string") t = r;
  else if (r) {
    const x = r.response ?? r.result?.response ?? r.choices?.[0]?.message?.content ?? r.choices?.[0]?.text ?? r.output_text ?? r.text ?? "";
    t = typeof x === "string" ? x : (x == null ? "" : JSON.stringify(x));
  }
  return t.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*<\/think>/i, "").trim();
}

export async function ensureEngineSchema(db) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS engine_state(engine TEXT PRIMARY KEY, until TEXT, last_error TEXT, updated_at TEXT)"),
    db.prepare("CREATE TABLE IF NOT EXISTS engine_log(day TEXT NOT NULL, engine TEXT NOT NULL, ok INTEGER NOT NULL DEFAULT 0, fail INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(day, engine))"),
  ]);
}
const nextUtcMidnight = () => { const d = new Date(); d.setUTCHours(24, 0, 0, 0); return d.toISOString(); };
const withTimeout = (p, ms, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(label + " timed out")), ms))]);

async function callEngine(env, eng, messages, o) {
  if (eng.kind === "mac") {
    const headers = { "content-type": "application/json", authorization: "Bearer " + env.MAC_NODE_SECRET };
    if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
      headers["CF-Access-Client-Id"] = env.CF_ACCESS_CLIENT_ID; headers["CF-Access-Client-Secret"] = env.CF_ACCESS_CLIENT_SECRET;
    }
    const r = await fetch(env.MAC_NODE_URL.replace(/\/$/, "") + "/node/chat", {
      method: "POST", headers, signal: AbortSignal.timeout(Number(env.MAC_TIMEOUT_MS) || 90000),
      body: JSON.stringify({ messages, max_tokens: o.max_tokens, temperature: o.temperature, no_think: true }),
    });
    if (!r.ok) throw new Error("mac node HTTP " + r.status);
    const j = await r.json(); const t = extractText(j); if (!t) throw new Error("mac node returned nothing"); return { text: t, model: j.model || "mac" };
  }
  const res = await withTimeout(env.AI.run(eng.id, { messages, max_tokens: o.max_tokens, temperature: o.temperature }), Number(env.AI_TIMEOUT_MS) || 60000, eng.id);
  const t = extractText(res); if (!t) throw new Error("empty response"); return { text: t, model: eng.id };
}

export async function runChat(env, messages, opts = {}) {
  const o = { max_tokens: 700, temperature: 0.35, tier: "best", ...opts };
  const engines = chain(env, o.tier);
  if (!engines.length) throw Object.assign(new Error("No engines are configured (bind Workers AI as AI, or set MAC_NODE_URL and MAC_NODE_SECRET)."), { tried: [] });
  const db = env.DB; const now = new Date().toISOString(); const day = now.slice(0, 10); const tried = [];
  let state = {};
  if (db) { await ensureEngineSchema(db); const r = await db.prepare("SELECT engine, until, last_error FROM engine_state").all(); for (const x of r.results || []) state[x.engine] = x; }
  for (const eng of engines) {
    const st = state[eng.id];
    if (st && st.until && st.until > now) { tried.push({ engine: eng.id, skipped: "cooldown until " + st.until }); continue; }
    try {
      const out = await callEngine(env, eng, messages, o);
      if (db) {
        await db.prepare("INSERT INTO engine_log(day,engine,ok,fail) VALUES(?,?,1,0) ON CONFLICT(day,engine) DO UPDATE SET ok=ok+1").bind(day, eng.id).run();
        if (st) await db.prepare("DELETE FROM engine_state WHERE engine=?").bind(eng.id).run();
      }
      return { text: out.text, engine: eng.id, model: out.model, tried };
    } catch (e) {
      const msg = String(e?.message || e).slice(0, 200);
      const until = eng.kind === "mac" ? new Date(Date.now() + 60000).toISOString() : (QUOTA.test(msg) ? nextUtcMidnight() : new Date(Date.now() + 300000).toISOString());
      tried.push({ engine: eng.id, error: msg });
      if (db) {
        await db.prepare("INSERT INTO engine_state(engine,until,last_error,updated_at) VALUES(?,?,?,?) ON CONFLICT(engine) DO UPDATE SET until=excluded.until,last_error=excluded.last_error,updated_at=excluded.updated_at").bind(eng.id, until, msg, now).run();
        await db.prepare("INSERT INTO engine_log(day,engine,ok,fail) VALUES(?,?,0,1) ON CONFLICT(day,engine) DO UPDATE SET fail=fail+1").bind(day, eng.id).run();
      }
    }
  }
  throw Object.assign(new Error("Every engine failed or is cooling down."), { tried });
}

export async function engineStatus(env) {
  const out = { chain: [], mac: null, day: new Date().toISOString().slice(0, 10) };
  const db = env.DB; let state = {}, log = {};
  if (db) {
    await ensureEngineSchema(db);
    for (const x of (await db.prepare("SELECT engine, until, last_error FROM engine_state").all()).results || []) state[x.engine] = x;
    for (const x of (await db.prepare("SELECT engine, ok, fail FROM engine_log WHERE day=?").bind(out.day).all()).results || []) log[x.engine] = x;
  }
  const now = new Date().toISOString();
  for (const e of chain(env, "best")) {
    const st = state[e.id];
    out.chain.push({ id: e.id, kind: e.kind, cooling: !!(st && st.until > now), until: st?.until || null, last_error: st?.last_error || null, ok_today: log[e.id]?.ok || 0, fail_today: log[e.id]?.fail || 0 });
  }
  if (env.MAC_NODE_URL && env.MAC_NODE_SECRET) {
    try {
      const h = {}; if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) { h["CF-Access-Client-Id"] = env.CF_ACCESS_CLIENT_ID; h["CF-Access-Client-Secret"] = env.CF_ACCESS_CLIENT_SECRET; }
      const r = await fetch(env.MAC_NODE_URL.replace(/\/$/, "") + "/node/health", { headers: { authorization: "Bearer " + env.MAC_NODE_SECRET, ...h }, signal: AbortSignal.timeout(5000) });
      out.mac = r.ok ? { online: true, ...(await r.json()) } : { online: false, error: "HTTP " + r.status };
    } catch (e) { out.mac = { online: false, error: String(e?.message || e).slice(0, 120) }; }
  } else out.mac = { online: false, error: "not configured" };
  return out;
}
