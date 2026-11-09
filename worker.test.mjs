import test, {after} from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {route,cleanupExpired,renderFullPrintPdf} from "./worker.mjs";
const SERVICE="https://email.parkmemoir.com";
const SITE="https://parkmemoir.com";
const db=new DatabaseSync(":memory:");
db.exec(readFileSync(new URL("./migrations/0001.sql",import.meta.url),"utf8"));
const D1 = {
  prepare(sql) {
    return {
      bind(...args) {
        const st = db.prepare(sql);
        return {
          first: () => st.get(...args) || null,
          run: () => ({meta: {changes: Number(st.run(...args).changes)}}),
        };
      },
    };
  },
};

function samplePrintSnapshot(){
  return {
    version:"winter-full-print-v12.5",
    markup:'<section id="print-plan"><h1>Zion winter trip</h1><h2>Access &amp; stay notes</h2><p>Current NPS conditions and power calculations</p><h2>Your packing checklist</h2><ul><li>Warm clothing</li><li>Emergency kit</li></ul><h2>Recommended products &amp; booking links</h2><a href="https://pboost.me/sample">Check verified gear</a><p>Affiliate disclosure: PARKMEMOIR may earn a commission.</p></section>',
    css:"@media print { @page { size: A4; margin: 10mm } body{font-family: Georgia, serif} #print-plan{display:block;line-height:1.5} #print-plan h1{font-size:24pt} #print-plan a{color:#62422c} }"
  };
}
function examplePdfFixture(){
  const stream="BT /F1 12 Tf 50 700 Td (PARKMEMOIR complete print) Tj ET\n";
  const objs=[
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length "+stream.length+" >>\nstream\n"+stream+"endstream"
  ];
  let raw="%PDF-1.4\n",positions=[0];
  for(let i=0;i<objs.length;i++){positions.push(raw.length);raw+=(i+1)+" 0 obj\n"+objs[i]+"\nendobj\n";}
  const xref=raw.length;raw+="xref\n0 6\n0000000000 65535 f \n";
  for(let i=1;i<=objs.length;i++)raw+=String(positions[i]).padStart(10,"0")+" 00000 n \n";
  raw+="trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n"+xref+"\n%%EOF\n";
  return raw;
}
const browserCalls=[];
const BROWSER={quickAction:async(action,args)=>{
  browserCalls.push({action,args});
  return new Response(new TextEncoder().encode(examplePdfFixture()),{status:200,headers:{"Content-Type":"application/pdf"}});
}};
const env={BROWSER,SUBSCRIBERS:D1,RESEND_API_KEY:"TEST_ONLY",RESEND_CONTACTS_API_KEY:"CONTACTS_TEST_ONLY",EMAIL_FROM:"PARKMEMOIR <plans@mail.parkmemoir.com>",TURNSTILE_SECRET_KEY:"TEST_ONLY",RATE_HASH_SECRET:"TEST_ONLY",SEASONAL_SEGMENT_ID:"33333333-3333-4333-8333-333333333333",SEASONAL_TOPIC_ID:"77777777-7777-4777-8777-777777777777"};
const consentVersion="pm-seasonal-updates-v1-2026-11-08";
const emails=[],emailKeys=[],contacts=new Map();let mailFails=false,segmentFails=false,topicFails=false;
const fakeFetch=async(url,opts={})=>{
  const u=String(url);
  if(u.includes("challenges.cloudflare.com/turnstile/")){const action=new URLSearchParams(opts.body).get("response")==="plan-token"?"email_plan":"seasonal_signup";return Response.json({success:true,hostname:"parkmemoir.com",action});}
  if(!u.startsWith("https://api.resend.com"))throw Error("Unexpected fetch "+u);
  const path=u.slice("https://api.resend.com".length),method=opts.method||"GET",body=opts.body?JSON.parse(opts.body):null;
  assert.equal(opts.headers.Authorization,"Bearer "+(path.startsWith("/contacts")?"CONTACTS_TEST_ONLY":"TEST_ONLY"));
  assert.equal(opts.headers["User-Agent"],"parkmemoir-email-service/1.0");
  if(path==="/emails"){emails.push(body);emailKeys.push(opts.headers["Idempotency-Key"]||null);return Response.json({id:"sent"},{status:mailFails?502:200});}
  if(path==="/contacts"&&method==="POST"){const id="44444444-4444-4444-8444-"+String(contacts.size+1).padStart(12,"0");contacts.set(body.email,{id,email:body.email,unsubscribed:false,segments:new Set(),topics:new Map()});return Response.json({id});}
  if(path.startsWith("/contacts/")&&method==="GET"){const email=decodeURIComponent(path.slice(10)),c=contacts.get(email);return c?Response.json(c):Response.json({error:"not found"},{status:404});}
  const topic=path.match(/^\/contacts\/([^/]+)\/topics$/);
  if(topic&&method==="PATCH"){
    if(topicFails)return Response.json({error:"topic error"},{status:503});
    const c=[...contacts.values()].find(x=>x.id===decodeURIComponent(topic[1]));assert.ok(c);
    c.topics??=new Map();
    assert.deepEqual(Object.keys(body),["topics"]);
    assert.equal(Array.isArray(body.topics),true);
    for(const t of body.topics)c.topics.set(t.id,t.subscription);
    return Response.json({object:"contact_topics"});
  }
  const m=path.match(/^\/contacts\/([^/]+)\/segments\/([^/]+)$/);
  if(m&&method==="POST"){if(segmentFails)return Response.json({error:"provider"},{status:503});const c=[...contacts.values()].find(x=>x.id===m[1]);assert.ok(c);c.segments.add(m[2]);return Response.json({object:"contact_segment"});}
  throw Error("Unexpected provider path "+method+" "+path);
};
function post(path,data,origin=SITE,ip="1.2.3.4"){return new Request(SERVICE+path,{method:"POST",headers:{"Origin":origin,"Content-Type":"application/json","CF-Connecting-IP":ip},body:JSON.stringify(data)});}
function signup(email,token="signup-token"){return {email,turnstileToken:token,consent:true,consentVersion,sourcePage:SITE+"/which-national-parks-are-open-in-winter/"};}
function planBody(email){return {requestedOnly:true,email,printSnapshot:samplePrintSnapshot(),turnstileToken:"plan-token",pageUrl:SITE+"/which-national-parks-are-open-in-winter/",npsUrl:"https://www.nps.gov/zion/planyourvisit/conditions.htm",plan:{v:1,park:"zion",month:"nov",days:2,stay:"camping",load:["fridge","phones"],recharge:"none",method:"none",vehicleConfirmed:false,portableAway:false,fridgeW:18,fridgeModel:"bodega-t36",fridgePlug:"cigarette",fridgePeak:"",fridgeOwned:"no",unchecked:["warm"],sample:false}};}
const originally=globalThis.fetch;
globalThis.fetch=fakeFetch;
  test("health reports binding configuration without sending or exposing secrets",async()=>{
    const before=emails.length;
    const ok=await route(new Request(SERVICE+"/health"),env);
    assert.equal(ok.status,200);
    assert.deepEqual(await ok.json(),{ok:true,service:"parkmemoir-email",status:"configured"});
    const missing=await route(new Request(SERVICE+"/health"),{...env,RESEND_API_KEY:""});
    assert.equal(missing.status,503);
    assert.deepEqual(await missing.json(),{ok:false,service:"parkmemoir-email",status:"missing_config"});
    assert.equal(emails.length,before);
  });
  test("separate Worker rejects non-email host and abusive origins",async()=>{
    const h=await route(new Request(SITE+"/api/send-plan",{method:"POST",headers:{Origin:SITE}}),env);assert.equal(h.status,404);
    assert.equal((await route(post("/api/send-plan",planBody("x@example.com"),"https://evil.example"),env)).status,403);
  });
  test("cross-origin preflight explicitly allowed only for PARKMEMOIR",async()=>{
    const good=await route(new Request(SERVICE+"/api/send-plan",{method:"OPTIONS",headers:{Origin:SITE,"Access-Control-Request-Method":"POST"}}),env);
    assert.equal(good.status,204);assert.equal(good.headers.get("Access-Control-Allow-Origin"),SITE);
    const bad=await route(new Request(SERVICE+"/api/send-plan",{method:"OPTIONS",headers:{Origin:"https://evil.example"}}),env);
    assert.equal(bad.status,403);
  });
  test("plan email does not add marketing contact",async()=>{
    const r=await route(post("/api/send-plan",planBody("plan@example.com"),SITE,"5.5.5.5"),env);
    assert.equal(r.status,200);assert.equal((await r.json()).status,"accepted");
    assert.equal(contacts.size,0);assert.equal(emails.length,1);
    assert.match(emails[0].text,/Official NPS/);assert.match(emails[0].text,/not subscribe/);
    assert.doesNotMatch(emails[0].text,/plan@example.com/);
    assert.match(emails[0].text,/PDF is attached/);
    assert.doesNotMatch(emails[0].text,/Open plan and print PDF/);
    assert.equal(emails[0].attachments[0].filename,"PARKMEMOIR_Full_Winter_Trip_Plan.pdf");
    const pdf=atob(emails[0].attachments[0].content);
    assert.equal(pdf,examplePdfFixture());
    assert.equal(browserCalls[0].action,"pdf");
    assert.match(browserCalls[0].args.html,/Your packing checklist/);
    assert.match(browserCalls[0].args.html,/Affiliate disclosure/);
    assert.match(browserCalls[0].args.html,/Recommended products/);
    assert.match(browserCalls[0].args.html,/Access &amp; stay notes/);
    assert.match(browserCalls[0].args.html,/pboost.me\/sample/);
    assert.equal(browserCalls[0].args.pdfOptions.format,"a4");
  });
  test("accepts the one-day recharge interval exposed by the V12.5 numeric control",async()=>{
    const body=planBody("one-day@example.com");
    body.plan.recharge="1";
    const before=emails.length;
    const r=await route(post("/api/send-plan",body,SITE,"18.18.18.18"),env);
    assert.equal(r.status,200);
    assert.equal(emails.length,before+1);
    assert.equal(emails.at(-1).attachments[0].filename,"PARKMEMOIR_Full_Winter_Trip_Plan.pdf");
  });
  test("DOI email remains pending until human POST; a GET does not subscribe",async()=>{
    const r=await route(post("/api/seasonal-subscribe",signup("member@example.com"),SITE,"6.6.6.6"),env);
    assert.equal(r.status,202);assert.equal(contacts.size,0);
    const match=emails.at(-1).text.match(/seasonal-confirm\?token=([0-9a-f]{64})/);assert.ok(match);
    const token=match[1],u=SERVICE+"/api/seasonal-confirm?token="+token;
    const view=await route(new Request(u),env);
    assert.equal(view.status,200);assert.match(await view.text(),/Confirm subscription/);
    assert.equal(db.prepare("SELECT status FROM pm_seasonal_consent WHERE email=?").get("member@example.com").status,"pending");
    const wrong=new Request(SERVICE+"/api/seasonal-confirm",{method:"POST",headers:{"Origin":"https://evil.example","Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({token})});
    assert.equal((await route(wrong,env)).status,403);
    const proper=()=>new Request(SERVICE+"/api/seasonal-confirm",{method:"POST",headers:{"Origin":SERVICE,"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({token})});
    assert.equal((await route(proper(),env)).status,200);
    assert.equal(contacts.get("member@example.com").segments.has(env.SEASONAL_SEGMENT_ID),true);
    assert.equal(contacts.get("member@example.com").topics.get(env.SEASONAL_TOPIC_ID),"opt_in");
    assert.equal(db.prepare("SELECT status FROM pm_seasonal_consent WHERE email=?").get("member@example.com").status,"confirmed");
    assert.equal((await route(proper(),env)).status,410);
  });
  test("in-app email browsers with absent Origin can submit a valid confirmation token",async()=>{
    const r=await route(post("/api/seasonal-subscribe",signup("no-origin@example.com"),SITE,"16.16.16.16"),env);
    assert.equal(r.status,202);
    const token=emails.at(-1).text.match(/seasonal-confirm\?token=([0-9a-f]{64})/)[1];
    const form=()=>new Request(SERVICE+"/api/seasonal-confirm",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","Sec-Fetch-Site":"same-origin"},body:new URLSearchParams({token})});
    assert.equal((await route(form(),env)).status,200);
    assert.equal(contacts.get("no-origin@example.com").segments.has(env.SEASONAL_SEGMENT_ID),true);
    assert.equal((await route(form(),env)).status,410);
  });
  test("rejects incomplete summary-only and unsafe HTML snapshots",async()=>{
    const body=planBody("not-full@example.com");
    const before=browserCalls.length;
    const missing=await route(post("/api/send-plan",{...body,printSnapshot:undefined},SITE,"17.17.17.17"),env);
    assert.equal(missing.status,400);assert.equal(browserCalls.length,before);
    const summary=await route(post("/api/send-plan",{...body,printSnapshot:{...body.printSnapshot,markup:"<section id=\"print-plan\">Short summary</section>"}},SITE,"17.17.17.17"),env);
    assert.equal(summary.status,400);
    const malicious=await route(post("/api/send-plan",{...body,printSnapshot:{...body.printSnapshot,markup:body.printSnapshot.markup+"<script>alert(1)</script>"}},SITE,"17.17.17.17"),env);
    assert.equal(malicious.status,400);
    const remoteImage=await route(post("/api/send-plan",{...body,printSnapshot:{...body.printSnapshot,markup:body.printSnapshot.markup+'<img src="https://evil.example/collect" />'}},SITE,"17.17.17.17"),env);
    assert.equal(remoteImage.status,400);
    assert.equal(browserCalls.length,before);
  });
  test("full printable report yields a genuine PDF response via browser binding",async()=>{
    const report=samplePrintSnapshot();
    const pdf=await renderFullPrintPdf(env,report);
    assert.equal(pdf.filename,"PARKMEMOIR_Full_Winter_Trip_Plan.pdf");
    assert.equal(atob(pdf.content),examplePdfFixture());
  });
  test("marketing consent is required and unsubscribed contacts cannot be reactivated",async()=>{
    const denied=await route(post("/api/seasonal-subscribe",{...signup("skip@example.com"),consent:false},SITE,"7.7.7.7"),env);
    assert.equal(denied.status,400);
    contacts.set("unsubscribed@example.com",{id:"66666666-6666-4666-8666-666666666666",email:"unsubscribed@example.com",unsubscribed:true,segments:new Set()});
    const req=await route(post("/api/seasonal-subscribe",signup("unsubscribed@example.com"),SITE,"8.8.8.8"),env);assert.equal(req.status,202);
    const token=emails.at(-1).text.match(/seasonal-confirm\?token=([0-9a-f]{64})/)[1];
    const res=await route(new Request(SERVICE+"/api/seasonal-confirm",{method:"POST",headers:{Origin:SERVICE,"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({token})}),env);
    assert.equal(res.status,503);assert.equal(contacts.get("unsubscribed@example.com").segments.size,0);
  });

  test("pending duplicate signups never create extra marketing contacts or confirmations",async()=>{
    const before=emails.length;
    const first=await route(post("/api/seasonal-subscribe",signup("duplicate@example.com"),SITE,"9.9.9.9"),env);
    const second=await route(post("/api/seasonal-subscribe",signup("duplicate@example.com"),SITE,"9.9.9.9"),env);
    assert.equal(first.status,202);assert.equal(second.status,202);
    assert.equal(emails.length,before+1);
    assert.equal(contacts.has("duplicate@example.com"),false);
  });
  test("expired confirmation link cannot create marketing contact",async()=>{
    const r=await route(post("/api/seasonal-subscribe",signup("expired@example.com"),SITE,"10.10.10.10"),env);
    assert.equal(r.status,202);
    const token=emails.at(-1).text.match(/seasonal-confirm\?token=([0-9a-f]{64})/)[1];
    db.prepare("UPDATE pm_seasonal_consent SET expires_at=0 WHERE email=?").run("expired@example.com");
    const confirm=new Request(SERVICE+"/api/seasonal-confirm",{method:"POST",headers:{Origin:SERVICE,"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({token})});
    assert.equal((await route(confirm,env)).status,410);
    assert.equal(contacts.has("expired@example.com"),false);
  });
  test("provider email rejection fails closed and does not subscribe",async()=>{
    mailFails=true;
    try {
      const r=await route(post("/api/send-plan",planBody("provider-rejected@example.com"),SITE,"11.11.11.11"),env);
      assert.equal(r.status,502);assert.equal(contacts.has("provider-rejected@example.com"),false);
    } finally {mailFails=false;}
  });
  test("failed Segment membership leaves consent retryable but not confirmed",async()=>{
    const r=await route(post("/api/seasonal-subscribe",signup("segment-failed@example.com"),SITE,"12.12.12.12"),env);
    assert.equal(r.status,202);
    const token=emails.at(-1).text.match(/seasonal-confirm\?token=([0-9a-f]{64})/)[1];
    const confirm=()=>new Request(SERVICE+"/api/seasonal-confirm",{method:"POST",headers:{Origin:SERVICE,"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({token})});
    segmentFails=true;
    try {assert.equal((await route(confirm(),env)).status,503);}
    finally {segmentFails=false;}
    assert.equal(db.prepare("SELECT status FROM pm_seasonal_consent WHERE email=?").get("segment-failed@example.com").status,"pending");
    assert.equal((await route(confirm(),env)).status,200);
    assert.equal(db.prepare("SELECT status FROM pm_seasonal_consent WHERE email=?").get("segment-failed@example.com").status,"confirmed");
  });
  test("failed topic opt-in leaves consent pending and outside marketing segment",async()=>{
    const r=await route(post("/api/seasonal-subscribe",signup("topic-failed@example.com"),SITE,"14.14.14.14"),env);
    assert.equal(r.status,202);
    const token=emails.at(-1).text.match(/seasonal-confirm\?token=([0-9a-f]{64})/)[1];
    const request=()=>new Request(SERVICE+"/api/seasonal-confirm",{method:"POST",headers:{"Origin":SERVICE,"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({token})});
    topicFails=true;
    try{assert.equal((await route(request(),env)).status,503);}
    finally{topicFails=false;}
    assert.equal(db.prepare("SELECT status FROM pm_seasonal_consent WHERE email=?").get("topic-failed@example.com").status,"pending");
    assert.equal(contacts.get("topic-failed@example.com").segments.size,0);
    assert.equal((await route(request(),env)).status,200);
    assert.equal(contacts.get("topic-failed@example.com").topics.get(env.SEASONAL_TOPIC_ID),"opt_in");
  });
  test("repeated plan requests include a stable private idempotency key",async()=>{
    const before=emailKeys.length;
    const body=planBody("retry@example.com");
    assert.equal((await route(post("/api/send-plan",body,SITE,"15.15.15.15"),env)).status,200);
    assert.equal((await route(post("/api/send-plan",body,SITE,"15.15.15.15"),env)).status,200);
    assert.ok(emailKeys[before]?.startsWith("pm-full-print-v125-"));
    assert.equal(emailKeys[before],emailKeys[before+1]);
    assert.doesNotMatch(emailKeys[before],/retry@example.com/);
  });
  test("seasonal subscription rate cap blocks request seven from one IP",async()=>{
    let last;
    for(let i=0;i<7;i++)last=await route(post("/api/seasonal-subscribe",signup("rate"+i+"@example.com"),SITE,"13.13.13.13"),env);
    assert.equal(last.status,429);
  });
  test("unconfigured secrets and cleanup fail safely",async()=>{
    assert.equal((await route(post("/api/send-plan",planBody("test@example.com")), {...env,RESEND_API_KEY:""})).status,503);
    await cleanupExpired(env);
    assert.equal(db.prepare("SELECT count(*) as n FROM pm_seasonal_rate").get().n>0,true);
  });
after(()=>{globalThis.fetch=originally;});
