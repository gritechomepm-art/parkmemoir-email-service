// Dedicated one-time packing-list email and explicitly checked single opt-in.
// Does not modify /api/send-plan or the existing Double Opt-in subscription flow.
export const DIRECT_CONSENT_VERSION = "pm-seasonal-updates-v2-direct-2026-11-13";
export const CHECKLIST_PATH = "/national-park-packing-list/";
const GROUPS = {
  family: ["adult","young","older","mixed"],
  season: ["spring","summer","fall","winter"],
  stay: ["day","hotel","camp","rv"]
};
const ITEMS = [
  ["map","Offline map and a backup map you know how to use"],
  ["water","Water bottles and extra water"],
  ["food","Trail snacks and extra food"],
  ["sun","Sun protection: hat, sunglasses and sunscreen"],
  ["layers","Extra clothing and a rain shell"],
  ["light","Headlamp and spare batteries"],
  ["firstaid","First-aid kit and personal medications"],
  ["repair","Small repair kit"],
  ["shelter","Emergency shelter or bivy appropriate to your route"],
  ["fire","Emergency fire starter, where permitted"],
  ["passes","Park pass, timed entry or permits for your route"],
  ["alerts","Saved park alerts, road conditions and shuttle details"],
  ["power","Phone charger and a backup battery suited to your devices"],
  ["plan","Share your route and expected return time"],
  ["spring-mud","Waterproof footwear and spare socks",{season:["spring"]}],
  ["summer-heat","Extra drinking water and shade for breaks",{season:["summer"]}],
  ["fall-cold","Warm hat and layers for an early start",{season:["fall"]}],
  ["winter-clothes","Insulated layers, warm hat, gloves and winter footwear",{season:["winter"]}],
  ["winter-car","Ice scraper, blankets and emergency food and water in the car",{season:["winter"]}],
  ["young-carrier","Child carrier or stroller suited to your route",{family:["young","mixed"]}],
  ["young-clothes","Spare clothes and diapers or toilet supplies as needed",{family:["young","mixed"]}],
  ["young-journal","Junior Ranger booklet or family park journal for drawing together",{family:["young","mixed"]}],
  ["older-daypack","Kids’ daypacks, water bottles and extra layers",{family:["older","mixed"]}],
  ["older-journal","Junior Ranger booklet or travel journal and pencil",{family:["older","mixed"]}],
  ["hotel","Lodging confirmation, chargers and a small day bag",{stay:["hotel"]}],
  ["camp-tent","Tent, stakes and groundsheet",{stay:["camp"]}],
  ["camp-sleep","Sleeping bags and pads matched to overnight conditions",{stay:["camp"]}],
  ["camp-kitchen","Camp kitchen, water containers and required food storage",{stay:["camp"]}],
  ["rv-booking","Campsite confirmation and hookup details",{stay:["rv"]}],
  ["rv-kit","Water, waste and power supplies matched to your rig and site",{stay:["rv"]}]
];
const SAFE_IDS = new Set(ITEMS.map(x=>x[0]));
const esc = s => String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const hostOk = u => {
  try {const x=new URL(u);return x.protocol==="https:" &&
    ["parkmemoir.com","www.parkmemoir.com"].includes(x.hostname) &&
    x.pathname===CHECKLIST_PATH && !x.username && !x.password;} catch{return false;}
};
export function validateChecklist(d,validEmail) {
  if(!d || typeof d!=="object" || Array.isArray(d)) return null;
  const keys=["email","seasonalUpdates","consent","consentVersion","sourcePage","trip","checkedItems","turnstileToken"];
  if(Object.keys(d).some(k=>!keys.includes(k)))return null;
  if(!validEmail(d.email) || typeof d.seasonalUpdates!=="boolean" ||
    d.consent!==d.seasonalUpdates || !hostOk(d.sourcePage) ||
    typeof d.turnstileToken!=="string" ||
    !d.trip || typeof d.trip!=="object" || Array.isArray(d.trip)) return null;
  if(Object.keys(d.trip).sort().join(",")!=="family,season,stay") return null;
  for(const [k,options] of Object.entries(GROUPS))if(!options.includes(d.trip[k]))return null;
  if(d.seasonalUpdates ? d.consentVersion!==DIRECT_CONSENT_VERSION : d.consentVersion!==null)return null;
  if(!Array.isArray(d.checkedItems) || d.checkedItems.length>ITEMS.length ||
     new Set(d.checkedItems).size!==d.checkedItems.length ||
     !d.checkedItems.every(x=>typeof x==="string" && SAFE_IDS.has(x))) return null;
  const visible=ITEMS.filter(x=>!x[2] || Object.entries(x[2]).every(([k,values])=>values.includes(d.trip[k])));
  const visibleIds=new Set(visible.map(x=>x[0]));
  if(d.checkedItems.some(id=>!visibleIds.has(id)))return null;
  return {email:d.email.trim().toLowerCase(),trip:d.trip,visible,
    checked:new Set(d.checkedItems),seasonalUpdates:d.seasonalUpdates};
}
export function checklistPrintHtml(p) {
  const trip=esc(p.trip.family)+" · "+esc(p.trip.season)+" · "+esc(p.trip.stay);
  const rows=p.visible.map(x=>'<li><span class="check">'+(p.checked.has(x[0])?"&#9745;":"&#9633;")+
    '</span><span>'+esc(x[1])+'</span></li>').join("");
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">'+
    '<style>@page{size:letter;margin:14mm}*{box-sizing:border-box}'+
    'body{font:12px/1.45 Arial,sans-serif;color:#32281f;margin:0}'+
    'h1{font:24px Georgia,serif;margin:0 0 6px}h2{font:16px Georgia,serif}'+
    '.tag{color:#734833;font-size:11px;letter-spacing:1px;font-weight:700}'+
    '.trip{padding:8px;background:#f6eee2;margin:12px 0}ul{padding:0;list-style:none;columns:2;column-gap:18px}'+
    'li{break-inside:avoid;display:flex;gap:8px;padding:7px 0;border-bottom:1px solid #dfd3c5}'+
    '.check{font:18px Arial,sans-serif;width:19px;flex:none}footer{border-top:1px solid #ddd;margin-top:15px;padding-top:10px;color:#645647;font-size:10px}'+
    '</style></head><body><div class="tag">PARKMEMOIR · TRIP PLANNING</div>'+
    '<h1>National Park Packing List</h1><div class="trip">'+trip+'</div><ul>'+rows+'</ul>'+
    '<footer>For planning only. Check current park alerts and conditions before you travel. '+
    'The NPS Ten Essentials are a starting point. parkmemoir.com/national-park-packing-list/</footer></body></html>';
}
function toBase64(bytes) {
  let out="";for(let i=0;i<bytes.length;i+=8192)out+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(out);
}
export async function renderChecklistPdf(env,p) {
  if(!env.BROWSER?.quickAction)throw Error("pdf_renderer_unavailable");
  const output=await env.BROWSER.quickAction("pdf",{
    html:checklistPrintHtml(p),
    pdfOptions:{format:"letter",printBackground:true,preferCSSPageSize:true},
    rejectRequestPattern:["/^https?:\\/\\//"]
  });
  if(!output.ok)throw Error("pdf_renderer_failed");
  const bytes=new Uint8Array(await output.arrayBuffer());
  const head=new TextDecoder("latin1").decode(bytes.subarray(0,8));
  const tail=new TextDecoder("latin1").decode(bytes.subarray(Math.max(0,bytes.length-1024)));
  if(bytes.length<500 || bytes.length>5*1024*1024 || !head.startsWith("%PDF-") ||
     !tail.includes("%%EOF"))throw Error("invalid_pdf_bytes");
  return {filename:"PARKMEMOIR_National_Park_Packing_List.pdf",content:toBase64(bytes)};
}
// Explicit marketing consent is kept in a new table so existing DOI tokens and
// Winter Planner user journeys are not modified.
async function enrollDirect(env,p,api) {
  if(!env.SEASONAL_SEGMENT_ID || !env.SEASONAL_TOPIC_ID || !env.RESEND_CONTACTS_API_KEY)
    return "unavailable";
  const n=api.now(), source=CHECKLIST_PATH;
  const old=await env.SUBSCRIBERS.prepare(
    "SELECT status FROM pm_seasonal_consent WHERE email=?").bind(p.email).first();
  const direct=await env.SUBSCRIBERS.prepare(
    "SELECT status FROM pm_checklist_direct_consent WHERE email=?").bind(p.email).first();
  if(old?.status==="unsubscribed" || direct?.status==="unsubscribed")return "blocked";
  const found=await api.resend(env,"/contacts/"+encodeURIComponent(p.email),"GET",undefined,{contacts:true});
  let id;
  if(found.ok) {
    if(found.data?.unsubscribed===true)return "blocked";
    id=found.data?.id;
  } else if(found.status===404) {
    const created=await api.resend(env,"/contacts","POST",{email:p.email,unsubscribed:false},{contacts:true});
    if(!created.ok)return "failed";
    id=created.data?.id;
  } else return "failed";
  if(typeof id!=="string"||!/^[0-9a-f-]{36}$/i.test(id))return "failed";
  // Preserve existing confirmed consent; pending/failed requests may retry.
  if(direct?.status!=="confirmed") {
    const queued=await env.SUBSCRIBERS.prepare(
      "INSERT INTO pm_checklist_direct_consent(email,status,consent_version,source_path,requested_at,updated_at) "+
      "VALUES(?,'pending',?,?,?,?) ON CONFLICT(email) DO UPDATE SET "+
      "status='pending',consent_version=excluded.consent_version,source_path=excluded.source_path,"+
      "requested_at=excluded.requested_at,updated_at=excluded.updated_at "+
      "WHERE pm_checklist_direct_consent.status NOT IN ('confirmed','unsubscribed')")
      .bind(p.email,DIRECT_CONSENT_VERSION,source,n,n).run();
    if(!queued.meta?.changes)return "failed";
  }
  const topic=await api.resend(env,"/contacts/"+encodeURIComponent(id)+"/topics","PATCH",
    [{id:env.SEASONAL_TOPIC_ID,subscription:"opt_in"}],{contacts:true});
  if(!topic.ok)return "failed";
  const segment=await api.resend(env,"/contacts/"+encodeURIComponent(id)+"/segments/"+
    encodeURIComponent(env.SEASONAL_SEGMENT_ID),"POST",undefined,{contacts:true});
  if(!segment.ok)return "failed";
  const updated=await env.SUBSCRIBERS.prepare(
    "INSERT INTO pm_checklist_direct_consent(email,status,consent_version,source_path,requested_at,subscribed_at,contact_id,updated_at) "+
    "VALUES(?,'confirmed',?,?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET "+
    "status='confirmed',consent_version=excluded.consent_version,"+
    "source_path=excluded.source_path,subscribed_at=excluded.subscribed_at,"+
    "contact_id=excluded.contact_id,updated_at=excluded.updated_at "+
    "WHERE pm_checklist_direct_consent.status!='unsubscribed'")
    .bind(p.email,DIRECT_CONSENT_VERSION,source,n,n,id,n).run();
  return updated.meta?.changes ? "subscribed" : "failed";
}
export async function sendChecklist(request,env,api) {
  if(!api.baseReady(env)||!env.BROWSER?.quickAction)
    return api.respond(503,{ok:false,error:"Checklist email service not configured"});
  const d=await api.readJSON(request,7000);
  const p=validateChecklist(d,api.validEmail);
  if(!p)return api.respond(400,{ok:false,error:"Invalid checklist request"});
  if(!await api.verified(request,env,d.turnstileToken,"checklist_send"))
    return api.respond(403,{ok:false,error:"Verification failed"});
  if(!await api.rate(request,env,"checklist",10))
    return api.respond(429,{ok:false,error:"Please try again later"});
  let pdf;try{pdf=await renderChecklistPdf(env,p);}catch{
    return api.respond(503,{ok:false,error:"Checklist PDF unavailable"});
  }
  const content={
    from:env.EMAIL_FROM,to:[p.email],
    subject:"Your PARKMEMOIR National Park Packing List (PDF attached)",
    text:"Your personalized national park packing list PDF is attached.\n\n"+
      "This is a one-time checklist email, not a marketing subscription. "+
      "Seasonal updates are optional and handled separately.\n\n"+
      "Before traveling, check current park alerts, closures and road conditions.",
    html:'<main style="font:16px/1.6 system-ui;max-width:600px;padding:20px">'+
      '<h1>Your national park packing list is attached</h1>'+
      '<p>Here is the checklist you requested, matched to your family, season and stay.</p>'+
      '<p>This one-time email does not automatically subscribe you to marketing.</p>'+
      '<p>Check current park conditions before traveling.</p></main>',
    attachments:[pdf]
  };
  const key="pm-checklist-v1-"+await api.digest(
    ["checklist",env.RATE_HASH_SECRET,p.email,JSON.stringify(p.trip),
     [...p.checked].sort().join(","),Math.floor(api.now()/600)].join("|"));
  let sent;
  try{sent=await api.resend(env,"/emails","POST",content,{idempotencyKey:key});}
  catch{return api.respond(502,{ok:false,error:"Checklist email was not accepted"});}
  if(!sent.ok)return api.respond(502,{ok:false,error:"Checklist email was not accepted"});
  let seasonal="not_requested";
  if(p.seasonalUpdates) {
    try{seasonal=await enrollDirect(env,p,api);}
    catch{seasonal="failed";}
  }
  return api.respond(200,{ok:true,checklist:"accepted",seasonal});
}
