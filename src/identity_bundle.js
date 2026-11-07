// Portable identity: memories, look, and approved training examples in one checksummed file.
// The point is vessel independence: any compatible vAIn (another model, device or account) can restore it.
import { IDENTITY } from "./identity.js";
import { ensureSiteSchema, validateDesign, currentSettings } from "./site.js";
import { ensureLabSchema, addExample } from "./lab.js";
export const FORMAT = "vain-identity/1";
const KEYS = ["site_name", "tagline", "accent", "background", "panel", "description", "font", "density", "motion", "bubble", "scene_svg"];
const CATS = new Set(["personal_fact", "project_fact", "preference", "instruction", "note", "conversation_event"]);
const hex = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map(x => x.toString(16).padStart(2, "0")).join("");

export async function exportBundle(db) {
  await ensureSiteSchema(db); await ensureLabSchema(db);
  const settings = await currentSettings(db);
  const design = validateDesign(Object.fromEntries(KEYS.filter(k => settings[k] !== undefined).map(k => [k, settings[k]])));
  const memories = ((await db.prepare("SELECT text,category,source,created_at FROM memory_entries ORDER BY id").all()).results || []);
  const lab = ((await db.prepare("SELECT user_text,assistant_text FROM lab_examples WHERE status='approved' ORDER BY id").all()).results || []);
  const body = { format: FORMAT, exported_at: new Date().toISOString(), identity: IDENTITY, design, memories, lab_examples: lab };
  return { ...body, checksum: await hex(JSON.stringify(body)) };
}

export async function importBundle(db, bundle) {
  const bad = (m) => Object.assign(new Error(m), { status: 400 });
  if (!bundle || bundle.format !== FORMAT) throw bad("That isn't a vAIn identity file.");
  const { checksum, ...body } = bundle;
  if (checksum !== await hex(JSON.stringify(body))) throw bad("The file's checksum doesn't match, so it was changed or damaged. Nothing was imported.");
  if (!Array.isArray(body.memories) || body.memories.length > 2000 || !Array.isArray(body.lab_examples) || body.lab_examples.length > 2000) throw bad("The file is too large or malformed.");
  await ensureSiteSchema(db); await ensureLabSchema(db);
  const have = new Set(((await db.prepare("SELECT text FROM memory_entries").all()).results || []).map(r => r.text));
  let memories = 0, examples = 0; const stamp = new Date().toISOString();
  for (const m of body.memories) {
    const text = typeof m.text === "string" ? m.text.trim() : ""; if (text.length < 2 || text.length > 3000 || have.has(text)) continue;
    await db.prepare("INSERT INTO memory_entries(text,category,source,created_at) VALUES(?,?,?,?)").bind(text, CATS.has(m.category) ? m.category : "note", "import", typeof m.created_at === "string" ? m.created_at.slice(0, 30) : stamp).run(); have.add(text); memories++;
  }
  for (const e of body.lab_examples) { try { await addExample(db, e.user_text, e.assistant_text); examples++; } catch (x) { /* duplicate or invalid */ } }
  const design = validateDesign(body.design || {});
  for (const k of KEYS) await db.prepare("INSERT INTO site_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(k, String(design[k] ?? ""), stamp).run();
  return { memories, examples, design: true };
}
