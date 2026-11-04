// Fake-DOM test of public/index.html: the page must morph from replies, and render text safely.
import fs from "node:fs"; import vm from "node:vm"; import test from "node:test"; import assert from "node:assert/strict";
const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const js = html.slice(html.indexOf("<script>") + 8, html.indexOf("</script>"));
class El {
  constructor(t) { this.tag = t; this.nodeType = 1; this.children = []; this.className = ""; this.dataset = {}; this.attrs = {}; this.style = { setProperty() {} }; this.value = ""; this.disabled = false; this.scrollTop = 0; this.scrollHeight = 0; this.parent = null; this._text = ""; }
  set textContent(v) { this._text = String(v); this.children = []; } get textContent() { return this._text + this.children.map(c => c.textContent).join(""); }
  append(...n) { for (const x of n) { x.parent = this; this.children.push(x); } }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); }
  setAttribute(k, v) { this.attrs[k] = v; } addEventListener(e, f) { this["on" + e] = f; } focus() {}
  requestSubmit() { this.onsubmit && this.onsubmit({ preventDefault() {} }); }
  all() { return [this].concat(...this.children.map(c => c.all())); }
  find(pred) { return this.all().find(pred); }
}
const txt = s => Object.assign(new El("#t"), { nodeType: 3, _text: String(s) });
const byId = {}; for (const m of html.matchAll(/id="([\w-]+)"/g)) byId[m[1]] = new El("x");
const bodyEl = new El("body");
const sent = [];
const R = j => ({ ok: true, json: async () => j });
const routes = {
  chat: body => /memory/.test(body.message) ? { response: "Opening.", engine: "workspace", ui: { mode: "memory" } }
    : /colour/.test(body.message) ? { response: "drafted", engine: "workspace", ui: { mode: "changes", proposal: { id: 5, request: "teal", status: "pending", design: { accent: "#00aaaa", background: "#080a10", panel: "#111725", site_name: "vAIn", tagline: "t" } } } }
    : /close/.test(body.message) ? { response: "Closed.", engine: "workspace", ui: { mode: "chat" } }
    : { response: "plain <b>reply</b>", engine: "mac", fell_back: false },
};
const ctx = {
  document: { querySelector: s => byId[s.slice(1)] || null, createElement: t => new El(t), createTextNode: txt, body: bodyEl, documentElement: new El("html"), title: "" },
  localStorage: { getItem: () => null, setItem() {} }, crypto: { randomUUID: () => "12345678-1234-1234-1234-123456789012" },
  setInterval() {}, encodeURIComponent, JSON, alert() {},
  fetch: async (u, o) => {
    const body = o && o.body ? JSON.parse(o.body) : null; sent.push([u, o && o.method || "GET", body]);
    if (u === "/api/chat") return R(routes.chat(body));
    if (u.startsWith("/api/site-settings")) return R({ accent: "#112233", site_name: "vAIn Test" });
    if (u.startsWith("/api/health")) return R({ ok: true, mac_configured: true });
    if (u.startsWith("/api/history")) return R({ history: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }] });
    if (u.startsWith("/api/sessions")) return R({ sessions: [{ session_id: "b".repeat(32), title: "Old chat" }] });
    if (u === "/api/vain/questions" && !(o && o.method)) return R({ question: { id: 3, question: "What is grand?", why: "direction" } });
    if (u === "/api/vain/questions") return R({ ok: true });
    if (u.startsWith("/api/vain/memory")) return R({ memories: [{ id: 1, text: "I graduated in 2026", category: "personal_fact", source: "user_statement", created_at: "2026-01-01T00:00:00Z" }] });
    if (u.startsWith("/api/site/proposals")) return R({ proposals: [] });
    if (u.startsWith("/api/site/approve")) return R({ ok: true });
    return { ok: false, status: 404, json: async () => ({ error: "nope" }) };
  },
};
vm.createContext(ctx); vm.runInContext(js, ctx);
ctx.document.body = bodyEl;
const tick = () => new Promise(r => setImmediate(r)); const ticks = async n => { for (let i = 0; i < n; i++) await tick(); };
const say = async t => { byId.prompt.value = t; byId.f.onsubmit({ preventDefault() {} }); await ticks(8); };
const msgs = () => byId.messages.children.filter(c => c.className.includes("msg"));

test("page boots with history, theme, badge, question card", async () => {
  await ticks(10);
  assert.equal(msgs().length, 2); assert.match(byId.engineBadge.textContent, /Mac \+ cloud/);
  assert.match(byId.qwrap.textContent, /What is grand\?/); assert.equal(byId.siteName.textContent, "vAIn Test");
  assert.equal(byId.picker.children.length, 2);
});
test("model text is never parsed as HTML; engine shown", async () => {
  await say("tell me something"); const last = msgs().pop();
  assert.ok(last.textContent.includes("<b>reply</b>")); assert.ok(!last.all().some(e => e.tag === "b")); assert.match(last.textContent, /via your Mac/);
});
test("conversation morphs the interface and closes it again", async () => {
  await say("show my memory"); assert.equal(bodyEl.dataset.mode, "memory"); assert.match(byId.stageTitle.textContent, /Memory/); assert.match(byId.stagebody.textContent, /graduated in 2026/);
  await say("close"); assert.equal(bodyEl.dataset.mode, "chat"); assert.equal(byId.stagebody.textContent, "");
});
test("site proposal panel approves through the API", async () => {
  await say("make the accent colour teal"); assert.equal(bodyEl.dataset.mode, "changes");
  const btn = byId.stagebody.find(e => e.tag === "button" && e.textContent === "Approve"); assert.ok(btn, "approve button");
  await btn.onclick(); await ticks(4);
  assert.ok(sent.some(s => s[0] === "/api/site/approve" && s[2].id === 5));
});
test("answering the question posts and clears the card", async () => {
  const card = byId.qwrap.children[0]; const ta = card.find(e => e.tag === "textarea"); ta.value = "Beauty";
  await card.find(e => e.tag === "button" && e.textContent === "Answer").onclick(); await ticks(4);
  assert.ok(sent.some(s => s[0] === "/api/vain/questions" && s[2]?.answer === "Beauty" && s[2]?.id === 3)); assert.equal(byId.qwrap.children.length, 0);
});
