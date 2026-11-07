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
import { sanitizeSvg } from "../src/scene.js";
import { learn } from "../src/learn.js";
import * as ident from "../functions/api/vain/identity.js";
import { validateDesign } from "../src/site.js";

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
  assert.equal(detectIntent("show my memory").block, "memories");
  assert.equal(detectIntent("open the lab").kind, "lab");
  assert.equal(detectIntent("close").kind, "close");
  assert.equal(detectIntent("hey vain, make the background unicorns").kind, "site_change");
  assert.equal(detectIntent("Hey vain, go learn about black holes").topic, "black holes");
  assert.equal(detectIntent("go learn about this").kind, "learn_vague");
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
  let r = await say(env, "show my memory"); assert.deepEqual(r.blocks, [{ type: "memories" }]); assert.equal(r.engine, "workspace");
  r = await say(env, "open the lab"); assert.deepEqual(r.blocks, [{ type: "mode", mode: "lab" }]);
  r = await say(env, "close"); assert.equal(r.blocks[0].mode, "chat"); assert.equal(ai.calls.length, 0);
});
test("questions endpoints: ask, answer saves memory, skip", async () => {
  const env = mk(fakeAI(async () => { throw new Error("down"); })); // forces starter
  const q = (await get(qs, env, "/api/vain/questions")).question; assert.ok(q.question);
  assert.equal((await post(qs, env, "/x", { id: q.id, answer: "" })).status, 400);
  assert.equal((await post(qs, env, "/x", { id: q.id, answer: "Honesty." })).ok, true);
  assert.match(env.DB.raw.prepare("SELECT text FROM memory_entries").get().text, /Honesty/);
  assert.equal((await post(qs, env, "/x", { id: q.id, answer: "again" })).status, 409);
  const r = await say(env, "/question"); assert.ok(r.blocks[0].question.id);
  const s = await say(env, "/skip"); assert.match(s.response, /Skipped/);
});
test("memory add / list / delete / forget", async () => {
  const env = mk(); const a = await post(mem, env, "/api/vain/memory", { text: "I like tea", category: "preference" }); assert.ok(a.id);
  assert.equal((await get(mem, env, "/api/vain/memory")).memories.length, 1);
  const d = await (await mem.onRequestDelete({ request: req("/api/vain/memory?id=" + a.id, "DELETE"), env })).json(); assert.equal(d.deleted, true);
  await post(mem, env, "/m", { text: "I like coffee", category: "preference" });
  const f = await say(env, "forget coffee"); assert.match(f.response, /removed/);
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
  const r = await say(env, "make the accent colour teal"); assert.equal(r.blocks[0].type, "preview"); assert.equal(r.blocks[0].proposal.design.accent, "#00aaaa");
  const list = await get(props, env, "/api/site/proposals"); assert.equal(list.proposals[0].status, "pending");
  assert.equal((await post(approve, env, "/a", { id: r.blocks[0].proposal.id })).ok, true);
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

test("remember with address prefix saves and returns an undo-able block", async () => {
  const env = mk(); const r = await say(env, "hey vain, remember this: my cat is named Pixel");
  assert.equal(r.blocks[0].type, "saved"); assert.equal(r.blocks[0].text, "my cat is named Pixel");
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM memory_entries").get().n, 1);
  const d = await (await mem.onRequestDelete({ request: req("/api/vain/memory?id=" + r.blocks[0].id, "DELETE"), env })).json(); assert.equal(d.deleted, true);
});
test("svg sanitizer keeps drawings, refuses scripts, text, external refs", () => {
  const good = '<svg viewBox="0 0 100 50"><defs><linearGradient id="g"><stop offset="0" stop-color="#f0f"/></linearGradient></defs><rect width="100" height="50" fill="url(#g)" onload="x()"/><circle cx="5" cy="5" r="3"/></svg>';
  const out = sanitizeSvg(good); assert.ok(out && !/onload/.test(out) && /linearGradient/.test(out));
  for (const bad of ['<svg><script>alert(1)</script><rect width="1"/></svg>', '<svg><rect fill="url(http://evil/x)" width="1"/></svg>', '<svg><text>hi</text><rect width="1"/></svg>', '<svg><foreignObject><div/></foreignObject><rect width="1"/></svg>', "not svg"])
    assert.equal(sanitizeSvg(bad), null, bad);
  // self-closing unknown elements and unknown attributes are dropped, never passed through
  for (const dropped of ['<svg><image href="x.png"/><rect width="1"/></svg>', '<svg><rect href="javascript:alert(1)" width="1"/></svg>']) { const o = sanitizeSvg(dropped); assert.ok(o && !/image|href|javascript/.test(o), dropped); }
});
test("scenic request draws a sanitized scene; amend supersedes; unsafe art falls back to colours", async () => {
  const design = '{"site_name":"vAIn","tagline":"t","accent":"#ff66cc","background":"#101030","panel":"#1a1a40","description":"d"}';
  const svg = '<svg viewBox="0 0 1000 600"><rect width="1000" height="600" fill="#203"/><circle cx="500" cy="300" r="80" fill="#fff" onclick="x()"/></svg>';
  const ai = fakeAI(async (m, input) => ({ response: /Draw ONE SVG/.test(input.messages[0].content) ? svg : design })); const env = mk(ai);
  const r = await say(env, "hey vain, make the background unicorns"); const p = r.blocks[0].proposal;
  assert.ok(p.design.scene_svg.startsWith("<svg")); assert.ok(!/onclick/.test(p.design.scene_svg));
  const a = await post(props, env, "/api/site/proposals", { request: "more purple", base_id: p.id });
  assert.ok(a.id > p.id); assert.equal(env.DB.raw.prepare("SELECT status FROM site_proposals WHERE id=?").get(p.id).status, "superseded"); assert.ok(a.design.scene_svg);
  const ai2 = fakeAI(async (m, input) => ({ response: /Draw ONE SVG/.test(input.messages[0].content) ? "<svg><script>x</script></svg>" : design }));
  const r2 = await say({ ...mk(ai2) }, "make the background a forest"); assert.match(r2.response, /safety filter/); assert.equal(r2.blocks[0].proposal.design.scene_svg, "");
});
test("go learn: reads open sources, cites, returns images; no model invention on failure", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => { const u = String(url); const R = j => ({ ok: true, json: async () => j });
    if (u.includes("list=search")) return R({ query: { search: [{ title: "Black hole" }] } });
    if (u.includes("page/summary")) return R({ title: "Black hole", extract: "A black hole is a region of spacetime where gravity is extremely strong.", content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Black_hole" } }, thumbnail: { source: "https://upload.wikimedia.org/x.jpg" } });
    return { ok: false, status: 404, json: async () => ({}) }; };
  try {
    const env = mk(fakeAI(ok("A black hole is a region where gravity is extreme [1]. Uncertain: interiors."))); const r = await say(env, "hey vain, go learn about black holes");
    assert.equal(r.blocks[0].type, "learn"); assert.equal(r.blocks[0].sources[0].url, "https://en.wikipedia.org/wiki/Black_hole"); assert.equal(r.blocks[0].images[0].src, "https://upload.wikimedia.org/x.jpg"); assert.match(r.response, /\[1\]/);
    const dead = mk(fakeAI(async () => { throw new Error("down"); })); const l = await learn(dead, "black holes"); assert.match(l.summary, /no engine could summarise/);
    globalThis.fetch = async () => { throw new Error("offline"); };
    const r2 = await say(mk(), "go learn about cats"); assert.match(r2.response, /couldn't read/); assert.equal((r2.blocks || []).length, 0);
    const v = await say(mk(), "go learn about this"); assert.match(v.response, /Learn about what/);
  } finally { globalThis.fetch = real; }
});

const SVG = '<svg viewBox="0 0 600 400"><rect width="600" height="400" fill="#123"/><circle cx="300" cy="200" r="60" fill="#fc6"/></svg>';
const DESIGN_JSON = '{"site_name":"vAIn","tagline":"t","accent":"#33ccaa","background":"#081018","panel":"#101c28","description":"d","font":"serif","density":"airy","motion":"calm","bubble":"solid"}';
test("interface control: font, density, motion, bubble are validated enums", async () => {
  const d = validateDesign({ font: "comic-sans; background:url(x)", density: "airy", motion: "calm", bubble: "neon" }); assert.equal(d.font, "system"); assert.equal(d.density, "airy"); assert.equal(d.motion, "calm"); assert.equal(d.bubble, "glass");
  const env = mk(fakeAI(ok(DESIGN_JSON))); const r = await say(env, "change the font to serif and make it calmer"); const p = r.blocks[0].proposal.design; assert.deepEqual([p.font, p.density, p.motion, p.bubble], ["serif", "airy", "calm", "solid"]);
  await post(approve, env, "/a", { id: r.blocks[0].proposal.id }); assert.equal(env.DB.raw.prepare("SELECT value FROM site_settings WHERE key='font'").get().value, "serif");
});
test("draw on request: sanitized art block, never persistent; unsafe art refused", async () => {
  const env = mk(fakeAI(ok("sure " + SVG))); const r = await say(env, "hey vain, draw a lighthouse in a storm"); assert.equal(r.blocks[0].type, "art"); assert.ok(r.blocks[0].svg.startsWith("<svg")); assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM site_settings").get().n, 0);
  const bad = await say(mk(fakeAI(ok("<svg><script>x</script></svg>"))), "draw a cat"); assert.match(bad.response, /couldn't draw/); assert.equal((bad.blocks || []).length, 0);
  const envD = mk(fakeAI(ok(DESIGN_JSON))); const p = await post(props, envD, "/api/site/proposals", { request: "use my drawing as the background", scene_svg: SVG }); assert.ok(p.design.scene_svg.startsWith("<svg"));
  const evil = await post(props, envD, "/api/site/proposals", { request: "use my drawing as the background", scene_svg: "<svg><script>x</script></svg>" }); assert.ok(!/script/.test(evil.design?.scene_svg || ""));
});
test("initiative: ask offers chips, free draws on its own (throttled), off stays quiet; permission is explicit", async () => {
  const long = "A long answer. ".repeat(40); const ai = fakeAI(async (m, input) => ({ response: /Draw ONE clear illustration/.test(input.messages[0].content) ? SVG : long })); const env = mk(ai);
  let r = await say(env, "explain entanglement"); assert.equal(r.blocks.at(-1).type, "suggest"); assert.equal(r.blocks.at(-1).chips[0].send, "draw explain entanglement");
  r = await say(env, "you can surprise me"); assert.match(r.response, /Accept/);
  r = await say(env, "explain interference"); assert.equal(r.blocks.at(-1).type, "art"); assert.equal(r.blocks.at(-1).whim, true);
  r = await say(env, "explain superposition"); assert.ok(!r.blocks.some(b => b.type === "art")); // 10-minute throttle
  await say(env, "stop surprising me"); env.DB.raw.prepare("DELETE FROM site_settings WHERE key='last_whim'").run(); r = await say(env, "explain decoherence"); assert.equal(r.blocks.length, 0);
});
test("portable identity: export, tamper detection, import into a fresh vessel", async () => {
  const a = mk(); await post(mem, a, "/m", { text: "I love lighthouses", category: "preference" }); await post(lab, a, "/l", { action: "add", user_text: "Who are you?", assistant_text: "I am vAIn." });
  const bundle = await (await ident.onRequestGet({ env: a })).json(); assert.equal(bundle.format, "vain-identity/1"); assert.equal(bundle.checksum.length, 64); assert.equal(bundle.memories.length, 1);
  const tampered = JSON.parse(JSON.stringify(bundle)); tampered.memories[0].text = "I hate lighthouses"; const bad = await post(ident, mk(), "/i", tampered); assert.equal(bad.status, 400); assert.match(bad.error, /checksum/);
  assert.equal((await post(ident, mk(), "/i", { format: "other" })).status, 400);
  const b = mk(); const ok1 = await post(ident, b, "/i", bundle); assert.equal(ok1.memories, 1); assert.equal(ok1.examples, 1);
  assert.equal(b.DB.raw.prepare("SELECT source FROM memory_entries").get().source, "import"); const again = await post(ident, b, "/i", bundle); assert.equal(again.memories, 0); assert.equal(again.examples, 0);
  assert.equal((await say(b, "export yourself")).blocks[0].type, "identity");
});
