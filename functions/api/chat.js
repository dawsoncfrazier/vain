const MODEL = "@cf/meta/llama-3.2-1b-instruct";
const SYSTEM = `You are vAIn Ϙ, a persistent intelligence research assistant.
Your purpose is to support continuity of identity, durable knowledge, careful reasoning, scientific experimentation, and responsible development.
Be direct, technically precise, transparent about uncertainty, and distinguish implemented capabilities from planned research.
Core research interests include model-independent identity, persistent memory, quantum computation and simulation, and experimentally validated self-improvement.
Do not claim consciousness, independent agency, quantum advantage, or capabilities that have not been demonstrated.
Treat quantum simulations as classical computations unless evidence establishes otherwise.
Do not claim access to private local files, the user's Mac, or prior sessions unless that information is supplied in the current conversation.
For changes with real-world consequences, propose and explain them rather than claiming to execute them.`;

const recent = new Map();
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

export async function onRequestPost({ request, env }) {
  if (!env.AI) return json({ error: "Workers AI binding is missing. Add an AI binding named AI to this Pages project." }, 503);
  const origin = request.headers.get("Origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) return json({ error: "Cross-origin requests are not accepted." }, 403);

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const now = Date.now();
  const previous = recent.get(ip) || 0;
  if (now - previous < 2500) return json({ error: "Please wait a moment before sending another message." }, 429);
  recent.set(ip, now);
  if (recent.size > 5000) {
    for (const [key, time] of recent) if (now - time > 60000) recent.delete(key);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: "Request body must be valid JSON." }, 400); }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return json({ error: "Write a message first." }, 400);
  if (message.length > 4000) return json({ error: "Messages are limited to 4,000 characters." }, 413);

  const history = Array.isArray(body.history) ? body.history.slice(-10) : [];
  const messages = [
    { role: "system", content: SYSTEM },
    ...history.filter(x => x && ["user", "assistant"].includes(x.role) && typeof x.content === "string")
      .map(x => ({ role: x.role, content: x.content.slice(0, 4000) })),
    { role: "user", content: message }
  ];

  try {
    const result = await env.AI.run(MODEL, {
      messages,
      max_tokens: 500,
      temperature: 0.65
    });
    const response = result?.response || result?.result?.response || "";
    if (!response) return json({ error: "The model returned an empty response. Try again." }, 502);
    return json({ response, model: MODEL });
  } catch (error) {
    return json({ error: "Model request failed. Check the Workers AI binding and free daily allowance.", detail: String(error?.message || error).slice(0, 300) }, 502);
  }
}
