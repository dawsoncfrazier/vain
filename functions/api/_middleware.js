let jwksCache=null, jwksExpiry=0;
const json=(body,status)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
async function verifyAccess(token,team,aud){
 const parts=token.split(".");if(parts.length!==3)return false;
 let header,payload;try{header=JSON.parse(atob(parts[0].replace(/-/g,"+").replace(/_/g,"/")));payload=JSON.parse(atob(parts[1].replace(/-/g,"+").replace(/_/g,"/")))}catch{return false}
 const now=Math.floor(Date.now()/1000),issuer="https://"+team+".cloudflareaccess.com";
 if(header.alg!=="RS256"||payload.iss!==issuer||!(Array.isArray(payload.aud)?payload.aud.includes(aud):payload.aud===aud)||!Number.isFinite(payload.exp)||payload.exp<now||(payload.nbf&&payload.nbf>now))return false;
 if(!jwksCache||jwksExpiry<Date.now()){const r=await fetch(issuer+"/cdn-cgi/access/certs",{cf:{cacheTtl:300}});if(!r.ok)return false;jwksCache=await r.json();jwksExpiry=Date.now()+300000}
 const jwk=jwksCache.keys?.find(k=>k.kid===header.kid);if(!jwk)return false;
 try{const key=await crypto.subtle.importKey("jwk",jwk,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);const sig=Uint8Array.from(atob(parts[2].replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0));return await crypto.subtle.verify("RSASSA-PKCS1-v1_5",key,sig,new TextEncoder().encode(parts[0]+"."+parts[1]))}catch{return false}
}
export async function onRequest({request,env,next}){
 const path=new URL(request.url).pathname;
 if(!path.startsWith("/api/"))return next();
 const origin=request.headers.get("Origin");if(origin&&new URL(origin).host!==new URL(request.url).host)return json({error:"Cross-origin API requests are not accepted."},403);
 if(!env.ACCESS_TEAM_DOMAIN||!env.ACCESS_AUD)return json({error:"Private API is not configured. Set ACCESS_TEAM_DOMAIN and ACCESS_AUD, then protect /api/* with Cloudflare Access."},503);
 const token=request.headers.get("Cf-Access-Jwt-Assertion");if(!token||!(await verifyAccess(token,env.ACCESS_TEAM_DOMAIN,env.ACCESS_AUD)))return json({error:"Authentication required. Sign in through the private vAIn access portal."},401);
 return next();
}
