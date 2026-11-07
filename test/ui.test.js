// Fake-DOM test of public/index.html + fluid.js: no panels; everything is bubbles; the page itself changes.
import fs from "node:fs"; import vm from "node:vm"; import test from "node:test"; import assert from "node:assert/strict";
const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const fluid = fs.readFileSync(new URL("../public/fluid.js", import.meta.url), "utf8");
const js = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));
assert.ok(!/class="tab|id="stage"|stageTitle/.test(html), "no panels or tabs");
class El {
  constructor(t) { this.tag = t; this.nodeType = 1; this.children = []; this.className = ""; this.dataset = {}; this.attrs = {}; this.style = { setProperty() {} }; this.value = ""; this.disabled = false; this.scrollTop = 0; this.scrollHeight = 0; this.parent = null; this._text = ""; this.src = ""; this.classes = new Set();
    this.classList = { toggle: (c, on) => { on ? this.classes.add(c) : this.classes.delete(c); } }; }
  set textContent(v) { this._text = String(v); this.children = []; } get textContent() { return this._text + this.children.map(c => c.textContent).join(""); }
  append(...n) { for (const x of n) { x.parent = this; this.children.push(x); } } get lastChild() { return this.children[this.children.length - 1]; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); }
  setAttribute(k, v) { this.attrs[k] = v; if (k === "src") this.src = v; } addEventListener(e, f) { this["on" + e] = f; } focus() {}
  requestSubmit() { this.onsubmit && this.onsubmit({ preventDefault() {} }); }
  all() { return [this].concat(...this.children.map(c => c.all())); } find(pred) { return this.all().find(pred); } findAll(pred) { return this.all().filter(pred); }
  getContext() { return new Proxy({}, { get: (t, k) => k === "createRadialGradient" ? () => ({ addColorStop() {} }) : () => {}, set: () => true }); }
}
const txt = s => Object.assign(new El("#t"), { nodeType: 3, _text: String(s) });
const byId = {}; for (const m of html.matchAll(/id="([\w-]+)"/g)) byId[m[1]] = new El("x");
const bodyEl = new El("body"); const sent = []; const R = j => ({ ok: true, json: async () => j });
const DESIGN = { accent: "#ff66cc", background: "#101030", panel: "#1a1a40", site_name: "vAIn", tagline: "t", scene_svg: '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>' };
const chatReply = body => {
  const m = body.message;
  if (/background/.test(m)) return { response: "Here's a preview.", engine: "workspace", blocks: [{ type: "preview", proposal: { id: 5, request: m, status: "pending", design: DESIGN } }] };
  if (/remember/.test(m)) return { response: "Noted.", engine: "workspace", blocks: [{ type: "saved", id: 9, text: "my cat is Pixel", category: "personal_fact" }] };
  if (/learn/.test(m)) return { response: "Black holes are regions of strong gravity [1].", engine: "workspace", blocks: [{ type: "learn", topic: "black holes", summary: "s", sources: [{ n: 1, title: "Black hole", url: "https://en.wikipedia.org/wiki/Black_hole" }], images: [{ src: "https://upload.wikimedia.org/a.jpg", caption: "Black hole" }, { src: "https://upload.wikimedia.org/b.jpg", caption: "Disk" }] }] };
  if (/lab/.test(m)) return { response: "Lab open.", engine: "workspace", blocks: [{ type: "mode", mode: "lab" }] };
  if (/^close/.test(m)) return { response: "Back.", engine: "workspace", blocks: [{ type: "mode", mode: "chat" }] };
  return { response: "plain <b>reply</b>", engine: "mac" };
};
const ctx = {
  document: { querySelector: s => byId[s.slice(1)] || null, createElement: t => new El(t), createTextNode: txt, body: bodyEl, documentElement: new El("html"), title: "" },
  localStorage: { getItem: () => null, setItem() {} }, crypto: { randomUUID: () => "12345678-1234-1234-1234-123456789012" },
  setInterval() {}, encodeURIComponent, JSON, alert() {}, innerWidth: 800, innerHeight: 600, devicePixelRatio: 1, requestAnimationFrame() {}, addEventListener() {},
  fetch: async (u, o) => {
    const body = o && o.body ? JSON.parse(o.body) : null; sent.push([u, (o && o.method) || "GET", body]);
    if (u === "/api/chat") return R(chatReply(body));
    if (u.startsWith("/api/site-settings")) return R({ accent: "#112233", site_name: "vAIn Test" });
    if (u.startsWith("/api/health")) return R({ ok: true });
    if (u.startsWith("/api/history")) return R({ history: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }] });
    if (u === "/api/vain/questions" && !(o && o.method)) return R({ question: { id: 3, question: "What is grand?", why: "direction" } });
    if (u === "/api/vain/questions") return R({ ok: true });
    if (u.startsWith("/api/vain/memory")) return R({ deleted: true });
    if (u.startsWith("/api/site/proposals")) return R({ id: 6, request: body.request, status: "pending", design: { ...DESIGN, accent: "#9933ff" } });
    if (u.startsWith("/api/site/")) return R({ ok: true });
    return { ok: false, status: 404, json: async () => ({ error: "nope" }) };
  },
};
ctx.window = ctx; vm.createContext(ctx); vm.runInContext(fluid, ctx); vm.runInContext(js, ctx);
const tick = () => new Promise(r => setImmediate(r)); const ticks = async n => { for (let i = 0; i < n; i++) await tick(); };
const say = async t => { byId.prompt.value = t; byId.f.onsubmit({ preventDefault() {} }); await ticks(10); };
const msgs = () => byId.messages.children.filter(c => c.className.includes("msg"));
const blocksOf = () => byId.messages.children.filter(c => c.className === "block");
const btn = (root, label) => root.find(e => e.tag === "button" && e.textContent === label);

