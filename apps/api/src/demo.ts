import type {FastifyInstance} from "fastify";
import {requireRole} from "./auth.js";
import {query} from "./db.js";
import {execFile} from "node:child_process";
import {fileURLToPath} from "node:url";
import argon2 from "argon2";
import {z} from "zod";

const body=z.object({confirmed:z.literal(true),password:z.string().min(1).max(256)}).strict();
type DemoStatus={state:"idle"|"running"|"succeeded"|"failed";updatedAt:string|null;message:string};
let job:DemoStatus={state:"idle",updatedAt:null,message:"Optional original demonstration audio and video."};
const script=fileURLToPath(new URL("../../../scripts/seed-demo.mjs",import.meta.url));
export async function demoRoutes(app:FastifyInstance){
 app.get("/api/admin/demo",async req=>{
  await requireRole(req,["admin"]);
  const result=await query<{total:string}>(
   "SELECT COUNT(*)::text AS total FROM media WHERE id IN "+
   "('00000000-0000-4000-8000-00000000d100','00000000-0000-4000-8000-00000000d101',"+
   "'00000000-0000-4000-8000-00000000d102','00000000-0000-4000-8000-00000000d103',"+
   "'00000000-0000-4000-8000-00000000d104')");
  return {job,installedTitles:Number(result.rows[0]?.total??0)};
 });
 app.post("/api/admin/demo/seed",{config:{rateLimit:{max:3,timeWindow:"1 minute"}}},async(req,reply)=>{
  const u=await requireRole(req,["admin"]);
  const input=body.parse(req.body);
  const origin=req.headers.origin;
  if(!origin||!process.env.PUBLIC_APP_URL||
   origin!==new URL(process.env.PUBLIC_APP_URL).origin)
   return reply.code(403).send({error:"Origin confirmation required"});
  const account=await query<{password_hash:string}>("SELECT password_hash FROM users WHERE id=$1 AND role='admin'",[u.id]);
  if(!account.rowCount||!await argon2.verify(account.rows[0].password_hash,input.password))
   return reply.code(403).send({error:"Administrator password invalid"});
  if(job.state==="running")return reply.code(409).send({error:"Demo media installation is already running"});
  job={state:"running",updatedAt:new Date().toISOString(),message:"Generating original playable demo media…"};
  execFile(process.execPath,[script],{timeout:180000,maxBuffer:16384,env:process.env},
   (error,stdout)=>{
    job={state:error?"failed":"succeeded",updatedAt:new Date().toISOString(),
     message:error?"Demo generation did not complete. Check server media prerequisites and retry.":
      stdout.trim().slice(0,400)||"Sample media installed."};
   });
  return reply.code(202).send({accepted:true});
 });
}
