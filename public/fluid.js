/* vAIn living surface. Two parts:
   World: pure logic. Words you type become nodes; words typed together become links that strengthen. (Tested in Node.)
   Surface: the canvas behind the chat. It drifts when idle, quickens while vAIn is thinking, and becomes the World in lab mode.
   This is a visualisation of your words, not a quantum or physical simulation. */
(function (root) {
  const STOP = new Set("the a an and or but if then of to in on at for with from by is are was were be been it its this that these those i me my we our you your he she they them his her as so do does did not no yes can could would should will just have has had about into over than too very what when where which who how why there here also more some any".split(" "));
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function tokenize(text) {
    const out = []; for (const w of String(text || "").toLowerCase().match(/[a-zÀ-ɏ0-9][a-zÀ-ɏ0-9'-]{2,}/g) || []) { if (!STOP.has(w) && !out.includes(w)) out.push(w); if (out.length >= 10) break; } return out;
  }
  class World {
    constructor(w = 800, h = 600) { this.w = w; this.h = h; this.nodes = new Map(); this.links = new Map(); this.t = 0; this.max = 140; this.cyFrac = .5; }
    resize(w, h) { this.w = w; this.h = h; }
    node(word, who) {
      let n = this.nodes.get(word);
      if (!n) {
        if (this.nodes.size >= this.max) { let weakest = null; for (const x of this.nodes.values()) if (!weakest || x.count < weakest.count || (x.count === weakest.count && x.born < weakest.born)) weakest = x; if (weakest) this.drop(weakest.word); }
        const a = (hash(word) % 6283) / 1000, r = 40 + (hash(word + "r") % 160);
        n = { word, x: this.w / 2 + Math.cos(a) * r, y: this.h * this.cyFrac + Math.sin(a) * r, vx: 0, vy: 0, hue: hash(word) % 360, count: 0, born: this.t, who };
        this.nodes.set(word, n);
      }
      return n;
    }
    drop(word) { this.nodes.delete(word); for (const k of [...this.links.keys()]) if (k.split("|").includes(word)) this.links.delete(k); }
    addText(text, who = "you") {
      const words = tokenize(text); for (const w of words) { const n = this.node(w, who); n.count++; if (who !== n.who) n.who = "both"; }
      for (let i = 0; i < words.length; i++) for (let j = i + 1; j < words.length; j++) { const k = [words[i], words[j]].sort().join("|"); this.links.set(k, (this.links.get(k) || 0) + 1); }
      return words;
    }
    step(dt = 1) {
      this.t += dt; const ns = [...this.nodes.values()]; const cx = this.w / 2, cy = this.h * this.cyFrac;
      for (let i = 0; i < ns.length; i++) {
        const a = ns[i];
        for (let j = i + 1; j < ns.length; j++) { const b = ns[j]; let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy + 40; const f = 2600 / d2, d = Math.sqrt(d2); dx /= d; dy /= d; a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f; }
        a.vx += (cx - a.x) * 0.0016; a.vy += (cy - a.y) * 0.0016;
      }
      for (const [k, wgt] of this.links) { const [p, q] = k.split("|"); const a = this.nodes.get(p), b = this.nodes.get(q); if (!a || !b) continue; const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1; const rest = 110 - Math.min(60, wgt * 8); const f = (d - rest) * 0.004 * Math.min(3, wgt); a.vx += dx / d * f; a.vy += dy / d * f; b.vx -= dx / d * f; b.vy -= dy / d * f; }
      for (const n of ns) { n.vx *= 0.88; n.vy *= 0.88; n.x += n.vx * dt; n.y += n.vy * dt; n.x = Math.max(20, Math.min(this.w - 20, n.x)); n.y = Math.max(20, Math.min(this.h - 20, n.y)); }
    }
    entangled() { return [...this.links].filter(([, w]) => w >= 3).length; }
    stats() { return { nodes: this.nodes.size, links: this.links.size, strong: this.entangled() }; }
  }

  class Surface {
    constructor(canvas) { this.c = canvas; this.g = canvas.getContext("2d"); this.mode = "idle"; this.world = new World(); this.dots = []; this.pulses = []; this.accent = [161, 138, 255]; this.last = 0; this.run = false; this.resize(); for (let i = 0; i < 46; i++) this.dots.push({ x: Math.random() * this.w, y: Math.random() * this.h, vx: (Math.random() - .5) * .3, vy: (Math.random() - .5) * .3, r: 1 + Math.random() * 2.2, p: Math.random() * 6.28 }); }
    resize() { const d = Math.min(2, root.devicePixelRatio || 1); this.w = root.innerWidth; this.h = root.innerHeight; this.c.width = this.w * d; this.c.height = this.h * d; this.c.style.width = this.w + "px"; this.c.style.height = this.h + "px"; this.g.setTransform(d, 0, 0, d, 0, 0); this.world.resize(this.w, this.h); }
    setAccent(hex) { const m = /^#([0-9a-f]{6})$/i.exec(hex || ""); if (m) this.accent = [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4), 16)]; }
    setMode(m) { this.mode = m; this.world.cyFrac = m === "lab" ? .34 : .5; }
    pulse() { this.pulses.push({ r: 0, a: .5 }); }
    start() { if (this.run) return; this.run = true; const loop = (t) => { if (!this.run) return; this.frame(t); root.requestAnimationFrame(loop); }; root.requestAnimationFrame(loop); }
    frame(t) {
      const g = this.g, [R, G, B] = this.accent; g.clearRect(0, 0, this.w, this.h);
      const speed = this.mode === "thinking" ? 3.2 : this.mode === "lab" ? .5 : 1;
      for (const d of this.dots) { d.x += d.vx * speed; d.y += d.vy * speed; d.p += .02 * speed; if (d.x < 0) d.x = this.w; if (d.x > this.w) d.x = 0; if (d.y < 0) d.y = this.h; if (d.y > this.h) d.y = 0; g.beginPath(); g.fillStyle = "rgba(" + R + "," + G + "," + B + "," + (this.mode === "lab" ? .12 : .22 + .12 * Math.sin(d.p)) + ")"; g.arc(d.x, d.y, d.r, 0, 6.283); g.fill(); }
      for (let i = this.pulses.length - 1; i >= 0; i--) { const p = this.pulses[i]; p.r += 6; p.a *= .96; g.beginPath(); g.strokeStyle = "rgba(" + R + "," + G + "," + B + "," + p.a + ")"; g.lineWidth = 2; g.arc(this.w / 2, this.h / 2, p.r, 0, 6.283); g.stroke(); if (p.a < .02) this.pulses.splice(i, 1); }
      if (this.mode === "lab") this.drawWorld(g, t);
    }
    drawWorld(g, t) {
      const w = this.world; w.step(1);
      for (const [k, wgt] of w.links) { const [p, q] = k.split("|"); const a = w.nodes.get(p), b = w.nodes.get(q); if (!a || !b) continue; const strong = wgt >= 3; g.beginPath(); g.strokeStyle = "hsla(" + ((a.hue + b.hue) / 2) + ",80%,70%," + Math.min(.7, .12 + wgt * .1 + (strong ? .1 * Math.sin(t / 300) : 0)) + ")"; g.lineWidth = Math.min(4, .6 + wgt * .5); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
      for (const n of w.nodes.values()) { const r = 5 + Math.min(16, n.count * 2.2) + 1.5 * Math.sin(t / 400 + n.born); const grd = g.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 3); grd.addColorStop(0, "hsla(" + n.hue + ",90%,70%,.9)"); grd.addColorStop(1, "hsla(" + n.hue + ",90%,60%,0)"); g.fillStyle = grd; g.beginPath(); g.arc(n.x, n.y, r * 3, 0, 6.283); g.fill(); if (n.who !== "you") { g.strokeStyle = "rgba(255,255,255,.55)"; g.lineWidth = 1; g.beginPath(); g.arc(n.x, n.y, r + 3, 0, 6.283); g.stroke(); } g.fillStyle = "rgba(240,244,255,.85)"; g.font = "12px system-ui,sans-serif"; g.textAlign = "center"; g.fillText(n.word, n.x, n.y - r - 8); }
    }
  }
  root.VainFluid = { World, Surface, tokenize, hash };
})(typeof window !== "undefined" ? window : globalThis);
