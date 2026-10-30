import pg from "pg";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFile, open, rename, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { configured, switchDatabase } from "./db.js";
import { runMigrations } from "./migrations.js";

const configPath=resolve(process.env.CSW_CONFIG_PATH || fileURLToPath(new URL("../../../.env",import.meta.url)));
const dbInput=z.object({
 setupToken:z.string().min(24).max(256),
 host:z.string().min(1).max(253).regex(/^[a-zA-Z0-9.-]+$/),
 port:z.number().int().min(1).max(65535).default(5432),
 database:z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/),
 username:z.string().min(1).max(63).regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
 password:z.string().min(1).max(512),
 publicUrl:z.url().max(512)
}).strict();
const unauthorized=()=>Object.assign(new Error("Invalid installer token"),{statusCode:403});
function requireToken(input:string){
 const secret=process.env.CSW_SETUP_TOKEN;
 if(!secret||secret.length<24)throw Object.assign(new Error("Installer token not configured on server"),{statusCode:503});
 const a=createHash("sha256").update(input).digest(),b=createHash("sha256").update(secret).digest();
 if(!timingSafeEqual(a,b))throw unauthorized();
}
let installing=false;
export async function managedSetupRoutes(app:FastifyInstance){
 // Expose only non-secret diagnostics. No database secrets or filesystem paths.
 app.get("/api/setup/environment",async()=>{
  const nodeMajor=Number(process.versions.node.split(".")[0]);
  let writable=false;
  try{await stat(configPath);writable=true;}catch{}
  return {databaseConfigured:configured(),nodeReady:nodeMajor>=22,
   mode:process.env.CSW_INSTALL_MODE||"panel-or-vps",configPrepared:Boolean(process.env.CSW_SETUP_TOKEN),configPresent:writable};
 });
 app.post("/api/setup/database",{config:{rateLimit:{max:5,timeWindow:"1 minute"}}},async(req,reply)=>{
  const input=dbInput.parse(req.body);
  requireToken(input.setupToken);
  if(configured()||installing)return reply.code(409).send({error:"Database installer already completed or in progress"});
  installing=true;
  // Trust only the operator's setup token; do not accept remote browser execution
  // commands, file paths, shell fragments or arbitrary connection strings.
  const publicOrigin=new URL(input.publicUrl);
  if(publicOrigin.protocol!=="https:" && !(process.env.NODE_ENV==="test" && publicOrigin.hostname==="localhost"))
   return reply.code(400).send({error:"A valid HTTPS site URL is required"});
  if(publicOrigin.username||publicOrigin.password||publicOrigin.pathname!=="/"||publicOrigin.search||publicOrigin.hash)
   return reply.code(400).send({error:"Enter the site origin only (https://your-domain)"});
  const conn = new URL("postgresql://"+input.host+":"+input.port+"/"+input.database);
  conn.username=input.username;conn.password=input.password;
  const candidate=new pg.Pool({connectionString:conn.toString(),max:10,connectionTimeoutMillis:7000});
  let transferred=false;
  try{
   await candidate.query("SELECT 1");
   const existingUsers=await candidate.query("SELECT to_regclass('public.users') AS table_name");
   if(existingUsers.rows[0]?.table_name){
    const prior=await candidate.query("SELECT 1 FROM users LIMIT 1");
    if(prior.rowCount)return reply.code(409).send({error:"This database already has accounts"});
   }
   await runMigrations(candidate);
   const owner=await candidate.query("SELECT 1 FROM users LIMIT 1");
   if(owner.rowCount)return reply.code(409).send({error:"This database already has accounts"});
   // The generated .env must be writable by the application's OS user.
   // Atomically replace it without revealing the credentials to frontend APIs.
   const existing=await readFile(configPath,"utf8");
   if(/^\s*DATABASE_URL\s*=/m.test(existing))
    return reply.code(409).send({error:"Database configuration already exists in the server environment"});
   if(!existing.includes("CSW_SETUP_TOKEN="))
    return reply.code(503).send({error:"Run the panel preparation command first"});
   const additions="\nDATABASE_URL="+conn.toString()+"\nPUBLIC_APP_URL="+publicOrigin.origin+"\n";
   const tmp=configPath+".pending";
   const fh=await open(tmp,"wx",0o600);
   try{await fh.writeFile(existing.trimEnd()+"\n"+additions);}finally{await fh.close();}
   try{await rename(tmp,configPath);}catch(e){await rm(tmp,{force:true});throw e;}
   process.env.PUBLIC_APP_URL=publicOrigin.origin;
   await switchDatabase(conn.toString(),candidate);
   transferred=true;
   return {ok:true,next:"admin"};
  }catch(e){
   // Never expose libpq authentication error details; they may contain host or configuration info.
   req.log.error({error:e},"Database installer failed");
   if((e as {statusCode?:number}).statusCode)throw e;
   return reply.code(400).send({error:"Could not connect, initialize schema or save configuration. Check database permissions and server configuration."});
  }finally{installing=false;if(!transferred)await candidate.end();}
 });
}
