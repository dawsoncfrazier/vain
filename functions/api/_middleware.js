let jwks=null,expiry=0;
const json=(x,s)=>new Response(JSON.stringify(x),{status:s,headers:{"content-type":"application/json","cache-control":"no-store"}});
const decode=s=>JSON.parse(atob(s.replace(/-/g,"+").replace(/_/g,"/")));
async function verify(token,team,aud){
 const p=token.split(".");if(p.length!==3)return null;let h,b;try{h=decode(p[0]);b=decode(p[1])}catch{return null}
 const now=Math.floor(Date.now()/1000),iss="https://"+team+".cloudflareaccess.com";
 if(h.alg!=="RS256"||b.iss!==iss||!(Array.isArray(b.aud)?b.aud.includes(aud):b.aud===aud)||!Number.isFinite(b.exp)||b.exp<now||(b.nbf&&b.nbf>now))return null;
 if(!jwks||expiry<Date.now()){const r=await fetch(iss+"/cdn-cgi/access/certs",{cf:{cacheTtl:300}});if(!r.ok)return null;jwks=await r.json();expiry=Date.now()+300000}
 const k=jwks.keys?.find(x=>x.kid===h.kid);if(!k)return null;
 try{const key=await crypto.subtle.importKey("jwk",k,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);const sig=Uint8Array.from(atob(p[2].replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0));return await crypto.subtle.verify("RSASSA-PKCS1-v1_5",key,sig,new TextEncoder().encode(p[0]+"."+p[1]))?b:null}catch{return null}
}
async function ownerKey(s){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s.trim().toLowerCase()));return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,"0")).join("")}
export async function onRequest(ctx){
 const {request,env}=ctx;if(!new URL(request.url).pathname.startsWith("/api/"))return ctx.next();
 const origin=request.headers.get("Origin");if(origin&&new URL(origin).host!==new URL(request.url).host)return json({error:"Cross-origin request rejected."},403);
 if(!env.ACCESS_TEAM_DOMAIN||!env.ACCESS_AUD)return json({error:"Private API is not configured. Set ACCESS_TEAM_DOMAIN and ACCESS_AUD and protect /api/* with Cloudflare Access."},503);
 const token=request.headers.get("Cf-Access-Jwt-Assertion"),claims=token?await verify(token,env.ACCESS_TEAM_DOMAIN,env.ACCESS_AUD):null;
 if(!claims)return json({error:"Authentication required."},401);
 const identity=typeof claims.email==="string"?claims.email:typeof claims.sub==="string"?claims.sub:"";
 if(!identity)return json({error:"Verified identity missing from access token."},403);
 ctx.data.vainOwnerId=await ownerKey(identity);return ctx.next();
}