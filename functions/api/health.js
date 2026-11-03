export async function onRequestGet({ env }) {
  return Response.json({
    ok: Boolean(env.AI),
    service: "vAIn Ϙ",
    model: "@cf/meta/llama-3.2-1b-instruct",
    ai_binding: Boolean(env.AI),
    note: "Cloud-hosted inference through Cloudflare Workers AI"
  }, { headers: { "cache-control": "no-store" } });
}
