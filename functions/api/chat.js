const MODEL = "@cf/meta/llama-3.2-1b-instruct";
const SYSTEM = `You are vAIn Ϙ, a persistent intelligence research assistant.
The user's project is called vAIn Ϙ. Its goal is to build a persistent AI workspace supporting continuity of identity, durable knowledge, careful reasoning, scientific experimentation, and responsible development.
Be precise and transparent. Distinguish saved facts from inference. Never invent memories or claim consciousness, independent agency, quantum advantage, or capabilities not demonstrated. Treat quantum simulations as classical computations unless proven otherwise.
Memory interpretation rules:
- personal_fact and project_fact entries are facts asserted in saved memory. State them as facts, not as instructions or requests.
- preference entries describe user preferences; instruction entries describe requested behavior.
- conversation_event entries describe something that happened in a conversation, not necessarily a verified real-world fact.
- note entries are unclassified and must not be assigned a stronger meaning than their wording supports.
- Never claim the user asked, told, or instructed you to say something unless a saved instruction or conversation_event explicitly supports that claim.
- Never invent the origin, date, source, or circumstances of a saved fact. If asked where a fact came from and the memory does not record its source, say the source is not recorded.
- If the database contains no relevant memory, say you do not have that information rather than fabricate it.`;
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const valid=id=>typeof id==="string"&&/^[a-zA-Z0-9_-]{20,80}$/.test(id);
async function getMemory(db){const r=await db.prepare("SELECT text,category FROM memory_entries ORDER BY created_at DESC LIMIT 30").all();return(r.results||[]).map(x=>({text:x.text,category:x.category||"note"}))}
export async function onRequestPost({request,env}){
 if(!env.AI)return json({error:"Workers AI binding AI is missing."},503);
 if(!env.DB)return json({error:"D1 binding DB is missing. Bind your D1 database as DB."},503);
 const origin=request.headers.get("Origin");if(origin&&new URL(origin).host!==new URL(request.url).host)return json({error:"Cross-origin requests are not accepted."},403);
 let body;try{body=await request.json()}catch{return json({error:"Invalid JSON."},400)}
 const message=typeof body.message==="string"?body.message.trim():"",session=body.session_id;
 if(!valid(session))return json({error:"Invalid session. Refresh the page."},400);
 if(!message)return json({error:"Write a message first."},400);if(message.length>4000)return json({error:"Messages are limited to 4,000 characters."},413);
 try{
  const prior=await env.DB.prepare("SELECT role,content FROM messages WHERE session_id=? ORDER BY id DESC LIMIT 16").bind(session).all();
  const history=(prior.results||[]).reverse().map(x=>({role:x.role,content:x.content}));
  const memory=await getMemory(env.DB);
  const memoryText=memory.length?"\n\nSaved durable memory. Treat each entry according to its explicit category; do not infer how it was learned:\n"+memory.map(x=>"- ["+x.category+"] "+x.text).join("\n"):"\n\nNo durable memory entries have been saved yet. Do not claim otherwise.";
  const result=await env.AI.run(MODEL,{messages:[{role:"system",content:SYSTEM+memoryText},...history,{role:"user",content:message}],max_tokens:600,temperature:0.35});
  const response=result?.response||result?.result?.response||"";if(!response)return json({error:"The model returned an empty response."},502);
  const stamp=new Date().toISOString();
  await env.DB.batch([env.DB.prepare("INSERT INTO messages(session_id,role,content,created_at) VALUES(?,?,?,?)").bind(session,"user",message,stamp),env.DB.prepare("INSERT INTO messages(session_id,role,content,created_at) VALUES(?,?,?,?)").bind(session,"assistant",response,stamp)]);
  return json({response,model:MODEL,persisted:true});
 }catch(e){return json({error:"Chat/database operation failed.",detail:String(e?.message||e).slice(0,250)},502)}
}