const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
export async function onRequestGet({env}) {
  if (!env.DB) return json({error:"D1 binding DB is missing."},503);
  try {
    const result=await env.DB.prepare("SELECT m.session_id, (SELECT content FROM messages WHERE session_id=m.session_id AND role='user' ORDER BY id ASC LIMIT 1) AS title, MAX(m.created_at) AS updated_at, MAX(m.id) AS last_id FROM messages m GROUP BY m.session_id ORDER BY last_id DESC LIMIT 50").all();
    return json({sessions:result.results||[]});
  } catch(e) {
    return json({error:"Could not list conversations.",detail:String(e?.message||e).slice(0,200)},500);
  }
}
