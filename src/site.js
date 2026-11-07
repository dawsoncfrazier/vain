// Site design proposals (colours, name, tagline). Settings only: no code, no scripts, no external assets.
import { runChat } from "./engine.js";
import { sanitizeSvg } from "./scene.js";
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
  scene_svg: x.scene_svg === "" ? "" : (sanitizeSvg(x.scene_svg) || base.scene_svg || ""),
});
export async function currentSettings(db) { await ensureSiteSchema(db); return Object.fromEntries(((await db.prepare("SELECT key,value FROM site_settings").all()).results || []).map(r => [r.key, r.value])); }
const SCENIC = /\b(background|backdrop|wallpaper|scene|picture|image|art|theme|landscape|sky|stars?|unicorns?|forest|ocean|sea|city|galaxy|space|pattern|mountains?|clouds?|rainbow|aurora)\b/i;
const SCENE_RULES = "Draw ONE SVG scene for the page background, viewBox 0 0 1000 600, soft and low-contrast so white text stays readable. Allowed elements only: svg g defs linearGradient radialGradient stop rect circle ellipse path polygon polyline line filter feGaussianBlur. No text, no images, no links, no scripts, no event attributes. Colours as #rrggbb. Keep it under 6000 characters. Output ONLY the <svg>...</svg>.";
export async function createProposal(env, prompt, opts = {}) {
  prompt = String(prompt || "").trim(); if (prompt.length < 4 || prompt.length > 1200) throw Object.assign(new Error("Describe the website change in 4-1,200 characters."), { status: 400 });
  await ensureSiteSchema(env.DB);
  let base = await currentSettings(env.DB), supersedes = null;
  if (opts.baseId) { const prev = await env.DB.prepare("SELECT id,request,design_json FROM site_proposals WHERE id=? AND status='pending'").bind(Number(opts.baseId)).first(); if (prev) { base = { ...base, ...JSON.parse(prev.design_json) }; supersedes = prev; } }
  const shown = validateDesign(base); delete shown.scene_svg;
  const r = await runChat(env, [{ role: "system", content: "Create a cohesive visual design proposal for the vAIn website. Current settings: " + JSON.stringify(shown) + ". Output ONLY JSON with fields site_name,tagline,accent,background,panel,description. Colors must be six-digit hex. Change only what the request asks for; keep everything else as in the current settings. Preserve legibility and high contrast. Do not generate code, scripts, links, or external assets." }, { role: "user", content: (supersedes ? "Earlier request: " + supersedes.request + "\nAmendment: " : "") + prompt }], { tier: "light", max_tokens: 260, temperature: 0.25 });
  let parsed; try { parsed = JSON.parse(r.text.slice(r.text.indexOf("{"), r.text.lastIndexOf("}") + 1)); } catch (e) { throw Object.assign(new Error("The model did not return a valid design. Try rephrasing."), { status: 502 }); }
  let engine = r.engine, sceneNote = null;
  if (SCENIC.test(prompt) || (supersedes && SCENIC.test(supersedes.request))) {
    try {
      const sc = await runChat(env, [{ role: "system", content: SCENE_RULES }, { role: "user", content: (supersedes ? supersedes.request + " (amended: " + prompt + ")" : prompt) }], { tier: "best", max_tokens: 2500, temperature: 0.7 });
      const svg = sanitizeSvg(sc.text.slice(Math.max(0, sc.text.search(/<svg/i)))); if (svg) { parsed.scene_svg = svg; engine = sc.engine; } else sceneNote = "The drawing the model made didn't pass the safety filter, so only colours changed.";
    } catch (e) { sceneNote = "I couldn't draw a scene right now: " + String(e?.message || e).slice(0, 120); }
  }
  const design = validateDesign(parsed, base), stamp = new Date().toISOString();
  if (supersedes) await env.DB.prepare("UPDATE site_proposals SET status='superseded',decided_at=? WHERE id=?").bind(stamp, supersedes.id).run();
  const ins = await env.DB.prepare("INSERT INTO site_proposals(request,design_json,status,created_at) VALUES(?,?,'pending',?)").bind(prompt, JSON.stringify(design), stamp).run();
  return { id: ins.meta?.last_row_id, request: prompt, design, base: validateDesign(base), status: "pending", created_at: stamp, engine, note: sceneNote };
}
