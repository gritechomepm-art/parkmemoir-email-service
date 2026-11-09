import test from "node:test";
import assert from "node:assert/strict";
import {bindingNames,liveVersion,uploadMetadata,lastUploadedVersion,deploy} from "./deploy-email-worker.mjs";
const previous="11111111-1111-4111-8111-111111111111";
const next="22222222-2222-4222-8222-222222222222";
const sha="a".repeat(40);
const account="b".repeat(32);
const required=[
  ["EMAIL_FROM","plain_text"],["RATE_HASH_SECRET","secret_text"],
  ["RESEND_API_KEY","secret_text"],["RESEND_CONTACTS_API_KEY","secret_text"],
  ["SEASONAL_SEGMENT_ID","plain_text"],["SEASONAL_TOPIC_ID","plain_text"],
  ["TURNSTILE_SECRET_KEY","secret_text"],["SUBSCRIBERS","d1"],
  ["BROWSER","browser_rendering"]
].map(([name,type])=>({name,type}));
test("requires one 100% deployed Worker",()=>{
  assert.equal(liveVersion({deployments:[{versions:[{version_id:previous,percentage:100}]}]}),previous);
  assert.throws(()=>liveVersion({deployments:[{versions:[{version_id:previous,percentage:50},{version_id:next,percentage:50}]}]}),/exactly one/);
});
test("checks names, secret type, D1 and Browser Run without reading private values",()=>{
  const names=bindingNames(required);
  assert.equal(names.length,9);
  assert.equal(uploadMetadata(names,sha).bindings.every(x=>x.type==="inherit"),true);
  assert.throws(()=>bindingNames(required.filter(x=>x.name!=="BROWSER")),/BROWSER/);
  assert.throws(()=>bindingNames(required.map(x=>x.name==="SUBSCRIBERS"?{...x,type:"plain_text"}:x)),/D1/);
  assert.throws(()=>bindingNames(required.map(x=>x.name==="RESEND_API_KEY"?{...x,type:"plain_text"}:x)),/secret/);
  assert.throws(()=>bindingNames([...required,required[0]]),/Duplicate/);
});
test("latest upload must have a verifiable version id",()=>{
  assert.equal(lastUploadedVersion({items:[{id:previous}]}),previous);
  assert.throws(()=>lastUploadedVersion({items:[]}),/latest/);
});
function fakeCloudflare({health=true,bindingList=required,latest=previous,rollBackFails=false,mutateDeploy=false}={}){
  const calls=[];let deployed=previous;let upload;
  const result=(obj,status=200)=>new Response(JSON.stringify(obj),{status,headers:{"Content-Type":"application/json"}});
  const fetcher=async (url,opts={})=>{
    const u=new URL(url),method=opts.method||"GET";
    calls.push({path:u.pathname,method});
    if(u.hostname==="email.parkmemoir.com")return result(health?{ok:true,service:"parkmemoir-email",status:"configured"}:{ok:false},health?200:503);
    if(u.hostname!=="api.cloudflare.com"||!u.pathname.includes("/scripts/parkmemoir-email"))
      throw Error("Wrong Cloudflare target");
    if(u.pathname.endsWith("/deployments")&&method==="GET"){
      return result({success:true,result:{deployments:[{versions:[{version_id:deployed,percentage:100}]}]}});
    }
    if(u.pathname.endsWith("/deployments")&&method==="POST"){
      const body=JSON.parse(opts.body),id=body.versions[0].version_id;
      if(rollBackFails&&id===previous)return result({success:false},403);
      deployed=id;return result({success:true,result:{versions:body.versions}});
    }
    if(u.pathname.endsWith("/settings"))return result({success:true,result:{bindings:bindingList,compatibility_date:"2026-11-09"}});
    if(u.pathname.endsWith("/versions")&&method==="GET")
      return result({success:true,result:{items:[{id:latest}]}});
    if(u.pathname.endsWith("/versions")&&method==="POST"){
      upload=opts.body;
      assert.ok(upload instanceof FormData);
      const metadata=JSON.parse(await upload.get("metadata").text());
      assert.equal(metadata.bindings.length,9);
      assert.equal(metadata.bindings.every(x=>x.type==="inherit"),true);
      return result({success:true,result:{id:next}});
    }
    if(u.pathname.endsWith("/versions/"+next))return result({success:true,result:{bindings:bindingList}});
    return result({success:false},404);
  };
  return {calls,fetcher,get deployed(){return deployed;},get upload(){return upload;}};
}
const args={token:"example-only-token-do-not-use",account,sha,source:"export default {fetch() { return new Response('ok'); }};".repeat(500)};
test("preflight fails BEFORE upload if browser binding is absent",async()=>{
  const stub=fakeCloudflare({bindingList:required.filter(x=>x.name!=="BROWSER")});
  await assert.rejects(()=>deploy({...args,fetcher:stub.fetcher}),/BROWSER/);
  assert.equal(stub.calls.some(x=>x.method!=="GET"),false);
});
test("preflight fails BEFORE upload when a newer unpublished version exists",async()=>{
  const stub=fakeCloudflare({latest:next});
  await assert.rejects(()=>deploy({...args,fetcher:stub.fetcher}),/Unpublished/);
  assert.equal(stub.calls.some(x=>x.method!=="GET"),false);
});
test("successful deploy targets only parkmemoir-email with inherited bindings",async()=>{
  const stub=fakeCloudflare();
  const r=await deploy({...args,fetcher:stub.fetcher});
  assert.equal(r.newVersion,next);
  assert.equal(r.priorVersion,previous);
  assert.equal(stub.deployed,next);
  assert.equal(stub.calls.filter(x=>x.path.endsWith("/deployments")&&x.method==="POST").length,1);
  assert.ok(stub.calls.every(x=>!x.path.includes("parkmemoir-public-p0")));
  assert.match(r.status,/REAL_EMAIL_QA_PENDING/);
});
test("failed health check rolls back to original 100% version",async()=>{
  const stub=fakeCloudflare({health:false});
  await assert.rejects(()=>deploy({...args,fetcher:stub.fetcher}),/previous Worker version restored/);
  assert.equal(stub.deployed,previous);
  assert.equal(stub.calls.filter(x=>x.path.endsWith("/deployments")&&x.method==="POST").length,2);
});
test("rollback failure is surfaced rather than falsely reporting success",async()=>{
  const stub=fakeCloudflare({health:false,rollBackFails:true});
  await assert.rejects(()=>deploy({...args,fetcher:stub.fetcher}),/rollback ALSO failed/);
  assert.equal(stub.deployed,next);
});
