#!/usr/bin/env node
// Independent, unprivileged update worker. Run from a separate hosting service.
// Only installs a GitHub SHA that has passed Creative Soundwerks CI.
import {execFile} from "node:child_process";
import {readFile,writeFile,mkdir,rename,rm,symlink,statfs,lstat} from "node:fs/promises";
import {join,dirname,resolve} from "node:path";
import {parse} from "dotenv";

const app=resolve(process.env.CSW_INSTALL_ROOT||process.cwd());
const configFile=resolve(process.env.CSW_CONFIG_PATH||join(app,".env"));
const settings=parse(await readFile(configFile,"utf8"));
const home=resolve(process.env.CSW_UPDATE_ROOT||settings.CSW_UPDATE_ROOT||join(dirname(configFile),"csw-updates"));
const shaPattern=/^[a-f0-9]{40}$/;
const repo="developeronesw/CreativeSoundwerks2";
const env={...process.env,CSW_CONFIG_PATH:configFile,CSW_INSTALL_ROOT:app,CSW_UPDATE_ROOT:home,
 PATH:"/usr/bin:/bin",NODE_ENV:"production",HOME:home};
function run(command,args,cwd=app,extra={}){
 return new Promise((resolve,reject)=>{
  execFile(command,args,{cwd,env:{...env,...extra},timeout:600000,maxBuffer:1048576},error=>{
   if(error)reject(Error("update_step_failed"));else resolve();
  });
 });
}
async function github(path){
 const r=await fetch("https://api.github.com/repos/"+repo+path,{
  redirect:"error",signal:AbortSignal.timeout(10000),
  headers:{"Accept":"application/vnd.github+json","User-Agent":"CSW-Self-Updater"}});
 if(!r.ok)throw Error("github_unavailable");
 return r.json();
}
async function approved(sha){
 const ref=await github("/git/ref/heads/main");
 if(ref?.object?.sha!==sha)throw Error("remote_revision_changed");
 const list=await github("/actions/runs?head_sha="+sha+"&per_page=30");
 const matches=(Array.isArray(list?.workflow_runs)?list.workflow_runs:[]).filter(x=>
  x.name==="Creative Soundwerks CI"&&x.head_sha===sha&&
  x.head_branch==="main"&&x.event==="push");
 if(matches.length!==1||matches[0].status!=="completed"||matches[0].conclusion!=="success")
  throw Error("ci_not_approved");
}
async function save(stage,job,error=null){
 const existing=await readFile(join(home,"status.json"),"utf8").then(JSON.parse).catch(()=>({}));
 await writeFile(join(home,"status.json"),JSON.stringify({
  ...existing,stage,targetSha:job?.targetSha||null,jobId:job?.id||null,
  error,updatedAt:new Date().toISOString()
 }),{mode:0o600});
}
await mkdir(home,{recursive:true,mode:0o700});
await writeFile(join(home,"worker.json"),JSON.stringify({seenAt:new Date().toISOString()}),{mode:0o600});
const requestFile=join(home,"request.json");
const job=await readFile(requestFile,"utf8").then(JSON.parse).catch(()=>null);
if(job){
 try{
  if(typeof job.id!=="string"||!/^[a-f0-9-]{36}$/.test(job.id)||
   !shaPattern.test(job.targetSha)||Number.isNaN(Date.parse(job.createdAt)))
   throw Error("invalid_update_request");
  await approved(job.targetSha);
  const disk=await statfs(home);
  if(Number(disk.bavail)*Number(disk.bsize)<1073741824)throw Error("disk_space_low");
  await save("building",job);
  const releases=join(home,"releases");
  const stage=join(releases,job.targetSha);
  await mkdir(releases,{recursive:true,mode:0o700});
  await mkdir(stage,{mode:0o700});
  await run("/usr/bin/git",["init","-q"],stage);
  await run("/usr/bin/git",["remote","add","origin","https://github.com/"+repo+".git"],stage);
  await run("/usr/bin/git",["fetch","--depth","1","--no-tags","origin",job.targetSha],stage);
  await run("/usr/bin/git",["checkout","-q","--detach","FETCH_HEAD"],stage);
  await run("/usr/bin/npm",["install","--include=dev","--no-audit","--no-fund"],stage);
  await run("/usr/bin/npm",["run","check"],stage);
  await run("/usr/bin/npm",["run","build"],stage);
  await writeFile(join(stage,".csw-revision"),job.targetSha+"\n",{mode:0o600});
  await rm(join(stage,".git"),{recursive:true,force:true});
  await save("backing_up",job);
  const db=new URL(settings.DATABASE_URL||"");
  if(!["postgresql:","postgres:"].includes(db.protocol))throw Error("database_configuration_missing");
  const password=db.password;
  db.password="";
  const backupDir=join(home,"backups");
  await mkdir(backupDir,{recursive:true,mode:0o700});
  const backup=join(backupDir,"db-"+job.id+".dump");
  await run("/usr/bin/pg_dump",["--format=custom","--no-owner",
   "--no-privileges","--file="+backup,"--dbname="+db.toString()],home,{PGPASSWORD:password});
  const backupFile=await lstat(backup);
  if(!backupFile.isFile()||backupFile.size===0)throw Error("database_backup_failed");
  await save("migrating",job);
  await run("/usr/bin/npm",["run","db:migrate"],stage,{DATABASE_URL:settings.DATABASE_URL});
  const temp=join(home,"current-next");
  await rm(temp,{force:true});
  await symlink(stage,temp);
  await rename(temp,join(home,"current"));
  await save("restart_required",job);
 }catch(error){
  await save("failed",job,error instanceof Error?error.message:"update_failed");
 }finally{
  await rm(requestFile,{force:true});
 }
}
