import { randomBytes, createHash, randomUUID } from "node:crypto";
import argon2 from "argon2";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { pool, query } from "./db.js";

export type Actor = { id: string; email: string; display_name: string; role: "admin"|"creator"|"fan"; creator_type: string|null };
const SESSION_AGE = 60 * 60 * 24 * 14;
const secure = process.env.COOKIE_SECURE === "true" || process.env.NODE_ENV === "production";
export const credentials = z.object({ email: z.email().max(254), password: z.string().min(12).max(256) });
export const signup = credentials.extend({
  displayName: z.string().trim().min(2).max(90),
  role: z.enum(["creator","fan"]),
  creatorType: z.enum(["musician","director","content_owner"]).optional()
}).refine(x => x.role !== "creator" || !!x.creatorType, { message: "Creator type required" });
export async function actor(req: FastifyRequest): Promise<Actor|null> {
 const token = req.cookies?.csw_session;
 if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
 const hash = createHash("sha256").update(token).digest("hex");
 const r = await query<Actor>("SELECT u.id,u.email,u.display_name,u.role,u.creator_type FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()",[hash]);
 return r.rows[0] || null;
}
export async function requireActor(req: FastifyRequest): Promise<Actor> {
 const user = await actor(req);
 if (!user) throw Object.assign(new Error("Authentication required"),{statusCode:401});
 return user;
}
export async function requireRole(req: FastifyRequest, roles: Actor["role"][]) {
 const user = await requireActor(req);
 if (!roles.includes(user.role)) throw Object.assign(new Error("Insufficient permissions"),{statusCode:403});
 return user;
}
async function startSession(reply: FastifyReply, userId: string) {
 const token = randomBytes(32).toString("hex");
 await query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '14 days')",
 [createHash("sha256").update(token).digest("hex"),userId]);
 reply.setCookie("csw_session",token,{httpOnly:true,secure,sameSite:"lax",path:"/",maxAge:SESSION_AGE});
}
export async function authRoutes(app: FastifyInstance) {
 app.get("/api/setup/status",async()=>({required:(await query("SELECT id FROM users LIMIT 1")).rowCount===0}));
 app.post("/api/setup/initialize",{config:{rateLimit:{max:5,timeWindow:"1 minute"}}},async(req,reply)=>{
  const input = credentials.extend({displayName:z.string().min(2).max(90),setupToken:z.string().min(24)}).parse(req.body);
  if (!process.env.CSW_SETUP_TOKEN || process.env.CSW_SETUP_TOKEN.length < 24 || input.setupToken !== process.env.CSW_SETUP_TOKEN) {
    return reply.code(403).send({error:"Invalid setup token"});
  }
  const client=await pool.connect();
  try {
   await client.query("BEGIN");
   await client.query("SELECT pg_advisory_xact_lock(26710934)");
   if ((await client.query("SELECT id FROM users LIMIT 1")).rowCount) {await client.query("ROLLBACK");return reply.code(409).send({error:"Platform already initialized"});}
   const id=randomUUID();
   await client.query("INSERT INTO users(id,email,password_hash,display_name,role) VALUES($1,$2,$3,$4,'admin')",
    [id,input.email.toLowerCase(),await argon2.hash(input.password,{type:argon2.argon2id}),input.displayName]);
   await client.query("COMMIT");
   await startSession(reply,id);
   return {user:{id,email:input.email.toLowerCase(),display_name:input.displayName,role:"admin"}};
  } catch(e){await client.query("ROLLBACK");throw e;} finally{client.release();}
 });
 app.post("/api/auth/register",{config:{rateLimit:{max:8,timeWindow:"1 minute"}}},async(req,reply)=>{
  const input=signup.parse(req.body);
  const initialized=await query("SELECT 1 FROM users WHERE role='admin' LIMIT 1");
  if(!initialized.rowCount)return reply.code(503).send({error:"Administrator setup must be completed first"});
  const id=randomUUID();
  try {
   await query("INSERT INTO users(id,email,password_hash,display_name,role,creator_type) VALUES($1,$2,$3,$4,$5,$6)",
   [id,input.email.toLowerCase(),await argon2.hash(input.password,{type:argon2.argon2id}),input.displayName,input.role,input.creatorType??null]);
  } catch(e:any) {if(e?.code==="23505")return reply.code(409).send({error:"Email already registered"});throw e;}
  await startSession(reply,id);
  return {user:{id,email:input.email.toLowerCase(),display_name:input.displayName,role:input.role}};
 });
 app.post("/api/auth/login",{config:{rateLimit:{max:8,timeWindow:"1 minute"}}},async(req,reply)=>{
  const input=credentials.parse(req.body);
  const r=await query<any>("SELECT * FROM users WHERE email=$1",[input.email.toLowerCase()]);
  const u=r.rows[0];
  if(!u || !(await argon2.verify(u.password_hash,input.password)))return reply.code(401).send({error:"Invalid credentials"});
  await startSession(reply,u.id);
  return {user:{id:u.id,email:u.email,display_name:u.display_name,role:u.role,creator_type:u.creator_type}};
 });
 app.get("/api/me",async req=>({user:await actor(req)}));
 app.post("/api/auth/logout",async(req,reply)=>{
  const token=req.cookies?.csw_session;
  if(token) await query("DELETE FROM sessions WHERE token_hash=$1",[createHash("sha256").update(token).digest("hex")]);
  reply.clearCookie("csw_session",{path:"/"});
  return {ok:true};
 });
}
