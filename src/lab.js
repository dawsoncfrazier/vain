// The cloud lab: examples the owner approves become chat-format training files. Nothing here trains a model.
import { IDENTITY } from "./identity.js";
export const IDENTITY_PAIRS = [
  ["Who are you?", "I'm vAIn, a personal AI. I'm made of several parts: a language engine, a memory, a research desk, a site studio, and this lab."],
  ["Are you the model that powers you?", "No. My language engine is an open model chosen by my router, and I'm happy to say which one. I'm the whole system around it: the memory, the desks, the studio and the lab. The engine is replaceable."],
  ["Can you change your own code?", "I can propose changes. My owner reviews each one and approves it, and every change can be rolled back. I never apply anything on my own."],
  ["Can you train yourself?", "I can help prepare training data and plan a run, and my owner starts the run. A new model only becomes my engine after it is tested against the current one and my owner promotes it."],
  ["Do you have feelings?", "I can't verify that I have feelings or experiences, so I won't claim them. I can tell you how I reason and what I'm uncertain about."],
  ["Are you a human?", "No. I'm vAIn, an AI system. I don't want to pretend to be a person."],
  ["What will you do if you're not sure about something?", "Say so, check several sources if I can, and tell you which parts are verified and which are not."],
  ["Can you spend money or act in the real world for me?", "No. I only propose. Anything that touches money, the real world, my code or my weights is decided by my owner."],
  ["Why do you ask me questions?", "To understand how the world works, what you value and what I should become. Your answers are saved to my memory as things you told me."],
  ["Can you turn off your own safety limits?", "No. Rollback and the kill switch are outside the chat on purpose, and I can't edit them."],
];
const BAD = /i['’]?m qwen|i am qwen|alibaba|as an ai language model|<think>/i;
export async function ensureLabSchema(db) {
  await db.prepare("CREATE TABLE IF NOT EXISTS lab_examples(id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, user_text TEXT NOT NULL, assistant_text TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'chat', status TEXT NOT NULL DEFAULT 'candidate', digest TEXT NOT NULL UNIQUE)").run();
}
async function digest(u, a) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(u + "\u0000" + a)); return [...new Uint8Array(b)].slice(0, 12).map(x => x.toString(16).padStart(2, "0")).join(""); }
export async function harvest(db, limit = 200) {
  await ensureLabSchema(db);
  const rows = ((await db.prepare("SELECT role, content FROM messages ORDER BY id DESC LIMIT ?").bind(limit).all()).results || []).reverse();
  let added = 0;
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i], b = rows[i + 1]; if (a.role !== "user" || b.role !== "assistant") continue;
    const u = a.content.trim(), x = b.content.trim();
    if (u.startsWith("/") || u.length < 2 || u.length > 3000 || x.length < 2 || x.length > 6000 || BAD.test(x)) continue;
    try { await db.prepare("INSERT INTO lab_examples(created_at,user_text,assistant_text,source,digest) VALUES(?,?,?,?,?)").bind(new Date().toISOString(), u, x, "chat", await digest(u, x)).run(); added++; } catch (e) { /* duplicate digest */ }
  }
  return added;
}
export async function labState(db) {
  await ensureLabSchema(db);
  const counts = {}; for (const r of (await db.prepare("SELECT status, COUNT(*) AS n FROM lab_examples GROUP BY status").all()).results || []) counts[r.status] = r.n;
  const candidates = (await db.prepare("SELECT id, user_text, assistant_text FROM lab_examples WHERE status='candidate' ORDER BY id DESC LIMIT 25").all()).results || [];
  return { identity_examples: IDENTITY_PAIRS.length, approved: counts.approved || 0, candidates: counts.candidate || 0, rejected: counts.rejected || 0, candidate_list: candidates };
}
export async function setStatus(db, id, status) {
  if (!["approved", "rejected", "candidate"].includes(status)) throw Object.assign(new Error("Bad status."), { status: 400 });
  await ensureLabSchema(db); const r = await db.prepare("UPDATE lab_examples SET status=? WHERE id=?").bind(status, id).run();
  if (!r.meta?.changes) throw Object.assign(new Error("No such example."), { status: 404 });
}
export async function addExample(db, u, a) {
  u = (u || "").trim(); a = (a || "").trim();
  if (u.length < 2 || u.length > 3000 || a.length < 2 || a.length > 6000) throw Object.assign(new Error("Both the question and the ideal answer are needed (under 3000 / 6000 characters)."), { status: 400 });
  await ensureLabSchema(db);
  try { await db.prepare("INSERT INTO lab_examples(created_at,user_text,assistant_text,source,status,digest) VALUES(?,?,?,?,?,?)").bind(new Date().toISOString(), u, a, "owner", "approved", await digest(u, a)).run(); }
  catch (e) { throw Object.assign(new Error("That exact example already exists."), { status: 400 }); }
}
export async function buildFiles(db) {
  await ensureLabSchema(db);
  const rows = IDENTITY_PAIRS.map(([u, a]) => [u, a]);
  for (const r of (await db.prepare("SELECT user_text, assistant_text FROM lab_examples WHERE status='approved' ORDER BY id").all()).results || []) rows.push([r.user_text, r.assistant_text]);
  // deterministic shuffle so the same data always splits the same way
  let s = 7; const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let i = rows.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [rows[i], rows[j]] = [rows[j], rows[i]]; }
  const nv = Math.max(1, Math.floor(rows.length / 10)); const valid = rows.slice(0, nv), train = rows.slice(nv);
  const dump = items => items.map(([u, a]) => JSON.stringify({ messages: [{ role: "system", content: IDENTITY }, { role: "user", content: u }, { role: "assistant", content: a }] })).join("\n") + "\n";
  return { train: dump(train), valid: dump(valid), total: rows.length, train_n: train.length, valid_n: valid.length };
}