test("boots: history, status dot, theme, and the open question as a bubble", async () => {
  await ticks(12); assert.equal(msgs().length, 2); assert.equal(byId.dot.className, "on"); assert.equal(byId.siteName.textContent, "vAIn Test");
  assert.match(blocksOf()[0].textContent, /What is grand\?/);
});
test("model text is never parsed as HTML", async () => {
  await say("tell me something"); const last = msgs().pop(); assert.ok(last.textContent.includes("<b>reply</b>")); assert.ok(!last.all().some(e => e.tag === "b")); assert.match(last.textContent, /via your Mac/);
});
test("background request: live preview bubble with Accept / Deny / Amend", async () => {
  await say("hey vain, make the background unicorns"); const b = blocksOf().pop();
  assert.ok(btn(b, "Accept") && btn(b, "Deny") && btn(b, "Amend")); assert.equal(byId.scene.className, "on"); assert.match(byId.scene.src, /^data:image\/svg\+xml/);
  await btn(b, "Amend").onclick(); const input = b.find(e => e.tag === "input"); input.value = "more purple"; await btn(b, "Revise").onclick(); await ticks(6);
  assert.ok(sent.some(s => s[0] === "/api/site/proposals" && s[2].base_id === 5 && s[2].request === "more purple"));
  await btn(b, "Accept").onclick(); await ticks(4); assert.ok(sent.some(s => s[0] === "/api/site/approve" && s[2].id === 6)); assert.match(b.textContent, /Accepted/);
});
test("deny rejects and reverts", async () => {
  await say("make the background a forest"); const b = blocksOf().pop(); await btn(b, "Deny").onclick(); await ticks(4);
  assert.ok(sent.some(s => s[0] === "/api/site/reject" && s[2].id === 5)); assert.match(b.textContent, /Discarded/);
});
test("remember: saved chip with working Undo", async () => {
  await say("hey vain, remember this: my cat is Pixel"); const b = blocksOf().pop(); assert.match(b.textContent, /Saved to memory/);
  await btn(b, "Undo").onclick(); await ticks(4); assert.ok(sent.some(s => s[0] === "/api/vain/memory?id=9" && s[1] === "DELETE"));
});
test("learn: summary in chat, floating images and safe source links", async () => {
  await say("hey vain, go learn about black holes"); const b = blocksOf().pop();
  assert.equal(b.findAll(e => e.tag === "img").length, 2); const a = b.find(e => e.tag === "a"); assert.equal(a.attrs.rel, "noopener noreferrer"); assert.equal(a.attrs.target, "_blank");
});
test("lab: the page becomes a simulation; typed words become nodes; close leaves", async () => {
  await say("open the lab"); assert.ok(bodyEl.classes.has("lab"));
  await say("quantum entanglement of memories"); const st = vm.runInContext("surface.world.stats()", ctx);
  assert.ok(st.nodes >= 3 && st.links >= 3); assert.match(byId.hud.textContent, /concepts/);
  await say("close"); assert.ok(!bodyEl.classes.has("lab"));
});
