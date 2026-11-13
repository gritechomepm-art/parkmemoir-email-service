import test from "node:test";
import assert from "node:assert/strict";
import {validateChecklist,checklistPrintHtml,renderChecklistPdf,sendChecklist,DIRECT_CONSENT_VERSION} from "./checklist.mjs";

const goodEmail = s=>typeof s==="string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
const valid = (changes={})=>({
  email:"parent@example.com",seasonalUpdates:false,consent:false,consentVersion:null,
  sourcePage:"https://parkmemoir.com/national-park-packing-list/",
  trip:{family:"adult",season:"spring",stay:"day"},checkedItems:["water","map"],
  turnstileToken:"valid-turnstile-token",...changes
});
const uuid="38beef05-2084-4c3c-b96d-a96503b70e2e";
const pdfBytes=()=>new TextEncoder().encode("%PDF-1.7\n"+"0".repeat(800)+"\n%%EOF");
function setup({blocked=false,existing=false,topicFail=false,emailFail=false,verified=true,rate=true}={}) {
  const sends=[],sql=[],events=[],existingRow={value:blocked?"unsubscribed":null};
  let directRow=null;
  const env={
    RESEND_API_KEY:"mock-send",RESEND_CONTACTS_API_KEY:"mock-contact",EMAIL_FROM:"PARKMEMOIR <plans@example.com>",
    RATE_HASH_SECRET:"mock",TURNSTILE_SECRET_KEY:"mock",
    SEASONAL_SEGMENT_ID:uuid,SEASONAL_TOPIC_ID:uuid,
    BROWSER:{quickAction: async(name,options)=>{
      assert.equal(name,"pdf");assert.match(options.html,/National Park Packing List/);
      return new Response(pdfBytes(),{status:200,headers:{"Content-Type":"application/pdf"}});
    }},
    SUBSCRIBERS:{
      prepare(query){
        sql.push(query);
        return {
          bind(...args){
            return {
              async first(){
                if(query.includes("pm_seasonal_consent"))return existingRow.value?{status:existingRow.value}:null;
                if(query.includes("pm_checklist_direct_consent"))return directRow?{status:directRow}:null;
                return null;
              },
              async run(){
                if(query.includes("pm_checklist_direct_consent")) {
                  directRow=query.includes("VALUES(?,'confirmed'")?"confirmed":"pending";
                }
                return {meta:{changes:1}};
              }
            };
          }
        };
      }
    }
  };
  let subscribed=existing;
  const api={
    validEmail:goodEmail,
    baseReady:()=>true,
    readJSON:async request=>request.json(),
    verified:async(_request,_env,_token,action)=>{events.push(action);return verified;},
    rate:async()=>rate,
    now:()=>1794570000,
    digest:async s=>"a".repeat(64),
    respond:(status,value)=>Response.json(value,{status}),
    resend:async(_env,path,method,body,options)=>{
      events.push(path);
      if(path==="/emails"){
        sends.push(body);return {ok:!emailFail,status:emailFail?502:200,data:{id:uuid}};
      }
      if(path.includes("/topics")) {
        assert.deepEqual(body,[{id:uuid,subscription:"opt_in"}]);
        return {ok:!topicFail,status:topicFail?502:200,data:{}};
      }
      if(path.includes("/segments/")){subscribed=true;return {ok:true,status:200,data:{}};}
      if(path.startsWith("/contacts/")&&method==="GET"){
        return existing?{ok:true,status:200,data:{id:uuid,unsubscribed:blocked}}:
                        {ok:false,status:404,data:{}};
      }
      if(path==="/contacts"&&method==="POST") {
        assert.equal(body.email,"parent@example.com");
        assert.equal(body.unsubscribed,false);
        return {ok:true,status:201,data:{id:uuid}};
      }
      throw Error("Unexpected Resend "+method+" "+path);
    }
  };
  const request=d=>new Request("https://email.parkmemoir.com/api/send-checklist",{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(d)
  });
  return {env,api,sends,sql,events,request,get directStatus(){return directRow;},get subscribed(){return subscribed;}};
}
test("Data whitelist requires valid filters, only visible IDs, and separate explicit consent",()=>{
  assert.ok(validateChecklist(valid(),goodEmail));
  assert.equal(validateChecklist(valid({checkedItems:["winter-car"]}),goodEmail),null);
  assert.equal(validateChecklist(valid({checkedItems:["water","water"]}),goodEmail),null);
  assert.equal(validateChecklist(valid({trip:{family:"adult",season:"spring",stay:"invalid"}}),goodEmail),null);
  assert.equal(validateChecklist(valid({seasonalUpdates:true,consent:false}),goodEmail),null);
  assert.equal(validateChecklist(valid({seasonalUpdates:true,consent:true,consentVersion:null}),goodEmail),null);
  assert.equal(validateChecklist(valid({email:"not-email"}),goodEmail),null);
  assert.equal(validateChecklist(valid({sourcePage:"https://evil.example/national-park-packing-list/"}),goodEmail),null);
  assert.equal(validateChecklist(valid({unexpected:true}),goodEmail),null);
  assert.ok(validateChecklist(valid({seasonalUpdates:true,consent:true,consentVersion:DIRECT_CONSENT_VERSION}),goodEmail));
});
test("PDF derives visible items from trusted catalog and retains checkmarks",async()=>{
  const p=validateChecklist(valid(),goodEmail),h=checklistPrintHtml(p);
  assert.match(h,/&#9745;/);assert.match(h,/Water bottles/);
  assert.doesNotMatch(h,/Ice scraper/);
  assert.doesNotMatch(h,/<script/i);
  const {env}=setup();
  const pdf=await renderChecklistPdf(env,p);
  assert.equal(pdf.filename,"PARKMEMOIR_National_Park_Packing_List.pdf");
  assert.ok(pdf.content.length>700);
});
test("Default send delivers once only; no contact/segment actions when unchecked",async()=>{
  const x=setup();
  const response=await sendChecklist(x.request(valid()),x.env,x.api);
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{ok:true,checklist:"accepted",seasonal:"not_requested"});
  assert.equal(x.sends.length,1);
  assert.equal(x.sends[0].attachments[0].filename,"PARKMEMOIR_National_Park_Packing_List.pdf");
  assert.equal(x.subscribed,false);
  assert.deepEqual(x.events,["checklist_send","/emails"]);
});
test("Explicit checkbox subscribes in same request, without confirmation mail",async()=>{
  const x=setup();
  const request=valid({seasonalUpdates:true,consent:true,consentVersion:DIRECT_CONSENT_VERSION});
  const response=await sendChecklist(x.request(request),x.env,x.api);
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.seasonal,"subscribed");
  assert.equal(x.directStatus,"confirmed");
  assert.equal(x.sends.length,1);
  assert.equal(x.subscribed,true);
  assert.ok(!x.events.some(s=>s.includes("seasonal-confirm")));
});
test("Existing global unsubscribe is never silently reactivated",async()=>{
  const x=setup({blocked:true,existing:true});
  const response=await sendChecklist(x.request(valid({
    seasonalUpdates:true,consent:true,consentVersion:DIRECT_CONSENT_VERSION
  })),x.env,x.api);
  const body=await response.json();
  assert.equal(body.ok,true);
  assert.equal(body.seasonal,"blocked");
  assert.equal(x.sends.length,1);
  assert.equal(x.subscribed,true); // pre-existing contact, no new join
  assert.ok(!x.events.some(s=>s.includes("/topics")||s.includes("/segments/")));
});
test("Marketing provider failure never masquerades as subscription success",async()=>{
  const x=setup({topicFail:true});
  const response=await sendChecklist(x.request(valid({
    seasonalUpdates:true,consent:true,consentVersion:DIRECT_CONSENT_VERSION
  })),x.env,x.api);
  assert.equal(response.status,200);
  assert.equal((await response.json()).seasonal,"failed");
  assert.equal(x.directStatus,"pending");
  assert.equal(x.sends.length,1);
});
test("Invalid request, bad token, throttling and provider email failure fail closed",async()=>{
  const invalid=setup();
  assert.equal((await sendChecklist(invalid.request(valid({email:"invalid"})),invalid.env,invalid.api)).status,400);
  const token=setup({verified:false});
  assert.equal((await sendChecklist(token.request(valid()),token.env,token.api)).status,403);
  const limited=setup({rate:false});
  assert.equal((await sendChecklist(limited.request(valid()),limited.env,limited.api)).status,429);
  const provider=setup({emailFail:true});
  assert.equal((await sendChecklist(provider.request(valid()),provider.env,provider.api)).status,502);
  assert.ok(!provider.events.some(s=>s.includes("/contacts")));
});
