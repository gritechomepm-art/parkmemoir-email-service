/**
 * Browser-side adapter for the approved full Winter Planner V12.5 preview.
 *
 * Source of truth: preparePrint() and the existing #print-plan DOM.
 * Do not invent a reduced email-only report. This module belongs in the
 * future public-site integration PR, not in the Cloudflare Worker runtime.
 */
export const FULL_PRINT_VERSION="winter-full-print-v12.5";

export function captureWinterFullPrintSnapshot(win=window) {
  const doc=win.document;
  const printPlan=doc.getElementById("print-plan");
  if(!printPlan)throw Error("Full Winter Planner printable view is not installed");
  // The existing planner registers beforeprint -> preparePrint().
  // This updates the exact same report used by its Save/Print PDF button.
  win.dispatchEvent(new win.Event("beforeprint"));
  const example=doc.getElementById("print-example-note");
  if(example && !example.hidden)throw Error("Customize your trip before emailing your full PDF");
  const markup=printPlan.outerHTML;
  const css=[...doc.querySelectorAll("style")].map(el=>el.textContent).join("\n");
  if(!markup.includes("Your packing checklist")||
     !markup.includes("Affiliate disclosure")||
     !markup.includes("Recommended products")||
     !markup.includes("Access &amp; stay notes"))
     throw Error("Full planner printable sections are missing");
  return {version:FULL_PRINT_VERSION,markup,css};
}
const byId=(doc,id)=>doc.getElementById(id);
const check=(doc,id)=>Boolean(byId(doc,id)?.checked);
function officialNpsLink(doc) {
  const links=[...doc.querySelectorAll("#print-itinerary a[href]")];
  const url=links.map(a=>a.href).find(h=>{
    try {const u=new URL(h);return u.protocol==="https:"&&(u.hostname==="nps.gov"||u.hostname.endsWith(".nps.gov"));}catch{return false;}
  });
  if(!url)throw Error("Official NPS reference is missing from the full print plan");
  return url;
}
export function makeWinterFullPrintEmailPayload({email,turnstileToken,win=window}){
  const d=win.document;
  const snapshot=captureWinterFullPrintSnapshot(win);
  const park=byId(d,"plan-park")?.value;
  const month=byId(d,"plan-month")?.value;
  const stayRaw=d.querySelector('input[name="stay"]:checked')?.value;
  const stays={hotel:"hotel",powered:"powered",dry:"camping",dispersed:"dispersed"};
  const load=[["basic","phones"],["laptop","laptop"],["fridge","fridge"],["blanket","blanket"],["kettle","kettle"],["cpap","cpap"]]
      .filter(([id])=>check(d,id)).map(([,name])=>name);
  const days=Number(byId(d,"trip-days")?.value);
  const fridgeW=Number(byId(d,"fridge-watts")?.value||18);
  // V12.5 uses a numeric <input id="recharge" min="1" max="14">, not a select.
  const selectedRecharge=Number(byId(d,"recharge")?.value);
  const recharge=String(Number.isInteger(selectedRecharge)&&selectedRecharge>=1&&selectedRecharge<=14 ? selectedRecharge : days);
  const method=byId(d,"winter-recharge-method")?.value||"none";
  const packing=[...d.querySelectorAll("[data-pack]:checked")]
      .map(el=>String(el.dataset.pack||"").toLowerCase().replace(/[^a-z-]/g,"-").slice(0,80))
      .filter(Boolean).slice(0,50);
  return {
    requestedOnly:true,
    email,
    turnstileToken,
    pageUrl:"https://parkmemoir.com/which-national-parks-are-open-in-winter/",
    npsUrl:officialNpsLink(d),
    plan:{
      v:1,park,month,days,stay:stays[stayRaw],
      load,recharge,method,
      vehicleConfirmed:check(d,"winter-source-confirmed"),
      portableAway:check(d,"portable-away"),
      fridgeW,
      fridgeModel:"other",fridgePlug:"unknown",fridgePeak:"",
      fridgeOwned:"no",unchecked:packing,sample:false
    },
    printSnapshot:snapshot
  };
}
export async function sendWinterFullPrintEmail({email,turnstileToken,win=window,fetchFn=fetch}){
  const payload=makeWinterFullPrintEmailPayload({email,turnstileToken,win});
  const response=await fetchFn("https://email.parkmemoir.com/api/send-plan",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify(payload),
  });
  if(!response.ok)throw Error("Full report email unavailable (HTTP "+response.status+")");
  return response.json();
}


