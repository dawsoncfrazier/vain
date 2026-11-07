import { runChat, chain } from "../../src/engine.js";
const json=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{"content-type":"application/json","cache-control":"no-store"}});
async function schema(db){await db.batch([
 db.prepare("CREATE TABLE IF NOT EXISTS research_items(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,url TEXT NOT NULL UNIQUE,source TEXT NOT NULL,summary TEXT,published_at TEXT,created_at TEXT NOT NULL)"),
 db.prepare("CREATE TABLE IF NOT EXISTS research_briefings(id INTEGER PRIMARY KEY AUTOINCREMENT,summary TEXT NOT NULL,question TEXT NOT NULL,created_at TEXT NOT NULL)")
])}
function tag(s,n){const m=s.match(new RegExp("<"+n+"[^>]*>([\\s\\S]*?)</"+n+">","i"));return m?m[1].replace(/<!\[CDATA\[|\]\]>/g,"").replace(/<[^>]+>/g," ").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim():""}
async function getFeed(url,source){try{const r=await fetch(url,{headers:{"user-agent":"vAIn-research/1.0 contact: research@vain-byr.pages.dev"},signal:AbortSignal.timeout(9000)});if(!r.ok)return[];const xml=await r.text();return [...xml.matchAll(/<(?:entry|item)\b[\s\S]*?<\/(?:entry|item)>/gi)].slice(0,6).map(m=>{const x=m[0],link=tag(x,"link")||((x.match(/<link[^>]+href=["']([^"']+)/i)||[])[1]||"");return{title:tag(x,"title"),url:link,summary:tag(x,"summary")||tag(x,"description"),published:tag(x,"published")||tag(x,"pubDate"),source}}).filter(x=>x.title&&x.url&&/^https:\/\//.test(x.url))}catch{return[]}}
async function refresh(env){
 const feeds=await Promise.all([
 getFeed("https://export.arxiv.org/api/query?search_query=cat:cs.AI&sortBy=submittedDate&sortOrder=descending&max_results=6","arXiv · AI research"),
 getFeed("https://www.nasa.gov/feed/","NASA"),
 getFeed("https://hnrss.org/frontpage","Hacker News")
 ]);
 const items=feeds.flat().slice(0,18),now=new Date().toISOString();
 for(const x of items){await env.DB.prepare("INSERT OR IGNORE INTO research_items(title,url,source,summary,published_at,created_at) VALUES(?,?,?,?,?,?)").bind(x.title,x.url,x.source,x.summary.slice(0,3000),x.published,now).run()}
 const rows=await env.DB.prepare("SELECT title,url,source,summary,published_at FROM research_items ORDER BY id DESC LIMIT 12").all();
 if(!rows.results?.length)return null;
 let summary="New items collected from free public feeds. Open sources to inspect original evidence.";
 let question="Which new development, if any, should change vAIn's research priorities?";
 if(chain(env,"light").length){try{const input=rows.results.slice(0,8).map(x=>({title:x.title,source:x.source,summary:(x.summary||"").slice(0,500),url:x.url}));const out=await runChat(env,[{role:"system",content:"You are vAIn's evidence-conscious research analyst. Based only on supplied source metadata/snippets, produce a concise 3-5 sentence briefing. Do not claim to have read full papers. Separate established facts from claims. Then propose ONE genuinely consequential open question for the user's research direction. Output JSON only: {summary:string,question:string}."},{role:"user",content:JSON.stringify(input)}],{tier:"light",max_tokens:450,temperature:0.2});const raw=out.text||"";const parsed=JSON.parse(raw.slice(raw.indexOf("{"),raw.lastIndexOf("}")+1));if(parsed.summary)summary=parsed.summary;if(parsed.question)question=parsed.question}catch{}}
 await env.DB.prepare("INSERT INTO research_briefings(summary,question,created_at) VALUES(?,?,?)").bind(summary,question,now).run();
 return {summary,question,created_at:now,items:rows.results};
}
export async function onRequestGet({env}){if(!env.DB)return json({error:"D1 is unavailable"},503);try{await schema(env.DB);const latest=await env.DB.prepare("SELECT * FROM research_briefings ORDER BY id DESC LIMIT 1").first();let briefing=latest;if(!latest||Date.now()-Date.parse(latest.created_at)>6*3600000)briefing=await refresh(env)||latest;const items=await env.DB.prepare("SELECT title,url,source,summary,published_at,created_at FROM research_items ORDER BY id DESC LIMIT 18").all();return json({briefing,items:items.results||[],refresh_interval_hours:6,mode:"refreshes on workspace visits; scheduled background execution requires a separate Cron Worker"})}catch(e){return json({error:"Research failed",detail:String(e.message||e)},500)}}
export async function onRequestPost({env}){if(!env.DB)return json({error:"D1 is unavailable"},503);try{await schema(env.DB);const b=await refresh(env);return json({ok:Boolean(b),briefing:b})}catch(e){return json({error:"Research refresh failed",detail:String(e.message||e)},500)}}
