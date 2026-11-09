/**
 * Isolated PARKMEMOIR email Worker release using the official Cloudflare
 * Worker Versions API. Does not touch parkmemoir-public-p0 or change routes.
 * Inherits all bindings from the latest Worker version, fail-closed.
 */
import {readFile} from "node:fs/promises";

const NAME="parkmemoir-email";
const REQUIRED=new Set([
 "EMAIL_FROM","RATE_HASH_SECRET","RESEND_API_KEY","RESEND_CONTACTS_API_KEY",
 "SEASONAL_SEGMENT_ID","SEASONAL_TOPIC_ID","TURNSTILE_SECRET_KEY",
 "SUBSCRIBERS","BROWSER",
]);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{40}$/i;

export function liveVersion(payload){
  const deployments=payload?.deployments;
  if(!Array.isArray(deployments)||!deployments.length)throw Error("No Cloudflare deployment");
  const versions=deployments[0]?.versions;
  if(!Array.isArray(versions)||versions.length!==1||versions[0].percentage!==100||!UUID.test(versions[0].version_id))
    throw Error("Live Worker must have exactly one version at 100%");
  return versions[0].version_id;
}
export function bindingNames(bindings){
  if(!Array.isArray(bindings))throw Error("Cloudflare bindings unavailable");
  const names=new Set(),types=new Map();
  for(const b of bindings){
    if(!b||typeof b.name!=="string"||typeof b.type!=="string"||names.has(b.name))
      throw Error("Duplicate or malformed binding");
    names.add(b.name);types.set(b.name,b.type);
  }
  for(const name of REQUIRED)if(!names.has(name))throw Error("Required Worker binding missing: "+name);
  if(types.get("SUBSCRIBERS")!=="d1")throw Error("SUBSCRIBERS must be existing D1");
  if(types.get("BROWSER")!=="browser_rendering")throw Error("BROWSER must be Browser Run");
  for(const name of ["RESEND_API_KEY","RESEND_CONTACTS_API_KEY","RATE_HASH_SECRET","TURNSTILE_SECRET_KEY"])
    if(!["secret_text","secret_key"].includes(types.get(name)))throw Error("Required secret binding type mismatch: "+name);
  return [...names].sort();
}
export function uploadMetadata(names,sha){
  if(!SHA.test(sha)||!Array.isArray(names)||names.length<REQUIRED.size)throw Error("Invalid upload metadata inputs");
  return {
    main_module:"worker.mjs",
    compatibility_date:"2026-11-09",
    bindings:names.map(name=>({type:"inherit",name})),
    annotations:{"workers/message":"Email full PDF, DOI fix, source "+sha.slice(0,12),"workers/commit_sha":sha}
  };
}
export function lastUploadedVersion(payload){
  // API versions are ordered newest-first. Version inherited bindings are
  // resolved against latest UPLOADED, not necessarily the live deployment.
  const items=payload?.items??payload?.versions??payload;
  if(!Array.isArray(items)||!items.length||!UUID.test(items[0]?.id))
    throw Error("Cannot establish latest uploaded Worker version");
  return items[0].id;
}
const cfUrl=(account,path)=>"https://api.cloudflare.com/client/v4/accounts/"+account+
  "/workers/scripts/"+NAME+path;
export async function deploy({token,account,sha,fetcher=fetch,source}){
  if(!token||!(/^[0-9a-f]{32}$/i.test(account||""))||!SHA.test(sha)||typeof source!=="string"||source.length<10000)
    throw Error("Missing credentials, exact commit or Worker source");
  const api=async (method,path,body,headers={})=>{
    const r=await fetcher(cfUrl(account,path),{
      method,headers:{Authorization:"Bearer "+token,...headers},...(body?{body}:{})
    });
    if(!r.ok)throw Error("Cloudflare "+method+" "+path.split("?")[0]+" HTTP "+r.status);
    const j=await r.json();
    if(j.success!==true)throw Error("Cloudflare rejected "+method+" "+path.split("?")[0]);
    return j.result;
  };
  const existing=liveVersion(await api("GET","/deployments"));
  const settings=await api("GET","/settings");
  const names=bindingNames(settings?.bindings);
  if(settings?.compatibility_date && settings.compatibility_date>"2026-11-09")
    throw Error("Current Worker compatibility date is newer than reviewed build");
  const versions=await api("GET","/versions?per_page=1");
  if(lastUploadedVersion(versions)!==existing)
    throw Error("Unpublished Worker version exists: cannot safely inherit bindings");
  // No remote mutation occurs until all preflight checks above pass.
  const form=new FormData();
  form.append("metadata",new Blob([JSON.stringify(uploadMetadata(names,sha))],{type:"application/json"}),"metadata.json");
  form.append("worker.mjs",new Blob([source],{type:"application/javascript+module"}),"worker.mjs");
  const next=await api("POST","/versions?bindings_inherit=strict",form);
  const version=next?.id;
  if(!UUID.test(version||""))throw Error("Version upload did not return ID");

  // Verify binding names/types on newly uploaded version before switching traffic.
  const uploaded=await api("GET","/versions/"+version);
  const nextNames=bindingNames(uploaded?.bindings);
  if(names.join("\n")!==nextNames.join("\n"))throw Error("Uploaded version binding set changed");

  // Compare-and-swap: refuse to replace a Worker deployed by someone else.
  if(liveVersion(await api("GET","/deployments"))!==existing)
    throw Error("Worker deployment changed during staging; no traffic switch");
  const deploymentBody=versionId=>JSON.stringify({
    strategy:"percentage",versions:[{percentage:100,version_id:versionId}]
  });
  await api("POST","/deployments",deploymentBody(version),{"Content-Type":"application/json"});
  let healthy=false,reason="health";
  try{
    const status=await fetcher("https://email.parkmemoir.com/health",{headers:{"Cache-Control":"no-cache"}});
    const j=await status.json();
    healthy=status.status===200 && j.ok===true && j.service==="parkmemoir-email" && j.status==="configured";
    if(!healthy)reason="health mismatch";
  }catch{reason="health fetch";}
  if(!healthy){
    // A failed health check automatically restores the preceding 100% Worker.
    try{
      await api("POST","/deployments",deploymentBody(existing),{"Content-Type":"application/json"});
    }catch{
      throw Error("Health check failed and automatic rollback ALSO failed; operator action required");
    }
    throw Error("Health check failed ("+reason+"); previous Worker version restored");
  }
  return {name:NAME,priorVersion:existing,newVersion:version,sha,status:"DEPLOYED_HEALTH_ONLY; REAL_EMAIL_QA_PENDING"};
}
if(import.meta.url===new URL("file://"+process.argv[1]).href){
  const sha=process.env.GITHUB_SHA;
  const result=await deploy({
    token:process.env.CLOUDFLARE_API_TOKEN,
    account:process.env.CLOUDFLARE_ACCOUNT_ID,
    sha,source:await readFile("worker.mjs","utf8")
  });
  console.log("EMAIL_WORKER_RELEASE "+JSON.stringify(result));
}
