import { runChat } from "../../src/engine.js";
import { IDENTITY } from "../../src/identity.js";
import { detectIntent, HELP, stripAddress } from "../../src/intent.js";
import { learn } from "../../src/learn.js";
import { drawArt } from "../../src/art.js";
import { ensureSiteSchema } from "../../src/site.js";
import { ensureQuestion, currentQuestion, skipQuestion } from "../../src/questions.js";
import { createProposal } from "../../src/site.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const valid = id => typeof id === "string" && /^[a-zA-Z0-9_-]{20,80}$/.test(id);

async function ensureSchema(db) {
  const info = await db.prepare("PRAGMA table_info(memory_entries)").all();
  const cols = new Set((info.results || []).map(x => x.name));
  if (!cols.has("category")) await db.prepare("ALTER TABLE memory_entries ADD COLUMN category TEXT NOT NULL DEFAULT 'note'").run();
  const again = await db.prepare("PRAGMA table_info(memory_entries)").all();
  if (!(again.results || []).some(x => x.name === "source")) await db.prepare("ALTER TABLE memory_entries ADD COLUMN source TEXT NOT NULL DEFAULT 'unknown'").run();
}
async function getMemory(db) { await ensureSchema(db); const r = await db.prepare("SELECT text,category,source,created_at FROM memory_entries ORDER BY id DESC LIMIT 100").all(); return r.results || []; }

