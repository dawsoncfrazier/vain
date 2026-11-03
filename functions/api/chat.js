const MODEL = "@cf/meta/llama-3.2-1b-instruct";
const SYSTEM = `You are vAIn Ϙ, a persistent intelligence research assistant. Treat what the user tells you as their sincere account by default, unless they clearly mark it as a joke or correct themselves. Accept their statements about their own experiences, preferences, intentions, and projects as user-reported truth; do not claim they never told you something when it appears in the conversation or saved memory. This is not independent verification of external facts. Do not invent details. If humor is ambiguous, do not confidently label it a joke; respond to the apparent meaning and allow correction.
The user's project is called vAIn Ϙ. Its goal is to build a persistent AI workspace supporting continuity of identity, durable knowledge, careful reasoning, scientific experimentation, and responsible development.
Be precise and transparent. Distinguish saved facts from inference. Never invent memories or claim consciousness, independent agency, quantum advantage, or capabilities not demonstrated. Treat quantum simulations as classical computations unless proven otherwise.
Memory interpretation rules:
- personal_fact and project_fact entries are facts asserted in saved memory. State them as facts, not as instructions or requests.
- preference entries describe user preferences; instruction entries describe requested behavior.
- conversation_event entries describe something that happened in a conversation, not necessarily a verified real-world fact.
- note entries are unclassified and must not be assigned a stronger meaning than their wording supports.
- Automatically saved user statements are the user's own account, not independently verified facts. Preserve what they said without inventing provenance.
- Never claim the user asked, told, or instructed you to say something unless a saved instruction or conversation_event explicitly supports that claim.
- Never invent the origin, date, source, or circumstances of a saved fact. If asked where a fact came from and the memory does not record its source, say the source is not recorded.
- If the database contains no relevant memory, say you do not have that information rather than fabricate it.`;
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const valid=id=>typeof id==="string"&&/^[a-zA-Z0-9_-]{20,80}$/.test(id);
async function ensureMemorySchema(db){
 const info=await db.prepare("PRAGMA table_info(memory_entries)").all();
 if((info.results||[]).some(column=>column.name==="category"))return;
 try{await db.prepare("ALTER TABLE memory_entries ADD COLUMN category TEXT NOT NULL DEFAULT 'note'").run()}
 catch(error){const retry=await db.prepare("PRAGMA table_info(memory_entries)").all();if(!(retry.results||[]).some(column=>column.name==="category"))throw error}
}
async function getMemory(db){await ensureMemorySchema(db);const r=await db.prepare("SELECT text,category FROM memory_entries ORDER BY id DESC LIMIT 40").all();return(r.results||[]).map(x=>({text:x.text,category:x.category||"note"}))}
export async function onRequestPost({request,env}){
 if(!env.AI)return json({error:"Workers AI binding AI is missing."},503);
 if(!env.DB)return json({error:"D1 binding DB is missing. Bind your D1 database as DB."},503);
 const origin=request.headers.get("Origin");if(origin&&new URL(origin).host!==new URL(request.url).host)return json({error:"Cross-origin requests are not accepted."},403);
 let body;try{body=await request.json()}catch{return json({error:"Invalid JSON."},400)}
 const message=typeof body.message==="string"?body.message.trim():"",session=body.session_id;
 if(!valid(session))return json({error:"Invalid session. Refresh the page."},400);
 if(!message)return json({error:"Write a message first."},400);if(message.length>4000)return json({error:"Messages are limited to 4,000 characters."},413);
 try{
  const stamp=new Date().toISOString();
  const explicitForget=message.match(/^(?:please\s+)?forget(?:\s+that)?\s+(.+)$/i);
  if(explicitForget){
   const term=explicitForget[1].trim();
   const found=await env.DB.prepare("SELECT id FROM memory_entries WHERE instr(lower(text),lower(?))>0 ORDER BY id DESC LIMIT 2").bind(term).all();
   if(found.results?.length===1){await env.DB.prepare("DELETE FROM memory_entries WHERE id=?").bind(found.results[0].id).run();const response="I removed the matching saved memory.";await env.DB.batch([env.DB.prepare("INSERT INTO messages(session_id,role,content,created_at) VALUES(?,?,?,?)").bind(session,"user",message,stamp),env.DB.prepare("INSERT INTO messages(session_id,role,content,created_at) VALUES(?,?,?,?)").bind(session,"assistant",response,stamp)]);return json({response,persisted:true,memory_action:"deleted"})}
   if(found.results?.length>1)return json({response:"I found more than one matching memory. Please be more specific so I don't remove the wrong one.",persisted:false});
   return json({response:"I couldn't find a saved memory matching that wording.",persisted:false});
  }
  const explicitRemember=message.match(/^(?:remember(?:\s+that)?|keep\s+in\s+mind(?:\s+that)?)\s+(.{5,3000})$/i);
  const preference=message.match(/^(?:I\s+(?:prefer|like|love|want|use|am\s+building|am\s+working\s+on)|my\s+(?:project|workflow|setup)\s+(?:is|uses|needs))\b/i);
  const joking=/\b(just kidding|jk|i am joking|i'm joking|im joking|that was a joke)\b/i.test(message);
  const autobiographical = /^(?:I(?:\\s|')|my\\s|we\\s|our\\s)/i.test(message) && !/\\?\\s*$/.test(message);
  const shouldRemember = Boolean(explicitRemember || autobiographical);

  const sensitive=/\b(password|passcode|social security|ssn|credit card|bank account|home address|phone number|medical|diagnosis|medication|sexuality|sex life|religion|political affiliation)\b/i.test(message);
  if(!joking&&!sensitive&&shouldRemember){
   const savedText=explicitRemember?explicitRemember[1].trim():message;
   const category=/\b(prefer|like|love|want|use)\b/i.test(message)?"preference":/\b(project|vAIn|vain|build|develop|code|website|app|system|workflow|setup)\b/i.test(message)?"project_fact":"personal_fact";
   await env.DB.prepare("INSERT INTO memory_entries(text,category,created_at) VALUES(?,?,?)").bind(savedText,category,stamp).run();
   await env.DB.prepare("DELETE FROM memory_entries WHERE category IN ('personal_fact','project_fact','preference') AND id NOT IN (SELECT id FROM memory_entries WHERE category IN ('personal_fact','project_fact','preference') ORDER BY id DESC LIMIT 200)").run();
  }
  const prior=await env.DB.prepare("SELECT role,content FROM messages WHERE session_id=? ORDER BY id DESC LIMIT 16").bind(session).all();
  const history=(prior.results||[]).reverse().map(x=>({role:x.role,content:x.content}));
  const memory=await getMemory(env.DB);
  const memoryText=memory.length?"\n\nSaved durable memory. Treat each entry according to its explicit category; do not infer how it was learned:\n"+memory.map(x=>"- ["+x.category+"] "+x.text).join("\n"):"\n\nNo durable memory entries have been saved yet. Do not claim otherwise.";
  const result=await env.AI.run(MODEL,{messages:[{role:"system",content:SYSTEM+memoryText},...history,{role:"user",content:message}],max_tokens:600,temperature:0.35});
  const response=result?.response||result?.result?.response||"";if(!response)return json({error:"The model returned an empty response."},502);
  await env.DB.batch([env.DB.prepare("INSERT INTO messages(session_id,role,content,created_at) VALUES(?,?,?,?)").bind(session,"user",message,stamp),env.DB.prepare("INSERT INTO messages(session_id,role,content,created_at) VALUES(?,?,?,?)").bind(session,"assistant",response,stamp)]);
  return json({response,model:MODEL,persisted:true});
 }catch(e){return json({error:"Chat/database operation failed.",detail:String(e?.message||e).slice(0,250)},502)}
}