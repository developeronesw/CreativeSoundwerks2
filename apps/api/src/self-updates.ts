import type {FastifyInstance,FastifyRequest} from "fastify";
import {requireRole} from "./auth.js";
import {query} from "./db.js";
import argon2 from "argon2";
import {z} from "zod";
import {join,dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {mkdir,readFile,writeFile,open} from "node:fs/promises";
import {randomUUID} from "node:crypto";

const repo="developeronesw/CreativeSoundwerks2";
const sha=/^[a-f0-9]{40}$/;
const initial="b4110f83a186dff110faf0f69312397904ad1930";
const config=resolve(process.env.CSW_CONFIG_PATH||fileURLToPath(new URL("../../../.env",import.meta.url)));
export function updateHome(){
 return resolve(process.env.CSW_UPDATE_ROOT||join(dirname(config),"csw-updates"));
}
export async function updateHeartbeat(){
 const dir=updateHome();
 await mkdir(dir,{recursive:true,mode:0o700});
 await writeFile(join(dir,"server.json"),JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}),{mode:0o600});
}
async function readJson(path:string){
 try{return JSON.parse(await readFile(path,"utf8")) as Record<string,unknown>;}
 catch{return null;}
}
async function github(path:string){
 const response=await fetch("https://api.github.com/repos/"+repo+path,{
  headers:{"Accept":"application/vnd.github+json","User-Agent":"Creative-Soundwerks-Self-Updater",
    "X-GitHub-Api-Version":"2022-11-28"},
  redirect:"error",signal:AbortSignal.timeout(9000)
 });
 if(!response.ok)throw Error(response.status===403||response.status===429?"github_rate_limited":"github_unavailable");
 return response.json() as Promise<any>;
}
export async function officialRelease(){
 const ref=await github("/git/ref/heads/main");
 const latest=ref?.object?.sha;
 if(typeof latest!=="string"||!sha.test(latest))throw Error("invalid_remote_revision");
 const data=await github("/actions/runs?head_sha="+latest+"&per_page=30");
 const runs=(Array.isArray(data?.workflow_runs)?data.workflow_runs:[]).filter((run:any)=>
  run?.name==="Creative Soundwerks CI"&&run?.head_sha===latest&&
  run?.head_branch==="main"&&run?.event==="push");
 const approved=runs.length===1&&runs[0].status==="completed"&&runs[0].conclusion==="success";
 return {latestSha:latest,approved,ciStatus:runs.length===1?runs[0].status+"/"+runs[0].conclusion:"unverified",
  ciUrl:runs.length===1?"https://github.com/"+repo+"/actions/runs/"+runs[0].id:null};
}
async function installedRevision(){
 const state=await readJson(join(updateHome(),"status.json"));
 const revision=state?.installedSha;
 return typeof revision==="string"&&sha.test(revision)?revision:
  process.env.CSW_ACTIVE_SHA&&sha.test(process.env.CSW_ACTIVE_SHA)?process.env.CSW_ACTIVE_SHA:initial;
}
const action=z.object({targetSha:z.string().regex(sha),password:z.string().min(1).max(256),
 confirmed:z.literal(true)}).strict();
async function requireOwnerAuth(req:FastifyRequest){
 const u=await requireRole(req,["admin"]);
 const origin=req.headers.origin;
 const expected=process.env.PUBLIC_APP_URL;
 if(!expected||!origin||origin!==new URL(expected).origin)
  throw Object.assign(new Error("Update request origin rejected"),{statusCode:403});
 return u;
}
export async function selfUpdateRoutes(app:FastifyInstance){
 app.get("/api/admin/updates",async req=>{
  await requireRole(req,["admin"]);
  const dir=updateHome();
  const [state,worker]=await Promise.all([
   readJson(join(dir,"status.json")),readJson(join(dir,"worker.json"))
  ]);
  const healthy=!!worker&&typeof worker.seenAt==="string"&&
    Date.now()-Date.parse(worker.seenAt)<180000;
  let release=null,error:string|null=null;
  try{release=await officialRelease();}catch(e){error=e instanceof Error?e.message:"github_unavailable";}
  const current=await installedRevision();
  return {currentSha:current,latestSha:release?.latestSha??null,
   updateAvailable:release?current!==release.latestSha:false,
   approved:release?.approved??false,ciStatus:release?.ciStatus??"unavailable",
   ciUrl:release?.ciUrl??null,workerReady:healthy,
   state:state?{stage:state.stage??"unknown",targetSha:state.targetSha??null,
    error:state.error??null,updatedAt:state.updatedAt??null}:null,error};
 });
 app.post("/api/admin/updates/apply",{config:{rateLimit:{max:3,timeWindow:"1 minute"}}},async(req,reply)=>{
  const admin=await requireOwnerAuth(req);
  const input=action.parse(req.body);
  const password=await query<{password_hash:string}>("SELECT password_hash FROM users WHERE id=$1 AND role='admin'",[admin.id]);
  if(!password.rowCount||!(await argon2.verify(password.rows[0].password_hash,input.password)))
   return reply.code(403).send({error:"Administrator password invalid"});
  const dir=updateHome();
  const heartbeat=await readJson(join(dir,"worker.json"));
  if(!heartbeat||typeof heartbeat.seenAt!=="string"||
   Date.now()-Date.parse(heartbeat.seenAt)>180000)
   return reply.code(503).send({error:"Independent Creative Soundwerks updater service is not running"});
  const release=await officialRelease();
  if(!release.approved)return reply.code(409).send({error:"Official GitHub CI has not passed"});
  if(input.targetSha!==release.latestSha)return reply.code(409).send({error:"Update target changed. Check for updates again"});
  if((await installedRevision())===input.targetSha)return reply.code(409).send({error:"Already up to date"});
  const state=await readJson(join(dir,"status.json"));
  if(["queued","building","backing_up","migrating","restarting","verifying","restoring"].includes(String(state?.stage)))
   return reply.code(409).send({error:"An update is already in progress"});
  await mkdir(dir,{recursive:true,mode:0o700});
  const job={id:randomUUID(),targetSha:input.targetSha,createdAt:new Date().toISOString()};
  const fd=await open(join(dir,"request.json"),"wx",0o600).catch((e:NodeJS.ErrnoException)=>{
   if(e.code==="EEXIST")throw Object.assign(new Error("An update request is already pending"),{statusCode:409});
   throw e;
  });
  try{await fd.writeFile(JSON.stringify(job));}finally{await fd.close();}
  return reply.code(202).send({accepted:true,jobId:job.id,targetSha:job.targetSha});
 });
}
