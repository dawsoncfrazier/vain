// Test doubles: D1 on node:sqlite, Workers AI, and a Mac node.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import http from "node:http";
export function fakeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8"));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    async run() { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
    async all() { return { results: db.prepare(sql).all(...args).map(x => ({ ...x })) }; },
    async first() { const r = db.prepare(sql).get(...args); return r ? { ...r } : null; },
  });
  return { raw: db, prepare: s => stmt(s), async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out; } };
}
export function fakeAI(behaviour) { const calls = []; return { calls, async run(model, input) { calls.push(model); return behaviour(model, input, calls.length); } }; }
export function macServer(handler) {
  return new Promise(res => { const s = http.createServer((q, r) => { let b = ""; q.on("data", d => b += d); q.on("end", () => handler(q, b, r)); }); s.listen(0, "127.0.0.1", () => res({ url: "http://127.0.0.1:" + s.address().port, close: () => s.close(), server: s })); });
}
export const req = (path, method = "GET", body, headers = {}) => new Request("https://vain.test" + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
export const SID = "a".repeat(32);
