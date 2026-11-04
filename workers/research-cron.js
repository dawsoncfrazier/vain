import { onRequestGet } from "../functions/api/research.js";
export default {
 async scheduled(controller,env,ctx){
  ctx.waitUntil(onRequestGet({env}).then(async response=>{
   if(!response.ok)throw new Error("Research refresh failed: "+response.status+" "+await response.text());
  }));
 }
};
