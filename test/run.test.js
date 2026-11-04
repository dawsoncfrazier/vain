import test from "node:test";
import assert from "node:assert/strict";
import { fakeD1, fakeAI, macServer, req, SID } from "./fake.js";
import * as chat from "../functions/api/chat.js";
import * as qs from "../functions/api/vain/questions.js";
import * as lab from "../functions/api/vain/lab.js";
import * as mem from "../functions/api/vain/memory.js";
import * as eng from "../functions/api/vain/engines.js";
import * as health from "../functions/api/health.js";
import * as props from "../functions/api/site/proposals.js";
import * as approve from "../functions/api/site/approve.js";
import { detectIntent } from "../src/intent.js";
import { extractText, runChat } from "../src/engine.js";

const ok = (text) => async () => ({ response: text });
const say = async (env, message) => { const r = await chat.onRequestPost({ request: req("/api/chat", "POST", { message, session_id: SID }), env }); return { status: r.status, ...(await r.json()) }; };
const mk = (ai) => ({ DB: fakeD1(), AI: ai || fakeAI(ok("hello from model")) });
const get = async (mod, env, path) => (await mod.onRequestGet({ request: req(path), env })).json();
const post = async (mod, env, path, body) => { const r = await mod.onRequestPost({ request: req(path, "POST", body), env }); return { status: r.status, ...(await r.json()) }; };

