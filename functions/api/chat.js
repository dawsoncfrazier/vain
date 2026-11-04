const MODEL="@cf/meta/llama-3.2-1b-instruct";
const SYSTEM="You are vAIn Ϙ, an evidence-conscious persistent intelligence research assistant. Never invent memories, provenance, dates, or instructions. If memory lacks a fact, say so. Distinguish user-reported facts from external evidence. Never claim capabilities not demonstrated.";
const json=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const valid=s=>typeof s==="string"&&/^[a-zA-Z0-9_-]{20,80}$/.test(s);
function recall(q,mem){
 const p=[[/\bwhen did i graduate\b|\bwhat year did i graduate\b|\bgraduation date\b/i,/graduate|graduat/i],[/\bwhat is my name\b|\bwhat's my name\b/i,/my name is|name:/i],[/\bwhat is my project\b|\bwhat project am i building\b/i,/project|building|developing/i]];
 for(const [qre,mre] of p)if(qre.test(q)){const a=mem.filter(x=>mre.test(x.text||"")&&["personal_fact","project_fact","preference","instruction"].includes(x.category));return a.length?"What I have saved:\n"+a.slice(0,8).map(x=>"- ["+x.category+"] "+x.text+" (source: "+(x.source||"unknown")+")").join("\n"):"I don't have a saved record of that. I won't guess or claim you told me something that isn't in memory."}
 return null;
}
const stop=new Set(["what","when","where","which","who","how","does","did","the","and","you","your","my","for","are","was","is","have","has","tell","show","about"]);
function relevant(q,mem){const terms=[...new Set((q.toLowerCase().match(/[a-z0-9]{3,}/g)||[]).filter(x=>!stop.has(x)))];return mem.map((m,i)=>({m,i,n:terms.reduce((n,t)=>n+((m.text||"").toLowerCase().includes(t)?1:0),0)})).sort((a,b)=>b.n-a.n||a.i-b.i).slice(0,20).map(x=>x.m)}
function category(s){if(/\b(prefer|like|love|want|rather)\b/i.test(s))return"preference";if(/\b(always|never|from now on|please use|don't use|do not use)\b/i.test(s))return"instruction";if(/\b(project|vAIn|vain|build|develop|code|website|app|system|workflow|setup)\b/i.test(s))return"project_fact";return"personal_fact"}
async function exchange(db,owner,session,u,a,stamp){await db.batch([db.prepare("INSERT INTO messages(owner_id,session_id,role,content,created_at) VALUES(?,?,?,?,?)").bind(owner,session,"user",u,stamp),db.prepare("INSERT INTO messages(owner_id,session_id,role,content,created_at) VALUES(?,?,?,?,?)").bind(owner,session,"assistant",a,stamp)])}
export async function onRequestPost({request,env,data}){
 const owner=data?.vainOwnerId;if(!owner)return json({error:"Authentication required."},401);if(!env.AI||!env.DB)return json({error:"Workers AI or D1 binding is missing."},503);
 let b;try{b=await request.json()}catch{return json({error:"Invalid JSON."},400)}
 const q=typeof b.message==="string"?b.message.trim():"",session=b.session_id;if(!valid(session))return json({error:"Invalid session id."},400);if(!q)return json({error:"Write a message first."},400);if(q.length>4000)return json({error:"Message too long."},413);
 const stamp=new Date().toISOString();
 try{
  const forget=q.match(/^(?:please\s+)?forget(?:\s+that)?\s+(.+)$/i);
  if(forget){const found=await env.DB.prepare("SELECT id FROM memory_entries WHERE owner_id=? AND instr(lower(text),lower(?))>0 ORDER BY id DESC LIMIT 2").bind(owner,forget[1].trim()).all();let response;if(found.results?.length===1){await env.DB.prepare("DELETE FROM memory_entries WHERE owner_id=? AND id=?").bind(owner,found.results[0].id).run();response="I removed the matching saved memory."}else response=found.results?.length?"More than one memory matches. Please be more specific.":"I couldn't find a matching saved memory.";await exchange(env.DB,owner,session,q,response,stamp);return json({response,persisted:true,memory_action:found.results?.length===1?"deleted":null})}
  const remember=q.match(/^(?:remember(?:\s+that)?|keep\s+in\s+mind(?:\s+that)?)\s+(.{5,3000})$/i);let saved=null,blocked=false;
  if(remember){const text=remember[1].trim();if(/\b(password|passcode|api key|secret key|social security|ssn|credit card|bank account|home address|phone number|medical record|diagnosis|medication)\b/i.test(text)){blocked=true}else{const cat=category(text),r=await env.DB.prepare("INSERT INTO memory_entries(owner_id,text,category,source,created_at) VALUES(?,?,?,?,?)").bind(owner,text,cat,"explicit_user_request",stamp).run();saved={id:r.meta?.last_row_id,text,category:cat}}}
  const old=await env.DB.prepare("SELECT role,content FROM messages WHERE owner_id=? AND session_id=? ORDER BY id DESC LIMIT 16").bind(owner,session).all();
  const all=await env.DB.prepare("SELECT text,category,source,created_at FROM memory_entries WHERE owner_id=? ORDER BY id DESC LIMIT 200").bind(owner).all(),mem=all.results||[];
  let response=recall(q,mem);if(!response&&blocked)response="I can’t store passwords, access keys, financial credentials, or highly sensitive personal details.";if(!response&&saved)response="Saved to long-term memory: "+saved.text;
  if(!response){const rel=relevant(q,mem),ctx=rel.length?"\nRelevant saved memory (user-reported):\n"+rel.map(x=>"- ["+x.category+"; source: "+x.source+"] "+x.text).join("\n"):"\nNo relevant saved memory found. Do not claim otherwise.";const history=(old.results||[]).reverse().map(x=>({role:x.role,content:x.content}));const out=await env.AI.run(MODEL,{messages:[{role:"system",content:SYSTEM+ctx},...history,{role:"user",content:q}],max_tokens:600,temperature:.35});response=out?.response||out?.result?.response||"";if(!response)return json({error:"Model returned an empty response."},502)}
  await exchange(env.DB,owner,session,q,response,stamp);return json({response,model:MODEL,persisted:true,memory_action:saved?{action:"saved",...saved}:null});
 }catch(e){return json({error:"Chat/database operation failed.",detail:String(e?.message||e).slice(0,250)},502)}
}