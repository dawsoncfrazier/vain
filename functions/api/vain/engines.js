import { engineStatus } from "../../../src/engine.js";
const json = (x, s = 200) => new Response(JSON.stringify(x), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
export async function onRequestGet({ env }) { try { return json(await engineStatus(env)); } catch (e) { return json({ error: "Status unavailable", detail: String(e?.message || e).slice(0, 200) }, 500); } }
