import fs from "node:fs"; import vm from "node:vm"; import test from "node:test"; import assert from "node:assert/strict";
const ctx = { Math, Float64Array, Number, Array, String, Error, parseInt, parseFloat, RegExp, Map, Set, Object, console }; ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(fs.readFileSync(new URL("../public/fluid.js", import.meta.url), "utf8"), ctx);
const { Register, parseQuantum, runQuantum, World } = ctx.VainFluid; const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, a + " vs " + b);
test("Bell state: exact amplitudes, normalised, 1 bit of entanglement", () => { const r = new Register(2); runQuantum(r, parseQuantum("bell state")); const p = r.probs(); near(p[0], .5); near(p[3], .5); near(p[1], 0); near(p[2], 0); near(r.norm(), 1); near(r.entropy(0), 1); near(r.entropy(1), 1); });
test("product states have zero entropy; GHZ is maximally entangled", () => { const r = new Register(3); r.h(0); near(r.entropy(0), 0); const g = new Register(4); runQuantum(g, parseQuantum("ghz 4")); for (let q = 0; q < 4; q++) near(g.entropy(q), 1); near(g.probs()[15], .5); });
test("gate identities: HH=I, XX=I, ZH|0>... , RY(pi) flips, CNOT truth table, SWAP", () => {
  const r = new Register(1); r.h(0); r.h(0); near(r.probs()[0], 1); r.x(0); r.x(0); near(r.probs()[0], 1); r.ry(0, Math.PI); near(r.probs()[1], 1);
  const c = new Register(2); c.x(0); c.cnot(0, 1); near(c.probs()[3], 1); const w = new Register(2); w.x(0); w.swap(0, 1); near(w.probs()[2], 1);
  const z = new Register(1); z.h(0); z.z(0); z.h(0); near(z.probs()[1], 1); const t = new Register(1); t.h(0); for (let i = 0; i < 4; i++) t.t(0); t.h(0); near(t.probs()[1], 1);
});
test("measurement collapses and renormalises; all-qubit measure of Bell gives equal bits", () => {
  const r = new Register(2); runQuantum(r, parseQuantum("bell")); const out = r.measure(0, () => 0.1); assert.equal(out, 1); near(r.probs()[3], 1); near(r.norm(), 1);
  for (let k = 0; k < 20; k++) { const b = new Register(2); b.h(0); b.cnot(0, 1); const text = runQuantum(b, parseQuantum("measure all")); const bits = text.match(/measured all: (\d\d)/)[1]; assert.ok(bits === "00" || bits === "11"); }
});
test("parser: natural phrasings, chains, rejects non-quantum text and bad qubits", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(parseQuantum("hadamard on 0 then cnot 0 1"))), [["h", 0], ["cnot", 0, 1]]);
  assert.deepEqual(JSON.parse(JSON.stringify(parseQuantum("use 5 qubits"))), [["reset", 5]]); assert.equal(parseQuantum("tell me about cats"), null); assert.equal(parseQuantum("what is a qubit?"), null);
  assert.throws(() => runQuantum(new Register(2), parseQuantum("hadamard on 5")), /doesn't exist/); assert.throws(() => new Register(13), /1 to 12/); assert.throws(() => runQuantum(new Register(2), parseQuantum("cnot 1 1")), /differ/);
});
test("12 qubits stays exact and fast", () => { const r = new Register(12); const t0 = Date.now(); for (let q = 0; q < 12; q++) r.h(q); for (let q = 0; q < 11; q++) r.cnot(q, q + 1); near(r.norm(), 1, 1e-9); assert.ok(Date.now() - t0 < 2000); });
test("concept world stays finite and bounded under heavy input", () => { const w = new World(800, 600); for (let i = 0; i < 400; i++) w.addText("alpha" + i + " beta" + (i % 7) + " gamma" + (i % 13)); for (let i = 0; i < 100; i++) w.step(); assert.ok(w.nodes.size <= 140); for (const n of w.nodes.values()) assert.ok(isFinite(n.x) && isFinite(n.y)); });
