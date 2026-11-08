// Independent PARKMEMOIR email Worker: never bind private D1/secrets to public marketing Worker.
const SITE = "https://parkmemoir.com";
const SERVICE = "https://email.parkmemoir.com";
const ORIGINS = new Set([SITE, "https://www.parkmemoir.com"]);
const CONSENT = "pm-seasonal-updates-v1-2026-11-08";
const enc = new TextEncoder();
const baseHeaders = {"Cache-Control":"no-store, private","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY"};
const respond = (status, data) => new Response(JSON.stringify(data),{status,headers:{...baseHeaders,"Content-Type":"application/json; charset=utf-8"}});
const esc = x => String(x).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function page(status,title,body) {
  const source = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(title)+' · PARKMEMOIR</title></head><body style="font:17px/1.5 system-ui;background:#f7f3ec;padding:25px;color:#292a24"><main style="max-width:640px;margin:auto;background:white;padding:25px;border:1px solid #ddd0bc;border-radius:12px"><h1>'+esc(title)+'</h1>'+body+'<p><a href="'+SITE+'/which-national-parks-are-open-in-winter/">Back to the trip planner</a></p></main></body></html>';
  return new Response(source,{status,headers:{...baseHeaders,"Content-Type":"text/html; charset=utf-8","Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; form-action "+SERVICE+"; base-uri 'none'; frame-ancestors 'none'","X-Robots-Tag":"noindex, nofollow"}});
}
function cors(request,response) {
  const origin=request.headers.get("Origin");
  if(!ORIGINS.has(origin)) return response;
  const h = new Headers(response.headers);
  h.set("Access-Control-Allow-Origin",origin);
  h.set("Access-Control-Allow-Methods","POST, OPTIONS");
  h.set("Access-Control-Allow-Headers","Content-Type");
  h.set("Access-Control-Max-Age","600");
  h.set("Vary","Origin");
  return new Response(response.body,{status:response.status,headers:h});
}
const now=()=>Math.floor(Date.now()/1000);
const validEmail=s=>typeof s==="string" && s.length<=254 && /^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[^\s@<>]{2,}$/.test(s);
const validToken=s=>typeof s==="string"&&/^[a-f0-9]{64}$/.test(s);
const random=()=>[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,"0")).join("");
async function digest(s){return [...new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(s)))].map(x=>x.toString(16).padStart(2,"0")).join("");}
function safeWebUrl(u,official=false) {
  try {const x=new URL(u);
    if(x.protocol!=="https:"||x.username||x.password) return null;
    if(official) return (x.hostname==="nps.gov"||x.hostname.endsWith(".nps.gov"))?x.href:null;
    return ORIGINS.has(x.origin)&&x.pathname.length<=200?x.origin+x.pathname:null;
  } catch{return null;}
}
async function readJSON(request,max=12000) {
  if(!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json"))return null;
  if(Number(request.headers.get("Content-Length")||0)>max)return null;
  const raw=await request.text();
  if(raw.length>max)return null;
  try{return JSON.parse(raw);}catch{return null;}
}
const devices=new Set(["phones","laptop","fridge","blanket","kettle","cpap"]);
const stays=new Set(["dispersed","camping","powered","hotel"]);
const months=new Set(["nov","dec","jan","feb","november","december","january","february"]);
const fridgeModels=new Set(["bodega-t36","bodega-t36-t","bodega-bd45","bodega-tww45","bodega-t50t","bodega-t60","bodega-m60","other"]);
const keys=new Set(["v","park","month","days","stay","load","recharge","method","vehicleConfirmed","portableAway","fridgeW","fridgeModel","fridgePlug","fridgePeak","fridgeOwned","unchecked","sample"]);
function validPlan(p) {
  return p&&typeof p==="object"&&!Array.isArray(p)&&p.v===1&&!Object.keys(p).some(k=>!keys.has(k))
    &&typeof p.park==="string"&&/^[a-z0-9-]{2,50}$/.test(p.park)&&months.has(p.month)&&Number.isInteger(p.days)&&p.days>=1&&p.days<=14
    &&stays.has(p.stay)&&Array.isArray(p.load)&&p.load.length<=6&&new Set(p.load).size===p.load.length&&p.load.every(x=>devices.has(x))
    &&typeof p.recharge==="string"&&p.recharge.length<=12&&["none","daily","2","3","4","5","6","7","8","9","10","11","12","13","14"].includes(p.recharge)
    &&["none","wall","solar","vehicle"].includes(p.method)&&typeof p.vehicleConfirmed==="boolean"&&typeof p.portableAway==="boolean"
    &&typeof p.fridgeW==="number"&&Number.isFinite(p.fridgeW)&&p.fridgeW>=5&&p.fridgeW<=100
    &&fridgeModels.has(p.fridgeModel)&&["unknown","cigarette","other"].includes(p.fridgePlug)
    &&(p.fridgePeak===""||(typeof p.fridgePeak==="number"&&p.fridgePeak>0&&p.fridgePeak<=1000))
    &&["yes","no"].includes(p.fridgeOwned)&&typeof p.sample==="boolean"
    &&Array.isArray(p.unchecked)&&p.unchecked.length<=50&&p.unchecked.every(x=>typeof x==="string"&&x.length<=80&&/^[a-z-]+$/.test(x));
}
async function verified(request,env,token,action) {
  if(!env.TURNSTILE_SECRET_KEY||typeof token!=="string"||token.length<4||token.length>2048)return false;
  const body=new URLSearchParams({secret:env.TURNSTILE_SECRET_KEY,response:token});
  const ip=request.headers.get("CF-Connecting-IP");if(ip)body.set("remoteip",ip);
  try {const r=await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify",{method:"POST",body});
    if(!r.ok)return false;const d=await r.json();return d.success===true&&["parkmemoir.com","www.parkmemoir.com"].includes(d.hostname)&&d.action===action;
  }catch{return false;}
}
async function rate(request,env,category,max) {
  if(!env.SUBSCRIBERS||!env.RATE_HASH_SECRET)return false;
  const day=Math.floor(now()/86400),ip=request.headers.get("CF-Connecting-IP")||"unknown";
  const key=await digest(category+"|"+day+"|"+ip+"|"+env.RATE_HASH_SECRET);
  const r=await env.SUBSCRIBERS.prepare("INSERT INTO pm_seasonal_rate(key,day,attempts) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1 RETURNING attempts").bind(key,day).first();
  return Boolean(r&&r.attempts<=max);
}
async function resend(env,path,method,body) {
  const response=await fetch("https://api.resend.com"+path,{method,headers:{"Authorization":"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
  let data={};try{data=await response.json();}catch{}
  return {ok:response.ok,status:response.status,data};
}
function baseReady(env){return Boolean(env.RESEND_API_KEY&&env.EMAIL_FROM&&env.TURNSTILE_SECRET_KEY&&env.SUBSCRIBERS&&env.RATE_HASH_SECRET);}
function packedPlan(p,base){
  const u=new URL(base),raw=btoa(JSON.stringify(p)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
  u.searchParams.set("plan",raw);if(p.load.includes("fridge"))u.searchParams.set("intent","fridge");return u.href;
}
function planContent(p,link,nps){
  const body=["Your saved Trip & Power Plan","Park: "+p.park.replace(/-/g," "),"Month: "+p.month,"Days: "+p.days,"Stay: "+p.stay,"Devices: "+(p.load.join(", ")||"none"),"12V fridge average: "+p.fridgeW+"W (illustrative, not measured)","Fridge: "+p.fridgeModel,"Startup peak: "+(p.fridgePeak===""?"not confirmed":p.fridgePeak+"W"),"Your saved trip and printable PDF: "+link,"Official NPS conditions: "+nps,"Checklist items marked off: "+(p.unchecked.join(", ")||"none"),"Verify roads, legal camping, loads, compatible cables, charging and weather before departure.","This one-time email did not subscribe you to marketing."].join("\n\n");
  return {subject:"Your PARKMEMOIR Trip & Power Plan",text:body,html:'<main style="max-width:620px;padding:20px;font:16px/1.6 system-ui"><h1>Your saved Trip &amp; Power Plan</h1><p>'+esc(p.days+" days · "+p.park+" · "+p.stay)+'</p><p>Devices: '+esc(p.load.join(", ")||"none")+'</p><p>Estimated fridge average: '+esc(p.fridgeW)+' W (illustrative)</p><p><a href="'+esc(link)+'">Open plan and print PDF</a></p><p><a href="'+esc(nps)+'">Official NPS road and park information</a></p><p>Checklist marked off: '+esc(p.unchecked.join(", ")||"none")+'</p><p style="font-size:12px">You requested this one-time email. No marketing subscription was created. Battery runtime and access are not guaranteed.</p></main>'};
}
async function plan(request,env){
  if(!baseReady(env))return respond(503,{ok:false,error:"Email service not configured"});
  const d=await readJSON(request);
  if(!d||d.requestedOnly!==true||!validEmail(d.email)||!validPlan(d.plan))return respond(400,{ok:false,error:"Invalid plan"});
  const base=safeWebUrl(d.pageUrl),nps=safeWebUrl(d.npsUrl,true);
  if(!base||!nps)return respond(400,{ok:false,error:"Invalid URL"});
  if(!await verified(request,env,d.turnstileToken,"email_plan"))return respond(403,{ok:false,error:"Verification failed"});
  if(!await rate(request,env,"plan",20))return respond(429,{ok:false,error:"Rate limit"});
  const message=planContent(d.plan,packedPlan(d.plan,base),nps);
  const result=await resend(env,"/emails","POST",{from:env.EMAIL_FROM,to:[d.email.trim().toLowerCase()],...message});
  return result.ok?respond(200,{ok:true,status:"accepted"}):respond(502,{ok:false,error:"Provider did not accept email"});
}
async function subscribe(request,env){
  if(!baseReady(env)||!env.SEASONAL_SEGMENT_ID)return respond(503,{ok:false,error:"Subscription not configured"});
  const d=await readJSON(request,4096);
  const email=validEmail(d?.email)?d.email.trim().toLowerCase():null;
  const source=safeWebUrl(d?.sourcePage);
  if(!email||!source||d.consent!==true||d.consentVersion!==CONSENT)return respond(400,{ok:false,error:"Consent required"});
  if(!await verified(request,env,d.turnstileToken,"seasonal_signup"))return respond(403,{ok:false,error:"Verification failed"});
  if(!await rate(request,env,"seasonal",6))return respond(429,{ok:false,error:"Rate limit"});
  const n=now(),token=random(),tokenHash=await digest(token),path=new URL(source).pathname;
  const result=await env.SUBSCRIBERS.prepare("INSERT INTO pm_seasonal_consent(email,status,token_hash,consent_version,source_path,requested_at,expires_at,updated_at) VALUES(?,'pending',?,?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET token_hash=excluded.token_hash, consent_version=excluded.consent_version, source_path=excluded.source_path, requested_at=excluded.requested_at, expires_at=excluded.expires_at, confirmation_sent_at=NULL, updated_at=excluded.updated_at WHERE pm_seasonal_consent.status='pending' AND pm_seasonal_consent.requested_at<?").bind(email,tokenHash,CONSENT,path,n,n+172800,n,n-3600).run();
  const accepted=()=>respond(202,{ok:true,status:"check_inbox_if_eligible"});
  if(!result.meta?.changes)return accepted();
  const link=SERVICE+"/api/seasonal-confirm?token="+token;
  const body={from:env.EMAIL_FROM,to:[email],subject:"Confirm your PARKMEMOIR seasonal updates",text:"You requested occasional national park updates, separate from your trip plan email.\n\nOpen "+link+" and click Confirm subscription. This link expires in 48 hours. If this was not you, ignore it.\n\nThis is not a road-closure alert service."};
  let sent;try{sent=await resend(env,"/emails","POST",body);}catch{}
  if(!sent?.ok){await env.SUBSCRIBERS.prepare("DELETE FROM pm_seasonal_consent WHERE email=? AND token_hash=? AND status='pending'").bind(email,tokenHash).run();return respond(502,{ok:false,error:"Confirmation email not accepted"});}
  await env.SUBSCRIBERS.prepare("UPDATE pm_seasonal_consent SET confirmation_sent_at=?,updated_at=? WHERE email=? AND token_hash=? AND status='pending'").bind(n,n,email,tokenHash).run();
  return accepted();
}
function landing(request){
  const token=new URL(request.url).searchParams.get("token");
  if(!validToken(token))return page(400,"Invalid link","<p>Request a new confirmation email.</p>");
  return page(200,"Confirm seasonal updates",'<p>Optional national park season and packing updates only; not automatic alerts.</p><form method="POST" action="'+SERVICE+'/api/seasonal-confirm"><input type="hidden" name="token" value="'+token+'"><button style="padding:13px;background:#62422c;color:white;border:0;border-radius:8px" type="submit">Confirm subscription</button></form><p>Opening this page alone does not subscribe you.</p>');
}
async function confirm(request,env){
  if(request.method==="GET")return landing(request);
  if(!baseReady(env)||!env.SEASONAL_SEGMENT_ID)return page(503,"Unavailable","<p>Service is not configured.</p>");
  if(request.headers.get("Origin")!==SERVICE)return page(403,"Not allowed","<p>Invalid request origin.</p>");
  if(!request.headers.get("Content-Type")?.startsWith("application/x-www-form-urlencoded"))return page(415,"Invalid form","<p>Use the confirmation button.</p>");
  const raw=await request.text();if(raw.length>250)return page(413,"Invalid form","<p>Form too large.</p>");
  const token=new URLSearchParams(raw).get("token");if(!validToken(token))return page(400,"Invalid link","<p>Request a new link.</p>");
  const th=await digest(token),n=now();
  const row=await env.SUBSCRIBERS.prepare("UPDATE pm_seasonal_consent SET status='confirming',updated_at=? WHERE token_hash=? AND status='pending' AND confirmation_sent_at IS NOT NULL AND expires_at>? RETURNING email").bind(n,th,n).first();
  if(!row)return page(410,"Link unavailable","<p>Expired or already used. Request another link.</p>");
  try{
    const found=await resend(env,"/contacts/"+encodeURIComponent(row.email),"GET");
    let id;
    if(found.ok){if(found.data.unsubscribed===true)throw Error("unsubscribed");id=found.data.id;}
    else if(found.status===404){const created=await resend(env,"/contacts","POST",{email:row.email,unsubscribed:false});if(!created.ok)throw Error("provider");id=created.data.id;}
    else throw Error("lookup");
    if(typeof id!=="string"||!/^[0-9a-f-]{36}$/i.test(id))throw Error("bad ID");
    const segment=await resend(env,"/contacts/"+encodeURIComponent(id)+"/segments/"+encodeURIComponent(env.SEASONAL_SEGMENT_ID),"POST");
    if(!segment.ok)throw Error("segment");
    const done=await env.SUBSCRIBERS.prepare("UPDATE pm_seasonal_consent SET status='confirmed',token_hash=NULL,confirmed_at=?,contact_id=?,updated_at=? WHERE email=? AND token_hash=? AND status='confirming'").bind(n,id,n,row.email,th).run();
    if(!done.meta?.changes)throw Error("DB");
    return page(200,"Subscription confirmed","<p>Thank you. You can unsubscribe from any seasonal email. Trip plan emails remain separate.</p>");
  }catch{
    await env.SUBSCRIBERS.prepare("UPDATE pm_seasonal_consent SET status='pending',updated_at=? WHERE email=? AND token_hash=? AND status='confirming'").bind(now(),row.email,th).run();
    return page(503,"Confirmation incomplete","<p>We could not complete your subscription. Retry the confirmation link.</p>");
  }
}
async function execute(request,env) {
  const pathname=new URL(request.url).pathname;
  if(request.method==="OPTIONS") {
    if(!ORIGINS.has(request.headers.get("Origin"))||!["/api/send-plan","/api/seasonal-subscribe"].includes(pathname))return respond(403,{ok:false,error:"Origin not allowed"});
    return cors(request,new Response(null,{status:204,headers:baseHeaders}));
  }
  if(pathname==="/api/seasonal-confirm")return confirm(request,env);
  if(!["/api/send-plan","/api/seasonal-subscribe"].includes(pathname))return respond(404,{ok:false,error:"Not found"});
  if(request.method!=="POST")return respond(405,{ok:false,error:"Method not allowed"});
  if(!ORIGINS.has(request.headers.get("Origin")))return respond(403,{ok:false,error:"Origin not allowed"});
  try{return pathname==="/api/send-plan"?await plan(request,env):await subscribe(request,env);}
  catch{return respond(503,{ok:false,error:"Email service temporarily unavailable"});}
}
export async function route(request,env){
  if(new URL(request.url).hostname!=="email.parkmemoir.com")return respond(404,{ok:false,error:"Unknown host"});
  return cors(request,await execute(request,env));
}
export async function cleanupExpired(env){
  if(!env.SUBSCRIBERS)return;const n=now();
  await env.SUBSCRIBERS.prepare("DELETE FROM pm_seasonal_consent WHERE status='pending' AND expires_at<?").bind(n).run();
  await env.SUBSCRIBERS.prepare("DELETE FROM pm_seasonal_consent WHERE status='confirming' AND updated_at<? AND expires_at<?").bind(n-3600,n).run();
  await env.SUBSCRIBERS.prepare("DELETE FROM pm_seasonal_rate WHERE day<?").bind(Math.floor(n/86400)-2).run();
}
export default {fetch:route,scheduled:(_event,env,ctx)=>ctx.waitUntil(cleanupExpired(env))};
