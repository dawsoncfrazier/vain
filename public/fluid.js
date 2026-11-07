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


  /* A real (exact, classical) state-vector simulator, up to 12 qubits. It is honest about being a simulation:
     no speed-up is claimed. Amplitudes are complex numbers; gates are applied exactly. */
  const SQ = Math.SQRT1_2;
  class Register {
    constructor(n = 2) { this.reset(n); }
    reset(n = this.n) { if (!(n >= 1 && n <= 12)) throw new Error("I can simulate 1 to 12 qubits exactly."); this.n = n; this.re = new Float64Array(1 << n); this.im = new Float64Array(1 << n); this.re[0] = 1; this.log = []; }
    _check(q) { if (!Number.isInteger(q) || q < 0 || q >= this.n) throw new Error("Qubit " + q + " doesn't exist; this register has qubits 0 to " + (this.n - 1) + "."); }
    _one(q, m) { this._check(q); const bit = 1 << q, N = 1 << this.n; for (let i = 0; i < N; i++) { if (i & bit) continue; const j = i | bit; const ar = this.re[i], ai = this.im[i], br = this.re[j], bi = this.im[j];
      this.re[i] = m[0][0] * ar - m[0][1] * ai + m[1][0] * br - m[1][1] * bi; this.im[i] = m[0][0] * ai + m[0][1] * ar + m[1][0] * bi + m[1][1] * br;
      this.re[j] = m[2][0] * ar - m[2][1] * ai + m[3][0] * br - m[3][1] * bi; this.im[j] = m[2][0] * ai + m[2][1] * ar + m[3][0] * bi + m[3][1] * br; } }
    // matrices as [[a_re,a_im],[b_re,b_im],[c_re,c_im],[d_re,d_im]] for [[a,b],[c,d]]
    h(q) { this._one(q, [[SQ, 0], [SQ, 0], [SQ, 0], [-SQ, 0]]); this.log.push("H " + q); }
    x(q) { this._one(q, [[0, 0], [1, 0], [1, 0], [0, 0]]); this.log.push("X " + q); }
    y(q) { this._one(q, [[0, 0], [0, -1], [0, 1], [0, 0]]); this.log.push("Y " + q); }
    z(q) { this._one(q, [[1, 0], [0, 0], [0, 0], [-1, 0]]); this.log.push("Z " + q); }
    s(q) { this._one(q, [[1, 0], [0, 0], [0, 0], [0, 1]]); this.log.push("S " + q); }
    t(q) { this._one(q, [[1, 0], [0, 0], [0, 0], [SQ, SQ]]); this.log.push("T " + q); }
    rz(q, th) { const c = Math.cos(th / 2), sn = Math.sin(th / 2); this._one(q, [[c, -sn], [0, 0], [0, 0], [c, sn]]); this.log.push("RZ(" + Math.round(th * 180 / Math.PI) + "°) " + q); }
    ry(q, th) { const c = Math.cos(th / 2), sn = Math.sin(th / 2); this._one(q, [[c, 0], [-sn, 0], [sn, 0], [c, 0]]); this.log.push("RY(" + Math.round(th * 180 / Math.PI) + "°) " + q); }
    rx(q, th) { const c = Math.cos(th / 2), sn = Math.sin(th / 2); this._one(q, [[c, 0], [0, -sn], [0, -sn], [c, 0]]); this.log.push("RX(" + Math.round(th * 180 / Math.PI) + "°) " + q); }
    cnot(a, b) { this._check(a); this._check(b); if (a === b) throw new Error("Control and target must differ."); const ca = 1 << a, tb = 1 << b, N = 1 << this.n; for (let i = 0; i < N; i++) { if ((i & ca) && !(i & tb)) { const j = i | tb; [this.re[i], this.re[j]] = [this.re[j], this.re[i]]; [this.im[i], this.im[j]] = [this.im[j], this.im[i]]; } } this.log.push("CNOT " + a + "→" + b); }
    cz(a, b) { this._check(a); this._check(b); if (a === b) throw new Error("The two qubits must differ."); const m = (1 << a) | (1 << b); for (let i = 0; i < 1 << this.n; i++) if ((i & m) === m) { this.re[i] = -this.re[i]; this.im[i] = -this.im[i]; } this.log.push("CZ " + a + "," + b); }
    swap(a, b) { this.cnot(a, b); this.cnot(b, a); this.cnot(a, b); this.log.length -= 3; this.log.push("SWAP " + a + "," + b); }
    probs() { const N = 1 << this.n, p = new Float64Array(N); for (let i = 0; i < N; i++) p[i] = this.re[i] * this.re[i] + this.im[i] * this.im[i]; return p; }
    norm() { return this.probs().reduce((a, b) => a + b, 0); }
    entropy(q) { this._check(q); const bit = 1 << q; let r00 = 0, r11 = 0, rr = 0, ri = 0; for (let i = 0; i < 1 << this.n; i++) { if (i & bit) continue; const j = i | bit; r00 += this.re[i] ** 2 + this.im[i] ** 2; r11 += this.re[j] ** 2 + this.im[j] ** 2; rr += this.re[i] * this.re[j] + this.im[i] * this.im[j]; ri += this.im[i] * this.re[j] - this.re[i] * this.im[j]; }
      const d = Math.sqrt((r00 - r11) ** 2 + 4 * (rr * rr + ri * ri)), l1 = (1 + d) / 2, l2 = (1 - d) / 2; const f = (l) => l > 1e-12 ? -l * Math.log2(l) : 0; return Math.max(0, f(l1) + f(l2)); }
    measure(q, rnd = Math.random) { this._check(q); const bit = 1 << q; let p1 = 0; for (let i = 0; i < 1 << this.n; i++) if (i & bit) p1 += this.re[i] ** 2 + this.im[i] ** 2; const out = rnd() < p1 ? 1 : 0; const keep = out ? p1 : 1 - p1, k = 1 / Math.sqrt(keep || 1);
      for (let i = 0; i < 1 << this.n; i++) { if (!!(i & bit) !== !!out) { this.re[i] = 0; this.im[i] = 0; } else { this.re[i] *= k; this.im[i] *= k; } } this.log.push("measure " + q + " → " + out); return out; }
    describe(maxTerms = 6) { const p = this.probs(), idx = [...p.keys()].filter(i => p[i] > 1e-9).sort((a, b) => p[b] - p[a]).slice(0, maxTerms);
      return idx.map(i => { const a = Math.sqrt(p[i]); const ph = Math.atan2(this.im[i], this.re[i]); return a.toFixed(3) + (Math.abs(ph) > 1e-6 ? "·e^(i" + (ph / Math.PI).toFixed(2) + "π)" : "") + "|" + i.toString(2).padStart(this.n, "0").split("").reverse().join("") + "⟩"; }).join(" + ") + (idx.length < [...p].filter(x => x > 1e-9).length ? " + …" : ""); }
  }
  // Written as the user would type it. Returns a list of operations, or null if the text isn't a quantum command.
  function parseQuantum(text) {
    const t = String(text || "").toLowerCase().replace(/[,;]/g, " ").replace(/\s+/g, " ").trim(); if (!t) return null; const ops = [];
    const num = (x) => parseInt(x, 10), deg = (x) => parseFloat(x) * Math.PI / 180; let m;
    if ((m = t.match(/^(?:use |set |make |create |new )?(?:a )?(?:register (?:of |with )?)?(\d+) qubits?(?: register)?$/))) return [["reset", num(m[1])]];
    if (/^(?:bell(?: state| pair)?|entangle (?:a )?pair)$/.test(t)) return [["reset", 2], ["h", 0], ["cnot", 0, 1]];
    if ((m = t.match(/^ghz(?: state)?(?: (?:of |on |with )?(\d+))?(?: qubits?)?$/))) { const n = m[1] ? num(m[1]) : 3; const o = [["reset", n], ["h", 0]]; for (let i = 1; i < n; i++) o.push(["cnot", 0, i]); return o; }
    if (/^(?:reset|clear|start over)(?: (?:the )?(?:register|qubits))?$/.test(t)) return [["reset"]];
    if ((m = t.match(/^measure (?:qubit )?(\d+|all)$/))) return [["measure", m[1] === "all" ? "all" : num(m[1])]];
    for (const part of t.split(/ then | and then | & /)) {
      let g;
      if ((g = part.match(/^(?:apply )?(?:a )?(?:hadamard|h)(?: gate)?(?: (?:on|to))?(?: qubit)? (\d+)$/))) ops.push(["h", num(g[1])]);
      else if ((g = part.match(/^(?:apply )?(?:(?:pauli[- ])?x|not|flip)(?: gate)?(?: (?:on|to))?(?: qubit)? (\d+)$/))) ops.push(["x", num(g[1])]);
      else if ((g = part.match(/^(?:apply )?(?:pauli[- ])?y(?: gate)?(?: (?:on|to))?(?: qubit)? (\d+)$/))) ops.push(["y", num(g[1])]);
      else if ((g = part.match(/^(?:apply )?(?:(?:pauli[- ])?z|phase flip)(?: gate)?(?: (?:on|to))?(?: qubit)? (\d+)$/))) ops.push(["z", num(g[1])]);
      else if ((g = part.match(/^(?:apply )?s(?: gate)?(?: (?:on|to))?(?: qubit)? (\d+)$/))) ops.push(["s", num(g[1])]);
      else if ((g = part.match(/^(?:apply )?t(?: gate)?(?: (?:on|to))?(?: qubit)? (\d+)$/))) ops.push(["t", num(g[1])]);
      else if ((g = part.match(/^(?:cnot|cx|controlled[- ]not)(?: (?:from|on|with))? (\d+)(?: (?:to|and|->|→))? (\d+)$/)) || (g = part.match(/^entangle (?:qubits? )?(\d+) (?:with |and )?(?:qubit )?(\d+)$/))) ops.push(["cnot", num(g[1]), num(g[2])]);
      else if ((g = part.match(/^cz (\d+) (?:and )?(\d+)$/))) ops.push(["cz", num(g[1]), num(g[2])]);
      else if ((g = part.match(/^swap (\d+) (?:with |and )?(\d+)$/))) ops.push(["swap", num(g[1]), num(g[2])]);
      else if ((g = part.match(/^rotate(?: qubit)? (\d+) (?:about |around |on )?(?:the )?(x|y|z)(?:[- ]axis)? (?:by )?(-?[\d.]+) ?(?:deg|degrees|°)$/))) ops.push(["r" + g[2], num(g[1]), deg(g[3])]);
      else if ((g = part.match(/^r([xyz]) (?:on )?(?:qubit )?(\d+) (?:by )?(-?[\d.]+) ?(?:deg|degrees|°)$/))) ops.push(["r" + g[1], num(g[2]), deg(g[3])]);
      else return null;
    }
    return ops.length ? ops : null;
  }
  function runQuantum(reg, ops, rnd) {
    const said = [];
    for (const op of ops) {
      const [k, a, b] = op;
      if (k === "reset") { reg.reset(a || reg.n); said.push("register reset to " + reg.n + " qubit" + (reg.n > 1 ? "s" : "") + " in |" + "0".repeat(reg.n) + "⟩"); continue; }
      if (k === "measure") { if (a === "all") { const r = []; for (let i = 0; i < reg.n; i++) r.push(reg.measure(i, rnd)); said.push("measured all: " + r.reverse().join("")); } else said.push("measured qubit " + a + ": " + reg.measure(a, rnd)); continue; }
      if (["rx", "ry", "rz"].includes(k)) reg[k](a, b); else if (["cnot", "cz", "swap"].includes(k)) reg[k](a, b); else reg[k](a);
    }
    const ent = []; for (let q = 0; q < reg.n; q++) { const e = reg.entropy(q); if (e > 0.01) ent.push("q" + q + " " + e.toFixed(2)); }
    return (said.length ? said.join("; ") + ". " : "") + "State: " + reg.describe() + ". " + (ent.length ? "Entanglement entropy (bits): " + ent.join(", ") + "." : "No entanglement right now.") + " (Exact classical simulation; no speed-up is claimed.)";
  }

  class Surface {
    constructor(canvas) { this.c = canvas; this.g = canvas.getContext("2d"); this.mode = "idle"; this.world = new World(); this.reg = new Register(2); this.motion = 1; this.dots = []; this.pulses = []; this.accent = [161, 138, 255]; this.last = 0; this.run = false; this.resize(); for (let i = 0; i < 46; i++) this.dots.push({ x: Math.random() * this.w, y: Math.random() * this.h, vx: (Math.random() - .5) * .3, vy: (Math.random() - .5) * .3, r: 1 + Math.random() * 2.2, p: Math.random() * 6.28 }); }
    resize() { const d = Math.min(2, root.devicePixelRatio || 1); this.w = root.innerWidth; this.h = root.innerHeight; this.c.width = this.w * d; this.c.height = this.h * d; this.c.style.width = this.w + "px"; this.c.style.height = this.h + "px"; this.g.setTransform(d, 0, 0, d, 0, 0); this.world.resize(this.w, this.h); }
    setAccent(hex) { const m = /^#([0-9a-f]{6})$/i.exec(hex || ""); if (m) this.accent = [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4), 16)]; }
    setMotion(k) { this.motion = ({ calm: .35, alive: 1, intense: 2.4 })[k] || 1; }
    setMode(m) { this.mode = m; this.world.cyFrac = m === "lab" ? .22 : .5; }
    pulse() { this.pulses.push({ r: 0, a: .5 }); }
    start() { if (this.run) return; this.run = true; const loop = (t) => { if (!this.run) return; this.frame(t); root.requestAnimationFrame(loop); }; root.requestAnimationFrame(loop); }
    frame(t) {
      const g = this.g, [R, G, B] = this.accent; g.clearRect(0, 0, this.w, this.h);
      const speed = (this.mode === "thinking" ? 3.2 : this.mode === "lab" ? .5 : 1) * this.motion;
      for (const d of this.dots) { d.x += d.vx * speed; d.y += d.vy * speed; d.p += .02 * speed; if (d.x < 0) d.x = this.w; if (d.x > this.w) d.x = 0; if (d.y < 0) d.y = this.h; if (d.y > this.h) d.y = 0; g.beginPath(); g.fillStyle = "rgba(" + R + "," + G + "," + B + "," + (this.mode === "lab" ? .12 : .22 + .12 * Math.sin(d.p)) + ")"; g.arc(d.x, d.y, d.r, 0, 6.283); g.fill(); }
      for (let i = this.pulses.length - 1; i >= 0; i--) { const p = this.pulses[i]; p.r += 6; p.a *= .96; g.beginPath(); g.strokeStyle = "rgba(" + R + "," + G + "," + B + "," + p.a + ")"; g.lineWidth = 2; g.arc(this.w / 2, this.h / 2, p.r, 0, 6.283); g.stroke(); if (p.a < .02) this.pulses.splice(i, 1); }
      if (this.mode === "lab") { this.drawWorld(g, t); this.drawRegister(g); }
    }
    drawRegister(g) {
      const r = this.reg; if (!r || r.log.length === 0) return; const p = r.probs(), N = p.length, show = Math.min(N, 64), idx = [...p.keys()].sort((a, b) => p[b] - p[a]).slice(0, show).sort((a, b) => a - b);
      const W = Math.min(this.w - 40, 640), x0 = (this.w - W) / 2, base = this.h * .45, bw = W / idx.length;
      g.fillStyle = "rgba(255,255,255,.07)"; g.fillRect(x0 - 8, base - 74, W + 16, 92);
      idx.forEach((i, k) => { const hgt = Math.sqrt(p[i]) * 66, ph = Math.atan2(r.im[i], r.re[i]); g.fillStyle = "hsla(" + (((ph / Math.PI) * 180 + 360) % 360) + ",85%,65%,.9)"; g.fillRect(x0 + k * bw + 1, base - hgt, Math.max(2, bw - 2), hgt); if (idx.length <= 16) { g.fillStyle = "rgba(240,244,255,.75)"; g.font = "10px ui-monospace,monospace"; g.textAlign = "center"; g.fillText(i.toString(2).padStart(r.n, "0").split("").reverse().join(""), x0 + k * bw + bw / 2, base + 12); } });
    }
    drawWorld(g, t) {
      const w = this.world; w.step(1);
      for (const [k, wgt] of w.links) { const [p, q] = k.split("|"); const a = w.nodes.get(p), b = w.nodes.get(q); if (!a || !b) continue; const strong = wgt >= 3; g.beginPath(); g.strokeStyle = "hsla(" + ((a.hue + b.hue) / 2) + ",80%,70%," + Math.min(.7, .12 + wgt * .1 + (strong ? .1 * Math.sin(t / 300) : 0)) + ")"; g.lineWidth = Math.min(4, .6 + wgt * .5); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
      for (const n of w.nodes.values()) { const r = 5 + Math.min(16, n.count * 2.2) + 1.5 * Math.sin(t / 400 + n.born); const grd = g.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 3); grd.addColorStop(0, "hsla(" + n.hue + ",90%,70%,.9)"); grd.addColorStop(1, "hsla(" + n.hue + ",90%,60%,0)"); g.fillStyle = grd; g.beginPath(); g.arc(n.x, n.y, r * 3, 0, 6.283); g.fill(); if (n.who !== "you") { g.strokeStyle = "rgba(255,255,255,.55)"; g.lineWidth = 1; g.beginPath(); g.arc(n.x, n.y, r + 3, 0, 6.283); g.stroke(); } g.fillStyle = "rgba(240,244,255,.85)"; g.font = "12px system-ui,sans-serif"; g.textAlign = "center"; g.fillText(n.word, n.x, n.y - r - 8); }
    }
  }
  root.VainFluid = { World, Surface, Register, parseQuantum, runQuantum, tokenize, hash };
})(typeof window !== "undefined" ? window : globalThis);