/**
 * Review-only email form. Both feature flags are OFF until the separate
 * email Worker passes full PDF attachment and double opt-in live QA.
 */
function createElement(doc,tag,attrs={},label="") {
  const node=doc.createElement(tag);
  for(const [k,v] of Object.entries(attrs))node.setAttribute(k,String(v));
  if(label)node.textContent=label;
  return node;
}
async function loadTurnstile(win){
  if(win.turnstile)return win.turnstile;
  await new Promise((resolve,reject)=>{
    const script=createElement(win.document,"script",{src:"https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"});
    script.onload=resolve;script.onerror=()=>reject(Error("Turnstile failed to load"));
    win.document.head.appendChild(script);
  });
  if(!win.turnstile)throw Error("Turnstile unavailable");
  return win.turnstile;
}
export function mountFullPrintEmailPreview(win=window) {
  const doc=win.document,actions=doc.querySelector(".action-buttons");
  if(!actions)return false;
  if(doc.getElementById("pm-full-email"))return true;
  const planCfg=win.PARKMEMOIR_PLAN_EMAIL_CONFIG||{enabled:false};
  const seasonalCfg=win.PARKMEMOIR_SEASONAL_CONFIG||{enabled:false};
  const planEnabled=Boolean(planCfg.enabled&&planCfg.siteKey);
  const seasonalEnabled=Boolean(seasonalCfg.enabled&&seasonalCfg.siteKey);
  const panel=createElement(doc,"section",{id:"pm-full-email","aria-label":"Email the complete trip PDF"});
  const title=createElement(doc,"h3",{},"Email your complete trip PDF");
  const desc=createElement(doc,"p",{},"The attachment uses the same full planner report as Save plan + offers (PDF).");
  const controls=createElement(doc,"div",{class:"pm-email-controls"});
  const address=createElement(doc,"input",{type:"email",placeholder:"Your email address",autocomplete:"email","aria-label":"Your email address",required:""});
  address.maxLength=254;
  const mailButton=createElement(doc,"button",{type:"button"},"Email full PDF");
  const mailStatus=createElement(doc,"p",{role:"status","aria-live":"polite"});
  const mailTurnstile=createElement(doc,"div",{id:"pm-email-turnstile"});
  controls.append(address,mailButton);
  const seasonalArea=createElement(doc,"div",{class:"pm-seasonal-area"});
  const label=createElement(doc,"label");
  const optin=createElement(doc,"input",{type:"checkbox"});optin.checked=false;
  label.append(optin,doc.createTextNode(" Send me seasonal park updates (optional; separate confirmation)"));
  const seasonalButton=createElement(doc,"button",{type:"button"},"Request seasonal updates confirmation");
  const seasonalStatus=createElement(doc,"p",{role:"status","aria-live":"polite"});
  const seasonalTurnstile=createElement(doc,"div",{id:"pm-seasonal-turnstile"});
  seasonalArea.append(label,seasonalButton,seasonalStatus,seasonalTurnstile);
  panel.append(title,desc,controls,mailStatus,mailTurnstile,seasonalArea);
  const style=createElement(doc,"style");
  style.textContent=[
    "#pm-full-email{margin:12px 0;padding:16px;border:1px solid #cbbba3;border-radius:12px;background:#f9f4e9;color:#403426}",
    "#pm-full-email h3{font:600 18px Georgia,serif;margin:0 0 6px}",
    "#pm-full-email p{font-size:13px;margin:5px 0 10px}",
    "#pm-full-email .pm-email-controls{display:flex;flex-wrap:wrap;gap:10px;align-items:center}",
    "#pm-full-email input[type=email]{width:min(100%,280px);min-height:44px;padding:10px}",
    "#pm-full-email button{min-height:44px;padding:10px 15px;border-radius:6px;background:#58412e;color:#fff;cursor:pointer}",
    "#pm-full-email button:disabled{cursor:not-allowed;opacity:.48}",
    "#pm-full-email .pm-seasonal-area{border-top:1px solid #d1c5b5;margin-top:12px;padding-top:12px}",
    "#pm-full-email .pm-seasonal-area label{display:flex;align-items:center;gap:8px;font-size:13px}",
    "#pm-full-email .pm-seasonal-area button{margin-top:8px}",
    "#pm-full-email #pm-email-turnstile,#pm-full-email #pm-seasonal-turnstile{margin:8px 0}",
    "@media print{#pm-full-email{display:none!important}}"
  ].join("\n");
  doc.head.appendChild(style);
  actions.insertAdjacentElement("afterend",panel);
  mailButton.disabled=!planEnabled;
  seasonalButton.disabled=!seasonalEnabled;
  optin.disabled=!seasonalEnabled;
  if(!planEnabled)mailStatus.textContent="Email delivery remains disabled in this review preview until backend QA passes.";
  if(!seasonalEnabled)seasonalStatus.textContent="Seasonal updates are not yet enabled.";
  let mailToken=null,seasonalToken=null,mailId=null,seasonalId=null;
  const init=async()=>{
    if(!planEnabled&&!seasonalEnabled)return;
    const ts=await loadTurnstile(win);
    if(planEnabled)mailId=ts.render(mailTurnstile,{sitekey:planCfg.siteKey,action:"email_plan",
      callback:t=>{mailToken=t;},"expired-callback":()=>{mailToken=null;}});
    if(seasonalEnabled)seasonalId=ts.render(seasonalTurnstile,{sitekey:seasonalCfg.siteKey,action:"seasonal_signup",
      callback:t=>{seasonalToken=t;},"expired-callback":()=>{seasonalToken=null;}});
  };
  init().catch(e=>{mailButton.disabled=true;seasonalButton.disabled=true;mailStatus.textContent=e.message;});
  mailButton.addEventListener("click",async()=>{
    if(!planEnabled||!mailToken){mailStatus.textContent="Complete Turnstile verification first.";return;}
    if(!address.reportValidity())return;
    mailButton.disabled=true;mailStatus.textContent="Sending complete trip PDF...";
    try{
      await sendWinterFullPrintEmail({email:address.value.trim(),turnstileToken:mailToken,win,fetchFn:win.fetch.bind(win)});
      mailStatus.textContent="Accepted for delivery. Check your inbox for the attached PDF.";
    }catch(e){mailStatus.textContent="Email unavailable: "+e.message;}
    finally{mailButton.disabled=false;mailToken=null;if(mailId!==null)win.turnstile?.reset(mailId);}
  });
  seasonalButton.addEventListener("click",async()=>{
    if(!seasonalEnabled||!optin.checked){seasonalStatus.textContent="Select the optional updates checkbox first.";return;}
    if(!seasonalToken){seasonalStatus.textContent="Complete seasonal Turnstile verification first.";return;}
    if(!address.reportValidity())return;
    seasonalButton.disabled=true;seasonalStatus.textContent="Requesting a separate confirmation email...";
    try{
      const response=await win.fetch("https://email.parkmemoir.com/api/seasonal-subscribe",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({email:address.value.trim(),consent:true,
          consentVersion:"pm-seasonal-updates-v1-2026-11-08",
          sourcePage:"https://parkmemoir.com/which-national-parks-are-open-in-winter/",
          turnstileToken:seasonalToken})
      });
      if(response.status!==202)throw Error("HTTP "+response.status);
      seasonalStatus.textContent="If eligible, check your inbox and confirm; you are not yet subscribed.";
    }catch(e){seasonalStatus.textContent="Confirmation unavailable: "+e.message;}
    finally{seasonalButton.disabled=false;seasonalToken=null;if(seasonalId!==null)win.turnstile?.reset(seasonalId);}
  });
  return true;
}
if(typeof window!=="undefined"){
  const attach=()=>mountFullPrintEmailPreview(window);
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",attach,{once:true});else attach();
}
