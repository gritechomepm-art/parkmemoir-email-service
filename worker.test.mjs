import test, {after} from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {route,cleanupExpired} from "./worker.mjs";
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
const env={SUBSCRIBERS:D1,RESEND_API_KEY:"TEST_ONLY",RESEND_CONTACTS_API_KEY:"CONTACTS_TEST_ONLY",EMAIL_FROM:"PARKMEMOIR <plans@mail.parkmemoir.com>",TURNSTILE_SECRET_KEY:"TEST_ONLY",RATE_HASH_SECRET:"TEST_ONLY",SEASONAL_SEGMENT_ID:"33333333-3333-4333-8333-333333333333",SEASONAL_TOPIC_ID:"77777777-7777-4777-8777-777777777777"};
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
function planBody(email){return {requestedOnly:true,email,turnstileToken:"plan-token",pageUrl:SITE+"/which-national-parks-are-open-in-winter/",npsUrl:"https://www.nps.gov/zion/planyourvisit/conditions.htm",plan:{v:1,park:"zion",month:"nov",days:2,stay:"camping",load:["fridge","phones"],recharge:"none",method:"none",vehicleConfirmed:false,portableAway:false,fridgeW:18,fridgeModel:"bodega-t36",fridgePlug:"cigarette",fridgePeak:"",fridgeOwned:"no",unchecked:["warm"],sample:false}};}
const originally=globalThis.fetch;
globalThis.fetch=fakeFetch;
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
    assert.ok(emailKeys[before]?.startsWith("pm-plan-"));
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
