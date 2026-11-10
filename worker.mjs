// Independent PARKMEMOIR email Worker: never bind private D1/secrets to public marketing Worker.
const SITE = "https://parkmemoir.com";
const SERVICE = "https://email.parkmemoir.com";
const ORIGINS = new Set([SITE, "https://www.parkmemoir.com"]);
const CONSENT = "pm-seasonal-updates-v1-2026-11-08";
const enc = new TextEncoder();
const baseHeaders = {"Cache-Control":"no-store, private","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY"};
const respond = (status, data) => new Response(JSON.stringify(data),{status,headers:{...baseHeaders,"Content-Type":"application/json; charset=utf-8"}});
const esc = x => String(x).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function page(status,title,body,{nonce}={}) {
  const source = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(title)+' · PARKMEMOIR</title></head><body style="font:17px/1.5 system-ui;background:#f7f3ec;padding:25px;color:#292a24"><main style="max-width:640px;margin:auto;background:white;padding:25px;border:1px solid #ddd0bc;border-radius:12px"><h1>'+esc(title)+'</h1>'+body+'<p><a href="'+SITE+'/which-national-parks-are-open-in-winter/">Back to the trip planner</a></p></main></body></html>';
  const csp="default-src 'none'; style-src 'unsafe-inline'; form-action "+SERVICE+"; base-uri 'none'; frame-ancestors 'none'"+(nonce?"; script-src 'nonce-"+nonce+"'; connect-src 'self'":"");
  return new Response(source,{status,headers:{...baseHeaders,"Content-Type":"text/html; charset=utf-8","Content-Security-Policy":csp,"X-Robots-Tag":"noindex, nofollow"}});
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
async function verified(request,env,token,action,hostnames=["parkmemoir.com","www.parkmemoir.com"]) {
  if(!env.TURNSTILE_SECRET_KEY||typeof token!=="string"||token.length<4||token.length>2048)return false;
  const body=new URLSearchParams({secret:env.TURNSTILE_SECRET_KEY,response:token});
  const ip=request.headers.get("CF-Connecting-IP");if(ip)body.set("remoteip",ip);
  try {const r=await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify",{method:"POST",body});
    if(!r.ok)return false;const d=await r.json();return d.success===true&&hostnames.includes(d.hostname)&&d.action===action;
  }catch{return false;}
}
async function rate(request,env,category,max) {
  if(!env.SUBSCRIBERS||!env.RATE_HASH_SECRET)return false;
  const day=Math.floor(now()/86400),ip=request.headers.get("CF-Connecting-IP")||"unknown";
  const key=await digest(category+"|"+day+"|"+ip+"|"+env.RATE_HASH_SECRET);
  const r=await env.SUBSCRIBERS.prepare("INSERT INTO pm_seasonal_rate(key,day,attempts) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1 RETURNING attempts").bind(key,day).first();
  return Boolean(r&&r.attempts<=max);
}
async function resend(env,path,method,body,{contacts=false,idempotencyKey}={}) {
  // Sending has a domain-restricted key; marketing Contact/Segment access is a distinct secret.
  const key=contacts?env.RESEND_CONTACTS_API_KEY:env.RESEND_API_KEY;
  if(!key)throw Error("Resend credential unavailable");
  const headers={"Authorization":"Bearer "+key,"Content-Type":"application/json","User-Agent":"parkmemoir-email-service/1.0"};
  if(idempotencyKey)headers["Idempotency-Key"]=idempotencyKey;
  const response=await fetch("https://api.resend.com"+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});
  let data={};try{data=await response.json();}catch{}
  return {ok:response.ok,status:response.status,data};
}
function baseReady(env){return Boolean(env.RESEND_API_KEY&&env.EMAIL_FROM&&env.TURNSTILE_SECRET_KEY&&env.SUBSCRIBERS&&env.RATE_HASH_SECRET);}

