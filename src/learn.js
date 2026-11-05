// "Go learn about X": reads Wikipedia (open licence), has the engine summarise only what was read, and returns sources and images.
import { runChat } from "./engine.js";
const UA = { "user-agent": "vAIn-research/1.0 (personal research assistant)", accept: "application/json" };
const j = async (url, ms = 9000) => { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms) }); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); };
const IMG_OK = /^https:\/\/upload\.wikimedia\.org\//;

export async function learn(env, topic) {
  topic = String(topic || "").trim().slice(0, 120);
  if (topic.length < 2) throw Object.assign(new Error("Tell me what to learn about."), { status: 400 });
  const s = await j("https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=3&srsearch=" + encodeURIComponent(topic));
  const hits = (s.query?.search || []).slice(0, 3);
  if (!hits.length) return { topic, found: false, summary: "I couldn't find an open source on that. Try different wording?", sources: [], images: [] };
  const pages = [];
  for (const h of hits) {
    try {
      const p = await j("https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(h.title.replace(/ /g, "_")));
      if (p.extract) pages.push({ title: p.title, extract: p.extract.slice(0, 1800), url: p.content_urls?.desktop?.page || "https://en.wikipedia.org/wiki/" + encodeURIComponent(h.title), image: IMG_OK.test(p.thumbnail?.source || "") ? p.thumbnail.source : null });
    } catch (e) { /* skip this page */ }
  }
  if (!pages.length) return { topic, found: false, summary: "I found pages but couldn't read them right now.", sources: [], images: [] };
  const material = pages.map((p, i) => "[" + (i + 1) + "] " + p.title + ": " + p.extract).join("\n\n");
  let summary, engine = null;
  try {
    const r = await runChat(env, [{ role: "system", content: "Summarise ONLY the numbered sources for your owner in 4-6 plain sentences. Cite like [1]. Do not add facts that are not in the sources. If the sources disagree or are thin, say so. End with one sentence naming what is still uncertain." }, { role: "user", content: "Topic: " + topic + "\n\n" + material }], { tier: "best", max_tokens: 500, temperature: 0.2 });
    summary = r.text; engine = r.engine;
  } catch (e) { summary = "I read the sources but no engine could summarise them right now. Opening lines:\n" + pages.map((p, i) => "[" + (i + 1) + "] " + p.extract.slice(0, 220)).join("\n"); }
  return { topic, found: true, summary, engine, sources: pages.map((p, i) => ({ n: i + 1, title: p.title, url: p.url })), images: pages.filter(p => p.image).slice(0, 3).map(p => ({ src: p.image, caption: p.title })) };
}