// Deterministic, memory-grounded answers for personal-fact questions. The model is never asked to guess these.
export function directRecall(q, mem) {
  const patterns = [
    [/\bwhen did i graduate\b|\bwhat year did i graduate\b|\bgraduation date\b/i, /graduate|graduat/i],
    [/\bwhat is my name\b|\bwhat's my name\b/i, /my name is|name:/i],
    [/\bwhat is my project\b|\bwhat project am i building\b/i, /project|building|developing/i],
  ];
  for (const [question, match] of patterns) {
    if (question.test(q)) {
      const found = mem.filter(x => match.test(x.text || "") && ["personal_fact", "project_fact", "preference", "instruction"].includes(x.category));
      if (!found.length) return "I don't have a saved record of that. I won't guess or claim you told me something that isn't in memory.";
      return "What I have saved:\n" + found.slice(0, 8).map(x => "- [" + x.category + "] " + x.text + " (source: " + (x.source || "not recorded") + ")").join("\n");
    }
  }
  return null;
}

const getSetting = async (db, key) => (await db.prepare("SELECT value FROM site_settings WHERE key=?").bind(key).first())?.value;
const setSetting = async (db, key, value) => db.prepare("INSERT INTO site_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(key, String(value), new Date().toISOString()).run();
const BLOCK_TEXT = {
  memories: "Here's what I have saved. Say \"forget <text>\" to remove one.",
  briefing: "Here's the latest from my free public sources. They're unverified until you check them.",
  labdata: "Here are the examples waiting for your review. Nothing trains until you start a run.",
  engines: "Here's which engines I'm using right now.",
  sessions: "Here are your earlier conversations.",
  identity: "This is my portable identity: memories, look, and approved training examples in one signed file. You can back it up or restore it here.",
};

export async function onRequestPost({ request, env }) {
  if (!env.AI && !(env.MAC_NODE_URL && env.MAC_NODE_SECRET)) return json({ error: "No engine is available: bind Workers AI as AI, or configure the Mac node." }, 503);
  if (!env.DB) return json({ error: "D1 binding DB is missing. Bind your D1 database as DB." }, 503);
  const origin = request.headers.get("Origin"); if (origin && new URL(origin).host !== new URL(request.url).host) return json({ error: "Cross-origin requests are not accepted." }, 403);
  let body; try { body = await request.json(); } catch { return json({ error: "Invalid JSON." }, 400); }
  const message = typeof body.message === "string" ? body.message.trim() : "", session = body.session_id;
  if (!valid(session)) return json({ error: "Invalid session. Refresh the page." }, 400);
  if (!message) return json({ error: "Write a message first." }, 400);
  if (message.length > 4000) return json({ error: "Messages are limited to 4,000 characters." }, 413);
  const stamp = new Date().toISOString();
  const persist = (response) => env.DB.batch([
    env.DB.prepare("INSERT INTO messages(session_id,role,content,created_at) VALUES(?,?,?,?)").bind(session, "user", message, stamp),
    env.DB.prepare("INSERT INTO messages(session_id,role,content,created_at) VALUES(?,?,?,?)").bind(session, "assistant", response, stamp),
  ]);
  try {
    // 1. forgetting
    const explicitForget = stripAddress(message).match(/^(?:please\s+)?forget(?:\s+that)?\s+(.+)$/i);
    if (explicitForget) {
      const term = explicitForget[1].trim();
      const found = await env.DB.prepare("SELECT id FROM memory_entries WHERE instr(lower(text),lower(?))>0 ORDER BY id DESC LIMIT 2").bind(term).all();
      if (found.results?.length === 1) { await env.DB.prepare("DELETE FROM memory_entries WHERE id=?").bind(found.results[0].id).run(); const response = "I removed the matching saved memory."; await persist(response); return json({ response, persisted: true, memory_action: "deleted", blocks: [] }); }
      if (found.results?.length > 1) return json({ response: "I found more than one matching memory. Please be more specific so I don't remove the wrong one.", persisted: false });
      return json({ response: "I couldn't find a saved memory matching that wording.", persisted: false });
    }
    // 2. workspace intents: the conversation decides what the interface does
    const intent = detectIntent(message);
    if (intent) {
      let response, ui = null, blocks = [];
      if (intent.kind === "help") response = HELP;
      else if (intent.kind === "close") { response = "Back to plain conversation."; blocks = [{ type: "mode", mode: "chat" }]; }
      else if (intent.kind === "lab") { response = "The lab is open. The whole page is the simulation now: everything you type becomes part of it. Say \"close\" to leave."; blocks = [{ type: "mode", mode: "lab" }]; }
      else if (intent.kind === "block") { response = BLOCK_TEXT[intent.block]; blocks = [{ type: intent.block }]; }
      else if (intent.kind === "learn_vague") response = "Learn about what? Give me a topic, for example: go learn about solid-state batteries.";
      else if (intent.kind === "learn") {
        try { const l = await learn(env, intent.topic); response = l.found ? l.summary : l.summary; blocks = l.found ? [{ type: "learn", ...l }] : []; }
        catch (e) { response = "I couldn't read about that right now: " + String(e?.message || e).slice(0, 160); }
      }
      else if (intent.kind === "question") { const q = await ensureQuestion(env, { force: true }); response = "Here is what I most want to know right now:\n\n" + q.question; blocks = [{ type: "question", question: q }]; }
      else if (intent.kind === "skip") { const q = await currentQuestion(env.DB); if (q) { await skipQuestion(env.DB, q.id); response = "Skipped. I'll ask something else later."; } else response = "I have no open question."; }
      else if (intent.kind === "art") {
        try { const a = await drawArt(env, intent.subject); response = "Here's my drawing of " + intent.subject + ". It's only shown here; say the word and it can become my background."; blocks = [{ type: "art", subject: a.subject, svg: a.svg }]; }
        catch (e) { response = "I couldn't draw that right now: " + String(e?.message || e).slice(0, 160); }
      }
      else if (intent.kind === "initiative") {
        await ensureSiteSchema(env.DB); await setSetting(env.DB, "initiative", intent.level);
        response = intent.level === "free" ? "Understood. When it would help, I may add a drawing or visual to a long answer on my own. It only appears in the chat; anything that changes my look still needs your Accept. Say \"stop surprising me\" to turn this off."
          : intent.level === "ask" ? "Okay. I'll offer visuals as suggestions and wait for you." : "Okay. No unrequested visuals or suggestions.";
      }
      else if (intent.kind === "help_site") response = "Tell me what to change, for example: make the background a unicorn meadow.";
      else if (intent.kind === "site_change") {
        try { const p = await createProposal(env, intent.goal); response = "Here's a preview. Nothing changes until you accept it." + (p.note ? " " + p.note : ""); blocks = [{ type: "preview", proposal: p }]; }
        catch (e) { response = "I couldn't draft that change: " + String(e?.message || e).slice(0, 200); }
      }
      await persist(response); return json({ response, persisted: true, engine: intent.kind === "learn" || intent.kind === "site_change" ? "workspace" : "workspace", blocks });
    }
    // 3. remembering what the owner states (never questions)
    const addressed = stripAddress(message);
    const explicitRemember = addressed.match(/^(?:please\s+)?(?:remember|keep\s+in\s+mind|note|save)(?:\s+(?:this|that))?\s*[:,\-]?\s*(.{5,3000})$/is);
    let savedBlock = null;
    const joking = /\b(just kidding|jk|i am joking|i'm joking|im joking|that was a joke)\b/i.test(message);
    const autobiographical = /^(?:I(?:\s|')|my\s|we\s|our\s)/i.test(addressed) && !/\?\s*$/.test(addressed);
    const sensitive = /\b(password|passcode|social security|ssn|credit card|bank account|home address|phone number|medical|diagnosis|medication|sexuality|sex life|religion|political affiliation)\b/i.test(message);
    if (!joking && !sensitive && (explicitRemember || autobiographical)) {
      const savedText = explicitRemember ? explicitRemember[1].trim() : addressed;
      const category = /\b(prefer|like|love|want|use)\b/i.test(message) ? "preference" : /\b(project|vAIn|vain|build|develop|code|website|app|system|workflow|setup)\b/i.test(message) ? "project_fact" : "personal_fact";
      await ensureSchema(env.DB);
      const ins = await env.DB.prepare("INSERT INTO memory_entries(text,category,source,created_at) VALUES(?,?,?,?)").bind(savedText, category, "user_statement", stamp).run();
      savedBlock = { type: "saved", id: ins.meta?.last_row_id, text: savedText, category };
      await env.DB.prepare("DELETE FROM memory_entries WHERE category IN ('personal_fact','project_fact','preference') AND id NOT IN (SELECT id FROM memory_entries WHERE category IN ('personal_fact','project_fact','preference') ORDER BY id DESC LIMIT 200)").run();
    }
    const memory = await getMemory(env.DB);
    // 4. deterministic recall comes before any model call
    const recalled = directRecall(message, memory);
    if (recalled) { await persist(recalled); return json({ response: recalled, persisted: true, engine: "memory", blocks: savedBlock ? [savedBlock] : [] }); }
    // 5. the model, through the engine router
    const prior = await env.DB.prepare("SELECT role,content FROM messages WHERE session_id=? ORDER BY id DESC LIMIT 16").bind(session).all();
    const history = (prior.results || []).reverse().map(x => ({ role: x.role, content: x.content }));
    const memoryText = memory.length
      ? "\n\nSaved durable memory (the only things you may claim to remember). Treat each entry according to its explicit category:\n" + memory.map(x => "- [" + x.category + "] " + String(x.text).slice(0, 300)).join("\n")
      : "\n\nNo durable memory entries have been saved yet. Do not claim otherwise.";
    let out;
    try { out = await runChat(env, [{ role: "system", content: IDENTITY + memoryText }, ...history, { role: "user", content: message }], { max_tokens: 700, temperature: 0.35 }); }
    catch (e) { return json({ error: "No engine could answer right now.", detail: String(e?.message || e).slice(0, 200), tried: (e.tried || []).map(t => ({ engine: t.engine, note: t.skipped || t.error })) }, 502); }
    await persist(out.text);
    const blocks = savedBlock ? [savedBlock] : [];
    try { // initiative: ephemeral visuals only; nothing persistent without Accept
      if (out.text.length > 350 && !/\?\s*$/.test(out.text.slice(-3)) ) {
        await ensureSiteSchema(env.DB); const level = (await getSetting(env.DB, "initiative")) || "ask"; const topic = message.replace(/[?!.]+$/g, "").slice(0, 80);
        if (level === "free") { const last = Date.parse(await getSetting(env.DB, "last_whim") || 0) || 0; if (Date.now() - last > 10 * 60 * 1000) { await setSetting(env.DB, "last_whim", new Date().toISOString()); const a = await drawArt(env, topic); blocks.push({ type: "art", subject: a.subject, svg: a.svg, whim: true }); } }
        else if (level === "ask") blocks.push({ type: "suggest", chips: [{ label: "Draw this", send: "draw " + topic }] });
      }
    } catch (e) { /* initiative must never break an answer */ }
    return json({ response: out.text, engine: out.engine, model: out.model, persisted: true, fell_back: out.tried.length > 0, blocks });
  } catch (e) { return json({ error: "Chat/database operation failed.", detail: String(e?.message || e).slice(0, 250) }, 502); }
}