// The complete printable report must come from the existing Winter Planner's
// preparePrint() DOM. The Worker never reconstructs a reduced PDF from plan fields.
const FULL_PRINT_VERSION="winter-full-print-v12.5";
function validPrintSnapshot(s){
  if(!s||typeof s!=="object"||Array.isArray(s)||s.version!==FULL_PRINT_VERSION)return false;
  if(typeof s.markup!=="string"||s.markup.length<200||s.markup.length>160000)return false;
  if(typeof s.css!=="string"||s.css.length<100||s.css.length>100000)return false;
  // The source is the existing complete #print-plan subtree and the site's
  // print stylesheet, not a separately written report.
  if(!/id=["']print-plan["']/i.test(s.markup))return false;
  for(const label of ["Access &amp; stay notes","Your packing checklist","Recommended products","Affiliate disclosure"]){
    if(!s.markup.includes(label))return false;
  }
  const riskyMarkup=/<\s*\/?\s*(?:script|iframe|frame|object|embed|link|meta|base|form|video|audio)\b|on[a-z]{3,}\s*=|javascript\s*:|data\s*:\s*text\/html/i;
  if(riskyMarkup.test(s.markup))return false;
  if(/<\s*\/?\s*style\b/i.test(s.markup))return false;
  // Block arbitrary network-backed resources from user-supplied markup/CSS.
  if(/url\s*\(\s*["']?\s*(?:https?:|\/\/)/i.test(s.css+s.markup))return false;
  if(/@import\b|<\/style|<\/head|<\/body|<html\b/i.test(s.css))return false;
  const srcs=[...s.markup.matchAll(/<img\b[^>]*?\bsrc=["']([^"']+)["']/gi)];
  if(srcs.some(m=>!/^data:image\/(?:png|webp|jpeg);base64,[A-Za-z0-9+/=]+$/i.test(m[1])))return false;
  return true;
}
function buildPrintableHtml(s){
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+
    s.css+'</style></head><body>'+s.markup+'</body></html>';
}
function encodeBase64Bytes(bytes){
  let binary="";
  for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(binary);
}
export async function renderFullPrintPdf(env,snapshot){
  if(!validPrintSnapshot(snapshot)||!env.BROWSER?.quickAction)throw Error("full print report unavailable");
  const response=await env.BROWSER.quickAction("pdf",{
    html:buildPrintableHtml(snapshot),
    pdfOptions:{format:"a4",printBackground:true,preferCSSPageSize:true},
    // Links remain clickable in PDF; no external resources are fetched.
    rejectRequestPattern:["/^https?:\\/\\//"],
  });
  if(!response.ok)throw Error("PDF renderer unavailable");
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes.length<500||bytes.length>5*1024*1024)throw Error("invalid PDF size");
  const header=new TextDecoder("latin1").decode(bytes.subarray(0,8));
  const tail=new TextDecoder("latin1").decode(bytes.subarray(Math.max(0,bytes.length-1024)));
  if(!header.startsWith("%PDF-")||!tail.includes("%%EOF"))throw Error("invalid PDF bytes");
  return {filename:"PARKMEMOIR_Full_Winter_Trip_Plan.pdf",content:encodeBase64Bytes(bytes)};
}
function planContent(p,nps){
  const body=[
    "Your complete PARKMEMOIR winter trip planner PDF is attached.",
    "Park: "+p.park.replace(/-/g," "),"Month: "+p.month,"Days: "+p.days,"Stay: "+p.stay,
    "The attached document includes the full trip and access notes, packing checklist, matched product/booking links, and affiliate disclosure.",
    "Official NPS information: "+nps,
    "Check live road and campground status, weather, and product specifications before you travel.",
    "This one-time email did not subscribe you to marketing."
  ].join("\n\n");
  return {subject:"Your full PARKMEMOIR Winter Trip Plan (PDF attached)",text:body,
    html:'<main style="max-width:620px;padding:20px;font:16px/1.6 system-ui"><h1>Your complete winter trip PDF is attached</h1><p>'+esc(p.days+" days | "+p.park+" | "+p.stay)+'</p><p>This is your complete printable plan with personalized access information, packing checklist, equipment and booking recommendations, and affiliate disclosure. No old website print link is needed.</p><p><a href="'+esc(nps)+'">Official NPS information</a></p><p style="font-size:12px">One-time email only; no marketing subscription. Always verify current conditions.</p></main>'};
}
async function plan(request,env){
  if(!baseReady(env))return respond(503,{ok:false,error:"Email service not configured"});
  const d=await readJSON(request,350000);
  if(!d||d.requestedOnly!==true||!validEmail(d.email)||!validPlan(d.plan))return respond(400,{ok:false,error:"Invalid plan"});
  if(!validPrintSnapshot(d.printSnapshot))return respond(400,{ok:false,error:"Complete printable report required"});
  const base=safeWebUrl(d.pageUrl),nps=safeWebUrl(d.npsUrl,true);
  if(!base||!nps)return respond(400,{ok:false,error:"Invalid URL"});
  if(!await verified(request,env,d.turnstileToken,"email_plan"))return respond(403,{ok:false,error:"Verification failed"});
  if(!await rate(request,env,"plan",20))return respond(429,{ok:false,error:"Rate limit"});
  const message=planContent(d.plan,nps);
  const pdf=await renderFullPrintPdf(env,d.printSnapshot);
  message.attachments=[pdf];
  const recipient=d.email.trim().toLowerCase();
  // Resend deduplicates repeated identical requests within 24 hours.
  // Never put a raw email address or unkeyed identifying hash in request headers.
  const key="pm-full-print-v125-"+await digest(["full-print-v12.5",env.RATE_HASH_SECRET,recipient,JSON.stringify(d.plan),d.printSnapshot.markup,d.printSnapshot.css,Math.floor(now()/600)].join("|"));
  const result=await resend(env,"/emails","POST",{from:env.EMAIL_FROM,to:[recipient],...message},{idempotencyKey:key});
  return result.ok?respond(200,{ok:true,status:"accepted"}):respond(502,{ok:false,error:"Provider did not accept email"});
}
async function subscribe(request,env){
  if(!baseReady(env)||!env.SEASONAL_SEGMENT_ID||!env.SEASONAL_TOPIC_ID||!env.RESEND_CONTACTS_API_KEY)return respond(503,{ok:false,error:"Subscription not configured"});
  const d=await readJSON(request,4096);
  const email=validEmail(d?.email)?d.email.trim().toLowerCase():null;
  const source=safeWebUrl(d?.sourcePage);
  if(!email||!source||d.consent!==true||d.consentVersion!==CONSENT)return respond(400,{ok:false,error:"Consent required"});
  if(!await verified(request,env,d.turnstileToken,"seasonal_signup"))return respond(403,{ok:false,error:"Verification failed"});
  if(!await rate(request,env,"seasonal",6))return respond(429,{ok:false,error:"Rate limit"});
  return requestSeasonalConsent(env,email,new URL(source).pathname);
}
async function requestSeasonalConsent(env,email,path){
  const n=now(),token=random(),tokenHash=await digest(token);
  const result=await env.SUBSCRIBERS.prepare("INSERT INTO pm_seasonal_consent(email,status,token_hash,consent_version,source_path,requested_at,expires_at,updated_at) VALUES(?,'pending',?,?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET token_hash=excluded.token_hash, consent_version=excluded.consent_version, source_path=excluded.source_path, requested_at=excluded.requested_at, expires_at=excluded.expires_at, confirmation_sent_at=NULL, updated_at=excluded.updated_at WHERE pm_seasonal_consent.status='pending' AND pm_seasonal_consent.requested_at<?").bind(email,tokenHash,CONSENT,path,n,n+172800,n,n-3600).run();
  const accepted=()=>respond(202,{ok:true,status:"check_inbox_if_eligible"});
  if(!result.meta?.changes)return accepted();
  const link=SERVICE+"/api/seasonal-confirm?token="+token+"#confirm";
  const body={from:env.EMAIL_FROM,to:[email],subject:"Confirm your PARKMEMOIR seasonal updates",
    text:"You requested occasional national park updates, separate from your trip plan email.\n\nConfirm your subscription with this one-click link:\n"+link+"\n\nThis link expires in 48 hours. If this was not you, ignore it. This is not a road-closure alert service.",
    html:'<main style="font:16px/1.6 system-ui;max-width:600px;padding:22px"><h1>Confirm your PARKMEMOIR seasonal updates</h1><p>You requested occasional national park and packing updates. This is optional and separate from your trip plan email.</p><p><a href="'+esc(link)+'" style="display:inline-block;padding:12px 20px;background:#62422c;color:white;text-decoration:none;border-radius:7px;font-weight:700">Confirm my subscription</a></p><p style="font-size:13px;color:#555">One click completes your confirmation in your browser. Link expires in 48 hours. If you did not request this, ignore it.</p></main>'};
  let sent;try{sent=await resend(env,"/emails","POST",body);}catch{}
  if(!sent?.ok){await env.SUBSCRIBERS.prepare("DELETE FROM pm_seasonal_consent WHERE email=? AND token_hash=? AND status='pending'").bind(email,tokenHash).run();return respond(502,{ok:false,error:"Confirmation email not accepted"});}
  await env.SUBSCRIBERS.prepare("UPDATE pm_seasonal_consent SET confirmation_sent_at=?,updated_at=? WHERE email=? AND token_hash=? AND status='pending'").bind(n,n,email,tokenHash).run();
  return accepted();
}
function landing(request){
  const token=new URL(request.url).searchParams.get("token");
  if(!validToken(token))return page(400,"Invalid link","<p>Request a new confirmation email.</p>");
  // The fragment #confirm never reaches the server. Email link scanners performing
  // plain GET cannot change consent. Only a browser that follows the explicit
  // email button and executes the short, nonce-authorized script POSTs the token.
  // A manual POST fallback remains available when JavaScript is disabled.
  const nonce=random();
  const script='(async()=>{'+
    'if(location.hash!=="#confirm")return;'+
    'const f=document.getElementById("pm-doi-form"),s=document.getElementById("pm-doi-status");'+
    'const b=f.querySelector("button");b.hidden=true;s.textContent="Confirming your subscription…";'+
    'try{'+
      'const p=new URLSearchParams(new FormData(f));'+
      'const r=await fetch(f.action,{method:"POST",body:p,headers:{"Content-Type":"application/x-www-form-urlencoded"},credentials:"same-origin",cache:"no-store"});'+
      'try{history.replaceState(null,"",location.pathname)}catch{}'+
      'if(r.ok){s.textContent="Subscription confirmed. Thank you.";f.remove();document.title="Subscription confirmed · PARKMEMOIR";return;}'+
      'if(r.status===410){s.textContent="This confirmation link has expired or has already been used. Request a new email.";f.remove();return;}'+
      's.textContent="Confirmation could not be completed. Try again below.";b.hidden=false;'+
    '}catch{s.textContent="Confirmation could not be completed. Try again below.";b.hidden=false;}'+
  '})();';
  const form='<p id="pm-doi-status" role="status">Your seasonal updates confirmation is ready.</p>'+
    '<form id="pm-doi-form" method="POST" action="'+SERVICE+'/api/seasonal-confirm">'+
    '<input type="hidden" name="token" value="'+token+'">'+
    '<button style="padding:13px;background:#62422c;color:white;border:0;border-radius:8px" type="submit">Confirm manually if needed</button></form>'+
    '<p style="font-size:13px">This confirmation requires the email-only token. A preview of the link never subscribes you.</p>'+
    '<script nonce="'+nonce+'">'+script+'</script>';
  return page(200,"Confirm seasonal updates",form,{nonce});
}
async function confirm(request,env){
  if(request.method==="GET")return landing(request);
  if(!baseReady(env)||!env.SEASONAL_SEGMENT_ID||!env.SEASONAL_TOPIC_ID||!env.RESEND_CONTACTS_API_KEY)return page(503,"Unavailable","<p>Service is not configured.</p>");
  // This is a token-authenticated, one-time, email-only confirmation POST.
  // Some email clients and privacy tools supply unusual Origin/Sec-Fetch-Site
  // navigation headers. These are advisory, not the proof of authorization.
  // Fail closed on absent/malformed/expired/reused 256-bit tokens below.
  // GET remains read-only; the user must explicitly submit this POST form.
  if(!request.headers.get("Content-Type")?.startsWith("application/x-www-form-urlencoded"))return page(415,"Invalid form","<p>Use the confirmation button.</p>");
  const raw=await request.text();if(raw.length>250)return page(413,"Invalid form","<p>Form too large.</p>");
  const token=new URLSearchParams(raw).get("token");if(!validToken(token))return page(400,"Invalid link","<p>Request a new link.</p>");
  const th=await digest(token),n=now();
  let row;
  try {
    row=await env.SUBSCRIBERS.prepare("UPDATE pm_seasonal_consent SET status='confirming',updated_at=? WHERE token_hash=? AND status='pending' AND confirmation_sent_at IS NOT NULL AND expires_at>? RETURNING email").bind(n,th,n).first();
  } catch {
    console.error("DOI_CONFIRM_FAILED:consent_lookup");
    return page(503,"Subscription unavailable","<p>Could not check confirmation status. Please retry.</p>");
  }
  if(!row)return page(410,"Link unavailable","<p>Link expired, already used, or no confirmation email was recorded. Request a new confirmation email.</p>");
  let stage="contact_lookup";
  try{
    const found=await resend(env,"/contacts/"+encodeURIComponent(row.email),"GET",undefined,{contacts:true});
    let id;
    if(found.ok){if(found.data.unsubscribed===true)throw Error("unsubscribed");id=found.data.id;}
    else if(found.status===404){stage="contact_create";const created=await resend(env,"/contacts","POST",{email:row.email,unsubscribed:false}, {contacts:true});if(!created.ok)throw Error("provider");id=created.data.id;}
    else throw Error("lookup");
    if(typeof id!=="string"||!/^[0-9a-f-]{36}$/i.test(id))throw Error("bad ID");
    // The Resend topic was created with default opt_out, so an affirmative DOI
    // must explicitly opt the confirmed contact into this topic before segment membership.
    stage="topic_opt_in";
    const topic=await resend(env,"/contacts/"+encodeURIComponent(id)+"/topics","PATCH",
      [{id:env.SEASONAL_TOPIC_ID,subscription:"opt_in"}],{contacts:true});
    if(!topic.ok)throw Error("topic");
    stage="segment_add";
    const segment=await resend(env,"/contacts/"+encodeURIComponent(id)+"/segments/"+encodeURIComponent(env.SEASONAL_SEGMENT_ID),"POST",undefined,{contacts:true});
    if(!segment.ok)throw Error("segment");
    stage="consent_commit";
    const done=await env.SUBSCRIBERS.prepare("UPDATE pm_seasonal_consent SET status='confirmed',token_hash=NULL,confirmed_at=?,contact_id=?,updated_at=? WHERE email=? AND token_hash=? AND status='confirming'").bind(n,id,n,row.email,th).run();
    if(!done.meta?.changes)throw Error("DB");
    return page(200,"Subscription confirmed","<p>Thank you. You can unsubscribe from any seasonal email. Trip plan emails remain separate.</p>");
  }catch{
    // Record a stage identifier only; never log email address, token, credentials or provider response.
    console.error("DOI_CONFIRM_FAILED:"+stage);
    try {
      await env.SUBSCRIBERS.prepare("UPDATE pm_seasonal_consent SET status='pending',updated_at=? WHERE email=? AND token_hash=? AND status='confirming'").bind(now(),row.email,th).run();
    }catch{console.error("DOI_CONFIRM_FAILED:consent_rollback");}
    return page(503,"Confirmation incomplete","<p>Your subscription could not be completed. Retry this link or contact the site owner.</p>");
  }
}
const fitPath="/gear/12v-car-fridge-suv-fit-power-planner/";
const fitCore=["depth","width","height","hatchWidth","hatchHeight","length","fridgeWidth","fridgeHeight"];
const fitExtra=["extraLength","extraWidth","extraHeight","openHeight"];
const fitNames={t36:"BODEGA T36","t36-t":"BODEGA T36-T",t50t:"BODEGA T50T",t60:"BODEGA T60",custom:"Custom fridge"};
const vehicleNames={crosstrek:"2025 Subaru Crosstrek AWD",rav4:"2025 Toyota RAV4 LE",crv:"2025 Honda CR-V",highlander:"2025 Toyota Highlander",sienna:"2025 Toyota Sienna",custom:"Custom vehicle"};
const fitLabels={"paper-fit":"Paper fit","tight-fit":"Tight fit","unlikely-fit":"Unlikely fit"};
const fitPower=["none","c1000","c2000","c2000-expansion"];

function normalizeFit(s){
  if(!s||s.v!==1||!["in","cm"].includes(s.unit)||!Object.hasOwn(fitNames,s.fridge)
    ||!Object.hasOwn(vehicleNames,s.vehicle)||!Object.hasOwn(fitLabels,s.result)
    ||typeof s.across!=="boolean"||!s.values||typeof s.values!=="object"||Array.isArray(s.values)
    ||!Array.isArray(s.references)||s.references.length>3||new Set(s.references).size!==s.references.length
    ||s.references.some(key=>!["depth","width","height"].includes(key))
    ||!fitPower.includes(s.power??"none"))return null;
  const values={},limit=s.unit==="in"?300:762;
  for(const key of [...fitCore,...fitExtra]){
    const raw=s.values[key],required=fitCore.includes(key);
    if(raw===""&&!required){values[key]="";continue;}
    if(typeof raw!=="string"||raw.length>24||!raw.trim()||!Number.isFinite(Number(raw))
      ||Number(raw)<0||Number(raw)>limit+1e-8||(required&&Number(raw)===0))return null;
    values[key]=String(Number(raw));
  }
  return {v:1,unit:s.unit,values,fridge:s.fridge,vehicle:s.vehicle,references:s.references,across:s.across,power:s.power??"none",result:s.result};
}

function fitEmailPage(env) {
  const sitekey=env.FIT_TURNSTILE_SITE_KEY;
  if(typeof sitekey!=="string"||!/^[A-Za-z0-9_-]{8,128}$/.test(sitekey))return page(503,"Fit email unavailable","<p>Copy the result from the cargo fit tool for now.</p>");
  const nonce=random();
  const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Email your fit check · PARKMEMOIR</title><style>body{margin:0;background:#f7f1e8;color:#2e2a24;font:16px/1.55 system-ui,sans-serif}main{max-width:34rem;padding:1.25rem;margin:2rem auto;background:#fffdf9;border-radius:.75rem}label{display:block;margin:1rem 0}input[type=email]{display:block;width:min(100%,23rem);box-sizing:border-box;padding:.6rem;font:inherit}button{font:inherit;padding:.55rem .8rem}a{color:#764220}</style>'+
    '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script></head><body><main><h1>Email me this fit check</h1><p>Get one copy of your cargo fit result and a link to reopen it.</p>'+
    '<form method="post" action="/api/send-fit" id="fit-mail"><label>Email address<input type="email" name="email" autocomplete="email" maxlength="254" required></label>'+
    '<label><input type="checkbox" name="seasonal"> Also send me seasonal park planning updates. A separate confirmation is required.</label>'+
    '<div class="cf-turnstile" data-sitekey="'+esc(sitekey)+'" data-action="email_fit"></div>'+
    '<button type="submit" disabled>Email my fit check</button></form><p id="fit-status" role="status"></p><p><a href="'+SITE+fitPath+'">Back to SUV Cargo Fit</a> · <a href="'+SITE+'/privacy">Privacy</a></p></main>'+
    '<script nonce="'+nonce+'">const form=document.getElementById("fit-mail"),note=document.getElementById("fit-status"),button=form.querySelector("button");'+
    'let fit;try{if(location.hash.startsWith("#fit=")&&location.hash.length<=1600)fit=JSON.parse(decodeURIComponent(location.hash.slice(5)));}catch{}'+
    'if(fit?.v===1)button.disabled=false;else note.textContent="This shared fit could not be restored. Run a new check to email it.";' +
    'form.addEventListener("submit",async e=>{e.preventDefault();if(button.disabled)return;const data=new FormData(form),token=data.get("cf-turnstile-response");'+
    'if(!token){note.textContent="Please complete the verification first.";return;}button.disabled=true;note.textContent="Sending…";'+
    'try{const r=await fetch(form.action,{method:"POST",headers:{"Content-Type":"application/json"},cache:"no-store",body:JSON.stringify({email:data.get("email"),turnstileToken:token,fit,seasonal:data.get("seasonal")==="on"})});const result=await r.json();'+
    'if(!r.ok){note.textContent=result.error||"Email could not be sent.";return;}form.hidden=true;note.textContent="Your fit-check email was accepted for delivery."+(result.seasonal==="check_inbox_if_eligible"?" Check your inbox for a separate seasonal confirmation.":result.seasonal==="unavailable"?" The seasonal request could not be completed.":"");'+
    '}catch{note.textContent="Email service temporarily unavailable. Try again.";}finally{if(!form.hidden){button.disabled=false;window.turnstile?.reset();}}});</script></body></html>';
  const csp="default-src 'none'; base-uri 'none'; frame-ancestors 'none'; style-src 'unsafe-inline'; script-src 'nonce-"+nonce+"' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; form-action 'self'";
  return new Response(html,{headers:{...baseHeaders,"Content-Type":"text/html; charset=utf-8","Content-Security-Policy":csp,"X-Robots-Tag":"noindex, nofollow"}});
}

async function sendFit(request,env){
  if(!baseReady(env)||!env.FIT_TURNSTILE_SITE_KEY)return respond(503,{ok:false,error:"Fit email service not configured"});
  const data=await readJSON(request,4096),fit=normalizeFit(data?.fit);
  const email=typeof data?.email==="string"?data.email.trim().toLowerCase():"";
  if(!fit||!validEmail(email)||typeof data.seasonal!=="boolean")return respond(400,{ok:false,error:"Invalid fit check or email address"});
  if(!await verified(request,env,data.turnstileToken,"email_fit",["email.parkmemoir.com"]))return respond(403,{ok:false,error:"Verification failed"});
  if(!await rate(request,env,"fit",10))return respond(429,{ok:false,error:"Rate limit"});
  const link=SITE+fitPath+"#fit="+encodeURIComponent(JSON.stringify(fit));
  const description=vehicleNames[fit.vehicle]+" / "+fitNames[fit.fridge];
  const text="Your saved SUV cargo fit check: "+fitLabels[fit.result]+"\n"+description+"\n\nReopen the result and its measurements:\n"+link+
    "\n\nConfirm loading, ventilation and lid swing in the vehicle before buying. This one-time email is separate from seasonal updates.";
  const key="pm-fit-v1-"+await digest([env.RATE_HASH_SECRET,email,JSON.stringify(fit)].join("|"));
  const result=await resend(env,"/emails","POST",{from:env.EMAIL_FROM,to:[email],subject:"Your PARKMEMOIR SUV cargo fit check",text},{idempotencyKey:key});
  if(!result.ok)return respond(502,{ok:false,error:"Provider did not accept email"});
  let seasonal="not_requested";
  if(data.seasonal){
    seasonal="unavailable";
    try{
      if(env.SEASONAL_SEGMENT_ID&&env.SEASONAL_TOPIC_ID&&env.RESEND_CONTACTS_API_KEY&&await rate(request,env,"seasonal",6)){
        const confirmation=await requestSeasonalConsent(env,email,fitPath);
        if(confirmation.ok)seasonal="check_inbox_if_eligible";
      }
    }catch{/* Transactional acceptance is independent of the optional subscription. */}
  }
  return respond(200,{ok:true,status:"accepted",seasonal});
}

async function execute(request,env) {
  const pathname=new URL(request.url).pathname;
  if(pathname==="/fit-email"&&request.method==="GET")return fitEmailPage(env);
  if(pathname==="/api/send-fit"){
    if(request.method!=="POST")return respond(405,{ok:false,error:"Method not allowed"});
    if(request.headers.get("Origin")!==SERVICE)return respond(403,{ok:false,error:"Origin not allowed"});
    try{return await sendFit(request,env);}catch{return respond(503,{ok:false,error:"Email service temporarily unavailable"});}
  }
  if(pathname==="/health" && request.method==="GET") {
    // Binding presence only: no mail, database reads, or private values are exposed.
    const configured=baseReady(env) && Boolean(env.RESEND_CONTACTS_API_KEY&&env.SEASONAL_SEGMENT_ID&&env.SEASONAL_TOPIC_ID&&env.BROWSER?.quickAction);
    return respond(configured?200:503,{ok:configured,service:"parkmemoir-email",status:configured?"configured":"missing_config"});
  }
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