test("extractText handles shapes and strips think", () => {
  assert.equal(extractText({ response: "<think>x</think>hi" }), "hi");
  assert.equal(extractText({ choices: [{ message: { content: "yo" } }] }), "yo");
  assert.equal(extractText({ output_text: "z" }), "z");
});
test("intents", () => {
  assert.equal(detectIntent("show my memory").mode, "memory");
  assert.equal(detectIntent("open the lab").mode, "lab");
  assert.equal(detectIntent("close").kind, "close");
  assert.equal(detectIntent("make the accent colour teal").kind, "site_change");
  assert.equal(detectIntent("what is the capital of France?"), null);
});
test("normal chat uses biggest model first and persists", async () => {
  const ai = fakeAI(ok("hi there")); const env = mk(ai);
  const r = await say(env, "What is 2+2?");
  assert.equal(r.engine, "@cf/openai/gpt-oss-120b"); assert.equal(r.response, "hi there"); assert.equal(r.fell_back, false);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM messages").get().n, 2);
});
test("recall: no memory means no invention; with memory it quotes it", async () => {
  const ai = fakeAI(ok("model"));  const env = mk(ai);
  let r = await say(env, "When did I graduate?");
  assert.match(r.response, /don't have a saved record/); assert.equal(ai.calls.length, 0);
  await say(env, "I graduated in 2026"); // statement saved, model answers
  r = await say(env, "When did I graduate?");
  assert.match(r.response, /graduated in 2026/); assert.equal(r.engine, "memory");
});
test("questions are never saved as memory", async () => {
  const env = mk(); await say(env, "I want to know what I should build next?");
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM memory_entries").get().n, 0);
});
test("fallback and cooldown on quota errors", async () => {
  const ai = fakeAI(async (m) => { if (m.includes("120b")) throw new Error("429 neurons exhausted"); return { response: "from 70b" }; }); const env = mk(ai);
  let r = await say(env, "hello there"); assert.equal(r.engine, "@cf/meta/llama-3.3-70b-instruct-fp8-fast"); assert.equal(r.fell_back, true);
  const before = ai.calls.filter(c => c.includes("120b")).length;
  r = await say(env, "again please"); assert.equal(ai.calls.filter(c => c.includes("120b")).length, before); // skipped in cooldown
  const st = await get(eng, env, "/api/vain/engines"); assert.equal(st.chain[0].cooling, true);
});
test("all engines failing returns 502 with detail", async () => {
  const env = mk(fakeAI(async () => { throw new Error("boom"); })); const r = await say(env, "hello there"); assert.equal(r.status, 502); assert.ok(r.tried.length >= 1);
});
test("Mac node first, then falls back to cloud when it is down", async () => {
  const mac = await macServer((q, b, r) => { r.setHeader("content-type", "application/json"); r.end(JSON.stringify({ response: "mac says hi", model: "qwen-mac" })); });
  const ai = fakeAI(ok("cloud")); const env = { ...mk(ai), MAC_NODE_URL: mac.url, MAC_NODE_SECRET: "s".repeat(20) };
  let r = await say(env, "hello there"); assert.equal(r.engine, "mac"); assert.equal(r.response, "mac says hi"); assert.equal(ai.calls.length, 0);
  mac.close(); mac.server.closeAllConnections?.();
  r = await say({ ...env, MAC_TIMEOUT_MS: 2000 }, "hello again"); assert.equal(r.engine, "@cf/openai/gpt-oss-120b"); assert.equal(r.fell_back, true);
  const st = await get(eng, env, "/api/vain/engines"); assert.equal(st.mac.online, false);
});
test("panels, close, and ui payloads", async () => {
  const ai = fakeAI(ok("x")); const env = mk(ai);
  let r = await say(env, "show my memory"); assert.deepEqual(r.ui, { mode: "memory" }); assert.equal(r.engine, "workspace");
  r = await say(env, "close"); assert.equal(r.ui.mode, "chat"); assert.equal(ai.calls.length, 0);
});
test("questions endpoints: ask, answer saves memory, skip", async () => {
  const env = mk(fakeAI(async () => { throw new Error("down"); })); // forces starter
  const q = (await get(qs, env, "/api/vain/questions")).question; assert.ok(q.question);
  assert.equal((await post(qs, env, "/x", { id: q.id, answer: "" })).status, 400);
  assert.equal((await post(qs, env, "/x", { id: q.id, answer: "Honesty." })).ok, true);
  assert.match(env.DB.raw.prepare("SELECT text FROM memory_entries").get().text, /Honesty/);
  assert.equal((await post(qs, env, "/x", { id: q.id, answer: "again" })).status, 409);
  const r = await say(env, "/question"); assert.ok(r.ui.question.id);
  const s = await say(env, "/skip"); assert.equal(s.ui.question, null);
});
test("memory add / list / delete / forget", async () => {
  const env = mk(); const a = await post(mem, env, "/api/vain/memory", { text: "I like tea", category: "preference" }); assert.ok(a.id);
  assert.equal((await get(mem, env, "/api/vain/memory")).memories.length, 1);
  const d = await (await mem.onRequestDelete({ request: req("/api/vain/memory?id=" + a.id, "DELETE"), env })).json(); assert.equal(d.deleted, true);
  await post(mem, env, "/m", { text: "I like coffee", category: "preference" });
  const f = await say(env, "forget coffee"); assert.match(f.response, /removed/); assert.equal(f.ui.refresh, "memory");
});
test("lab: harvest, approve, build, download", async () => {
  const env = mk(); await say(env, "What is vAIn?");
  assert.ok((await post(lab, env, "/l", { action: "harvest" })).added >= 1);
  const s = await get(lab, env, "/api/vain/lab"); assert.ok(s.candidates >= 1);
  await post(lab, env, "/l", { action: "mark", id: s.candidate_list[0].id, status: "approved" });
  await post(lab, env, "/l", { action: "add", user_text: "Who are you?", assistant_text: "I am vAIn." });
  const b = await post(lab, env, "/l", { action: "build" }); assert.ok(b.total >= 10);
  const dl = await lab.onRequestGet({ request: req("/api/vain/lab?download=train"), env }); const line = (await dl.text()).split("\n")[0]; assert.ok(JSON.parse(line).messages);
  assert.equal((await post(lab, env, "/l", { action: "add", user_text: "", assistant_text: "" })).status, 400);
});
test("site proposal via chat then approve", async () => {
  const ai = fakeAI(ok('{"site_name":"vAIn","tagline":"hi","accent":"#00aaaa","background":"#080a10","panel":"#111725","description":"d"}')); const env = mk(ai);
  const r = await say(env, "make the accent colour teal"); assert.equal(r.ui.mode, "changes"); assert.equal(r.ui.proposal.design.accent, "#00aaaa");
  const list = await get(props, env, "/api/site/proposals"); assert.equal(list.proposals[0].status, "pending");
  assert.equal((await post(approve, env, "/a", { id: r.ui.proposal.id })).ok, true);
  assert.equal(env.DB.raw.prepare("SELECT value FROM site_settings WHERE key='accent'").get().value, "#00aaaa");
});
test("proposal with junk model output is rejected, not applied", async () => {
  const env = mk(fakeAI(ok("sorry no json"))); const r = await say(env, "make the accent colour teal");
  assert.match(r.response, /couldn't draft/); assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM site_proposals").get().n, 0);
});
test("health deep", async () => {
  const env = mk(); const r = await (await health.onRequestGet({ request: req("/api/health?deep=1"), env })).json(); assert.equal(r.ok, true); assert.equal(r.inference.ok, true);
});
test("cross-origin and bad session rejected", async () => {
  const env = mk(); let r = await chat.onRequestPost({ request: req("/api/chat", "POST", { message: "hi", session_id: SID }, { Origin: "https://evil.example" }), env }); assert.equal(r.status, 403);
  r = await chat.onRequestPost({ request: req("/api/chat", "POST", { message: "hi", session_id: "x" }), env }); assert.equal(r.status, 400);
});
