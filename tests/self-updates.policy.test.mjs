import test from "node:test";
import assert from "node:assert/strict";
import {officialRelease} from "../apps/api/src/self-updates.ts";

const SHA="a".repeat(40);
const success={id:12345,name:"Creative Soundwerks CI",head_sha:SHA,
 head_branch:"main",event:"push",status:"completed",conclusion:"success"};
const original=globalThis.fetch;
const github=(runs,revision=SHA)=>async(url)=>{
 const value=String(url);
 if(value.endsWith("/git/ref/heads/main"))
  return new Response(JSON.stringify({object:{sha:revision}}),{status:200});
 if(value.includes("/actions/runs?head_sha="))
  return new Response(JSON.stringify({workflow_runs:runs}),{status:200});
 return new Response("Not found",{status:404});
};
test("official main SHA with exactly one successful push CI is approved",async()=>{
 globalThis.fetch=github([success]);
 try{
  const r=await officialRelease();
  assert.equal(r.latestSha,SHA);assert.equal(r.approved,true);
  assert.equal(r.ciUrl,"https://github.com/developeronesw/CreativeSoundwerks2/actions/runs/12345");
 }finally{globalThis.fetch=original;}
});
test("failed, incomplete, ambiguous or mismatched CI cannot authorize updates",async()=>{
 for(const runs of [[],[{...success,conclusion:"failure"}],
  [{...success,status:"in_progress",conclusion:null}],
  [success,success],[{...success,head_sha:"b".repeat(40)}],
  [{...success,head_branch:"feature"}],[{...success,event:"pull_request"}]]){
  globalThis.fetch=github(runs);
  try{assert.equal((await officialRelease()).approved,false);}
  finally{globalThis.fetch=original;}
 }
});
test("invalid GitHub revision and unavailable API fail closed",async()=>{
 globalThis.fetch=github([],"not-a-commit");
 try{await assert.rejects(officialRelease(),{message:"invalid_remote_revision"});}
 finally{globalThis.fetch=original;}
 globalThis.fetch=async()=>new Response("rate limited",{status:403});
 try{await assert.rejects(officialRelease(),{message:"github_rate_limited"});}
 finally{globalThis.fetch=original;}
});
