export async function onRequestGet({ env }) {
  const aiBinding = Boolean(env.AI);
  let database = false;
  let databaseError = null;

  if (env.DB) {
    try {
      await env.DB.prepare("SELECT 1 AS ok").first();
      database = true;
    } catch (error) {
      databaseError = String(error?.message || error).slice(0, 240);
    }
  }

  return Response.json({
    ok: aiBinding && database,
    service: "vAIn Ϙ",
    model: "@cf/meta/llama-3.2-1b-instruct",
    ai_binding: aiBinding,
    d1_binding: Boolean(env.DB),
    d1_reachable: database,
    ...(databaseError ? { d1_error: databaseError } : {}),
    note: "Binding and connectivity check only; this endpoint does not test model inference or user authentication."
  }, { headers: { "cache-control": "no-store" } });
}
