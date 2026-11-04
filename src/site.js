// Site design proposals (colours, name, tagline). Settings only: no code, no scripts, no external assets.
import { runChat } from "./engine.js";
export async function ensureSiteSchema(db) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS site_proposals(id INTEGER PRIMARY KEY AUTOINCREMENT,request TEXT NOT NULL,design_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL,decided_at TEXT)"),
    db.prepare("CREATE TABLE IF NOT EXISTS site_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL)"),
  ]);
}
const hex = v => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
export const validateDesign = (x, base = {}) => ({
  site_name: String(x.site_name || base.site_name || "vAIn Ϙ").slice(0, 48),
  tagline: String(x.tagline || base.tagline || "Persistent intelligence").slice(0, 100),
  accent: hex(x.accent) ? x.accent : (base.accent || "#a18aff"),
  background: hex(x.background) ? x.background : (base.background || "#080a10"),
  panel: hex(x.panel) ? x.panel : (base.panel || "#111725"),
  description: String(x.description || base.description || "A private research workspace").slice(0, 180),
});
export async function currentSettings(db) { await ensureSiteSchema(db); return Object.fromEntries(((await db.prepare("SELECT key,value FROM site_settings").all()).results || []).map(r => [r.key, r.value])); }
export async function createProposal(env, prompt) {
  prompt = String(prompt || "").trim(); if (prompt.length < 4 || prompt.length > 1200) throw Object.assign(new Error("Describe the website change in 4-1,200 characters."), { status: 400 });
  await ensureSiteSchema(env.DB); const base = await currentSettings(env.DB);
  const r = await runChat(env, [{ role: "system", content: "Create a cohesive visual design proposal for the vAIn website. Current settings: " + JSON.stringify(validateDesign(base)) + ". Output ONLY JSON with fields site_name,tagline,accent,background,panel,description. Colors must be six-digit hex. Change only what the request asks for; keep everything else as in the current settings. Preserve legibility and high contrast. Do not generate code, scripts, links, or external assets." }, { role: "user", content: prompt }], { tier: "light", max_tokens: 260, temperature: 0.25 });
  let parsed; try { parsed = JSON.parse(r.text.slice(r.text.indexOf("{"), r.text.lastIndexOf("}") + 1)); } catch (e) { throw Object.assign(new Error("The model did not return a valid design. Try rephrasing."), { status: 502 }); }
  const design = validateDesign(parsed, base), stamp = new Date().toISOString();
  const ins = await env.DB.prepare("INSERT INTO site_proposals(request,design_json,status,created_at) VALUES(?,?,'pending',?)").bind(prompt, JSON.stringify(design), stamp).run();
  return { id: ins.meta?.last_row_id, request: prompt, design, base: validateDesign(base), status: "pending", created_at: stamp, engine: r.engine };
}
