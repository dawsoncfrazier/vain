const MODEL = "@cf/meta/llama-3.2-1b-instruct";
const SYSTEM = `You are vAIn Ϙ, an evidence-conscious persistent intelligence research assistant. Treat user statements as their account, not independently verified external fact. Never invent memories, provenance, dates, or instructions. If memory lacks the requested fact, say so plainly. Distinguish user-reported facts, preferences, instructions, conversation events, and external evidence. Never claim consciousness or capabilities not demonstrated.`;
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const valid=id=>typeof id==="string"&&/^[a-zA-Z0-9_-]{20,80}$/.test(id);
async function ensureSchema(db){
 const info=await db.prepare("PRAGMA table_info(memory_entries)").all();
 const cols=new Set((info.results||[]).map(x=>x.name));
 if(!cols.has("category"))await db.prepare("ALTER TABLE memory_entries ADD COLUMN category TEXT NOT NULL DEFAULT 'note'").run();
 const again=await db.prepare("PRAGMA table_info(memory_entries)").all();
 if(!(again.results||[]).some(x=>x.name==="source"))await db.prepare("ALTER TABLE memory_entries ADD COLUMN source TEXT NOT NULL DEFAULT 'unknown'").run();
}
async function getMemory(db){await ensureSchema(db);const r=await db.prepare("SELECT text,category,source,created_at FROM memory_entries ORDER BY id DESC LIMIT 100").all();return r.results||[]}
function directRecall(q,mem){
 const patterns=[[/\\bwhen did i graduate\\b|\\bwhat year did i graduate\\b|\\bgraduation date\\b/i,/graduate|graduat/i],
 [/\\bwhat is my name\\b|\\bwhat's my name\\b/i,/my name is|name:/i],
 [/\\bwhat is my project\\b|\\bwhat project am i building\\b/i,/project|building|developing/i]];
 for(const [question,match] of patterns){if(question.test(q)){const found=mem.filter(x=>match.test(x.text||"")&&["personal_fact","project_fact","preference","instruction"].includes(x.category));if(!found.length)return "I don't have a saved record of that. I won't guess or claim you told me something that isn't in memory.";return "What I have saved:\n"+found.slice(0,8).map(x=>"- ["+x.category+"] "+x.text+" (source: "+(x.source||"not recorded")+")").join("\n")}}
 return null;
}
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
  const autobiographical = /^(?:I(?:\s|')|my\s|we\s|our\s)/i.test(message) && !/\?\s*$/.test(message);
  const shouldRemember = Boolean(explicitRemember || autobiographical);

  const sensitive=/\b(password|passcode|social security|ssn|credit card|bank account|home address|phone number|medical|diagnosis|medication|sexuality|sex life|religion|political affiliation)\b/i.test(message);
  if(!joking&&!sensitive&&shouldRemember){
   const savedText=explicitRemember?explicitRemember[1].trim():message;
   const category=/\b(prefer|like|love|want|use)\b/i.test(message)?"preference":/\b(project|vAIn|vain|build|develop|code|website|app|system|workflow|setup)\b/i.test(message)?"project_fact":"personal_fact";
   await env.DB.prepare("INSERT INTO memory_entries(text,category,created_at) VALUES(?,?,?)").bind(savedText,category,"user_statement",stamp).run();
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