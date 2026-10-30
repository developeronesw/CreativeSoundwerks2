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
async function save(stage,job,error=null,extra={}){
 const existing=await readFile(join(home,"status.json"),"utf8").then(JSON.parse).catch(()=>({}));
 await writeFile(join(home,"status.json"),JSON.stringify({
  ...existing,stage,targetSha:job?.targetSha||null,jobId:job?.id||null,
  error,...extra,updatedAt:new Date().toISOString()
 }),{mode:0o600});
}
await mkdir(home,{recursive:true,mode:0o700});
await writeFile(join(home,"worker.json"),JSON.stringify({seenAt:new Date().toISOString()}),{mode:0o600});
const requestFile=join(home,"request.json");
const statusFile=join(home,"status.json");
const status=await readFile(statusFile,"utf8").then(JSON.parse).catch(()=>null);
const health=async(expected)=>{
 const deadline=Date.now()+45000;
 while(Date.now()<deadline){
  try{
   const res=await fetch("http://127.0.0.1:"+(settings.PORT||"8787")+"/api/health",{
    signal:AbortSignal.timeout(3500)
   });
   if(res.ok){
    const result=await res.json();
    if(result.ok===true&&(expected===null||result.revision===expected))return true;
   }
  }catch{}
  await new Promise(resolve=>setTimeout(resolve,1200));
 }
 return false;
};
async function restorePrevious(state){
 const pointer=join(home,"current"),temp=join(home,"current-next");
 await rm(temp,{force:true});
 if(state.previousRelease){
  await symlink(state.previousRelease,temp);
  await rename(temp,pointer);
 }else await rm(pointer,{force:true});
 const db=new URL(settings.DATABASE_URL||"");
 if(!["postgresql:","postgres:"].includes(db.protocol)||!state.backupFile)
  throw Error("database_backup_unavailable");
 const password=decodeURIComponent(db.password);db.password="";
 await run("/usr/bin/pg_restore",["--clean","--if-exists","--no-owner",
  "--no-privileges","--exit-on-error","--dbname="+db.toString(),
  join(home,"backups",state.backupFile)],home,{PGPASSWORD:password});
 await writeFile(join(home,"restart.flag"),"rollback\n",{mode:0o600});
}
if(status?.stage==="restart_required"){
 if(await health(status.targetSha)){
  await save("succeeded",status,null,{installedSha:status.targetSha});
  await rm(join(home,"maintenance.flag"),{force:true});
 }else{
  try{
   await restorePrevious(status);
   await save("rollback_restart_required",status,"new_release_unhealthy");
  }catch{
   await save("needs_inspection",status,"rollback_requires_inspection");
  }
 }
}else if(status?.stage==="rollback_restart_required"){
 if(await health(shaPattern.test(status.previousSha||"")?status.previousSha:null)){
  await save("rolled_back",status,"new_release_unhealthy",{installedSha:status.previousSha});
  await rm(join(home,"maintenance.flag"),{force:true});
 }else await save("needs_inspection",status,"rollback_site_unhealthy");
}else{
 const job=await readFile(requestFile,"utf8").then(JSON.parse).catch(()=>null);
 if(job){
  let migrated=false,backupExists=false,switched=false;
  let oldPointer=null,backup=null;
  try{
   if(typeof job.id!=="string"||!/^[a-f0-9-]{36}$/.test(job.id)||
    !shaPattern.test(job.targetSha)||Number.isNaN(Date.parse(job.createdAt))||
    Math.abs(Date.now()-Date.parse(job.createdAt))>86400000)
    throw Error("invalid_update_request");
   await approved(job.targetSha);
   const disk=await statfs(home);
   if(Number(disk.bavail)*Number(disk.bsize)<1073741824)throw Error("disk_space_low");
   await save("building",job);
   const releases=join(home,"releases"),stage=join(releases,job.targetSha);
   await mkdir(releases,{recursive:true,mode:0o700});
   await mkdir(stage,{mode:0o700});
   await run("/usr/bin/git",["init","-q"],stage);
   await run("/usr/bin/git",["remote","add","origin","https://github.com/"+repo+".git"],stage);
   await run("/usr/bin/git",["fetch","--depth","1","--no-tags","origin",job.targetSha],stage);
   await run("/usr/bin/git",["checkout","-q","--detach","FETCH_HEAD"],stage);
   const actualRevision=await new Promise((resolve,reject)=>{
    execFile("/usr/bin/git",["rev-parse","HEAD"],{cwd:stage,env,maxBuffer:8192,timeout:10000},(e,out)=>
      e?reject(Error("revision_verification_failed")):resolve(out.trim()));
   });
   if(actualRevision!==job.targetSha)throw Error("download_revision_mismatch");
   await run("/usr/bin/npm",["install","--include=dev","--no-audit","--no-fund"],stage);
   await run("/usr/bin/npm",["run","check"],stage);
   await run("/usr/bin/npm",["run","build"],stage);
   await writeFile(join(stage,".csw-revision"),job.targetSha+"\n",{mode:0o600});
   await rm(join(stage,".git"),{recursive:true,force:true});
   await save("backing_up",job);
   const db=new URL(settings.DATABASE_URL||"");
   if(!["postgresql:","postgres:"].includes(db.protocol))throw Error("database_configuration_missing");
   const password=decodeURIComponent(db.password);db.password="";
   const backups=join(home,"backups");
   await mkdir(backups,{recursive:true,mode:0o700});
   backup="db-"+job.id+".dump";
   await writeFile(join(home,"maintenance.flag"),"updating\n",{flag:"wx",mode:0o600});
   await new Promise(resolve=>setTimeout(resolve,1500));
   await run("/usr/bin/pg_dump",["--format=custom","--no-owner",
    "--no-privileges","--file="+join(backups,backup),"--dbname="+db.toString()],
    home,{PGPASSWORD:password});
   const backupFile=await lstat(join(backups,backup));
   if(!backupFile.isFile()||backupFile.size===0)throw Error("database_backup_failed");
   backupExists=true;
   await save("migrating",job);
   migrated=true;
   await run("/usr/bin/npm",["run","db:migrate"],stage,{DATABASE_URL:settings.DATABASE_URL});
   const pointer=join(home,"current");
   oldPointer=await lstat(pointer).then(async x=>{
    if(!x.isSymbolicLink())throw Error("unsafe_installed_release");
    return (await import("node:fs/promises")).readlink(pointer);
   }).catch(e=>{if(e.code==="ENOENT")return null;throw e;});
   const temp=join(home,"current-next");
   await rm(temp,{force:true});
   await symlink(stage,temp);
   await rename(temp,pointer);
   switched=true;
   const previousSha=status?.installedSha||
    "untracked";
   await save("restart_required",job,null,{
    previousRelease:oldPointer,previousSha,installedSha:previousSha,backupFile:backup
   });
   await writeFile(join(home,"restart.flag"),"new-release\n",{mode:0o600});
  }catch(e){
   let restored=true;
   if(migrated&&backupExists){
    try{
     await restorePrevious({previousRelease:oldPointer,backupFile:backup});
    }catch{restored=false;}
   }else if(switched){
    try{
     if(oldPointer){
      const temp=join(home,"current-next");
      await rm(temp,{force:true});await symlink(oldPointer,temp);
      await rename(temp,join(home,"current"));
     }else await rm(join(home,"current"),{force:true});
    }catch{restored=false;}
   }
   await save(restored?"failed":"needs_inspection",job,
    restored?(e instanceof Error?e.message:"update_failed"):"rollback_requires_inspection");
   if(restored)await rm(join(home,"maintenance.flag"),{force:true});
  }finally{
   await rm(requestFile,{force:true});
  }
 }
}
