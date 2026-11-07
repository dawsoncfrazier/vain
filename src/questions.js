// vAIn's question habit: one open question at a time, chosen by the model from what it knows, with starters as a fallback.
import { runChat } from "./engine.js";
import { IDENTITY } from "./identity.js";
export const STARTERS = [
  ["What does a grand and beautiful version of vAIn look like to you, in a year?", "It sets the direction I should grow in, and I will use it to judge my own upgrades."],
  ["When you picture vAIn being wrong, what is the mistake you would find hardest to forgive?", "It tells me which failures to guard against first."],
  ["If helping you and being honest ever pull in different directions, which should win, and why?", "I will treat your answer as a rule for hard cases."],
  ["What is something you believe about how the world works that most people would disagree with?", "It shows me how you reason, so I can learn from it without just copying it."],
  ["Which parts of your life do you want me to stay out of completely?", "I need boundaries I can respect even when nobody is checking."],
  ["How should I decide when a source on the internet is trustworthy?", "I will turn your answer into my checking habit when I research."],
  ["What should I learn first, in your view: how language models work, or how the world works?", "It decides what I study before I try to improve my own weights."],
  ["Is it ever right for an AI to change its own goals? Under what conditions?", "I am allowed to propose changes to myself, so I need your view on the limits."],
];
const PROMPT = 'You are choosing the single most useful question to ask your owner right now. Good questions help you understand how the world works, what your owner values, how to handle an ethical or logical dilemma you have met, or what you should become. Do not repeat or rephrase a question you already asked. Keep it under 45 words and specific. Reply with ONLY JSON: {"question": "...", "why": "one sentence on how you will use the answer"}';
export async function ensureQuestionSchema(db) {
  await db.prepare("CREATE TABLE IF NOT EXISTS vain_questions(id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, question TEXT NOT NULL, why TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open', answer TEXT NOT NULL DEFAULT '', closed_at TEXT, source TEXT NOT NULL DEFAULT 'model')").run();
}
export async function currentQuestion(db) { await ensureQuestionSchema(db); return await db.prepare("SELECT * FROM vain_questions WHERE status='open' ORDER BY id DESC LIMIT 1").first(); }
async function generate(env, asked) {
  try {
    const mem = await env.DB.prepare("SELECT text FROM memory_entries ORDER BY id DESC LIMIT 30").all();
    const ctx = (mem.results || []).map(x => "- " + x.text).join("\n");
    const r = await runChat(env, [{ role: "system", content: IDENTITY + (ctx ? "\n\nSaved memory:\n" + ctx : "") }, { role: "user", content: PROMPT + "\n\nQuestions already asked:\n" + (asked.map(q => "- " + q).join("\n") || "(none yet)") }], { tier: "light", max_tokens: 250, temperature: 0.7 });
    const m = r.text.match(/\{[\s\S]*\}/); if (m) { const d = JSON.parse(m[0]); const q = String(d.question || "").trim(); if (q.length >= 12 && q.length <= 400 && q.includes("?") && !asked.includes(q)) return [q, String(d.why || "").slice(0, 300), "model"]; }
  } catch (e) { /* fall through to starters */ }
  const q = STARTERS.find(s => !asked.includes(s[0])) || STARTERS[asked.length % STARTERS.length];
  return [q[0], q[1], "starter"];
}
export async function ensureQuestion(env, { force = false } = {}) {
  const db = env.DB; const cur = await currentQuestion(db); if (cur) return cur;
  const hours = Number(env.QUESTION_HOURS ?? 1);
  if (!force) { const last = await db.prepare("SELECT closed_at FROM vain_questions WHERE closed_at IS NOT NULL ORDER BY id DESC LIMIT 1").first(); if (last?.closed_at && (Date.now() - Date.parse(last.closed_at)) / 3600000 < hours) return null; }
  const asked = ((await db.prepare("SELECT question FROM vain_questions ORDER BY id DESC LIMIT 20").all()).results || []).map(x => x.question);
  const [q, why, source] = await generate(env, asked);
  await db.prepare("INSERT INTO vain_questions(created_at,question,why,source) VALUES(?,?,?,?)").bind(new Date().toISOString(), q, why, source).run();
  return await currentQuestion(db);
}
export async function answerQuestion(db, id, text) {
  text = (text || "").trim(); if (!text) throw Object.assign(new Error("Write an answer first."), { status: 400 }); if (text.length > 4000) throw Object.assign(new Error("Keep the answer under 4000 characters."), { status: 400 });
  await ensureQuestionSchema(db); const q = await db.prepare("SELECT * FROM vain_questions WHERE id=?").bind(id).first();
  if (!q) throw Object.assign(new Error("No such question."), { status: 404 }); if (q.status !== "open") throw Object.assign(new Error("That question is already closed."), { status: 409 });
  const now = new Date().toISOString();
  await db.prepare("UPDATE vain_questions SET status='answered', answer=?, closed_at=? WHERE id=?").bind(text, now, id).run();
  await db.prepare("INSERT INTO memory_entries(text,category,source,created_at) VALUES(?,?,?,?)").bind("vAIn asked: " + q.question + " | Owner answered: " + text, "conversation_event", "user_statement", now).run();
}
export async function skipQuestion(db, id) {
  await ensureQuestionSchema(db); const q = await db.prepare("SELECT status FROM vain_questions WHERE id=?").bind(id).first();
  if (!q) throw Object.assign(new Error("No such question."), { status: 404 }); if (q.status !== "open") throw Object.assign(new Error("That question is already closed."), { status: 409 });
  await db.prepare("UPDATE vain_questions SET status='skipped', closed_at=? WHERE id=?").bind(new Date().toISOString(), id).run();
}
