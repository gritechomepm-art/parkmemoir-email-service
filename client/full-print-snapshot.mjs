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
  const recharge=String(byId(d,"recharge")?.value||"none");
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
