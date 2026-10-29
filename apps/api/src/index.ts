import "./env.js";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import rawBody from "fastify-raw-body";
import { ZodError } from "zod";
import { query } from "./db.js";
import { authRoutes, requireRole } from "./auth.js";
import { billingRoutes } from "./billing.js";
import { catalogRoutes } from "./catalog.js";

const app=Fastify({logger:true,bodyLimit:1024*1024,trustProxy:false});
await app.register(cookie);
await app.register(rateLimit,{max:200,timeWindow:"1 minute"});
await app.register(multipart,{limits:{files:1,fileSize:1024*1024*1024}});
await app.register(rawBody,{field:"rawBody",global:false,encoding:false,runFirst:true});
app.addHook("onRequest",async(req,reply)=>{
 if(!["POST","PUT","PATCH","DELETE"].includes(req.method))return;
 const origin=req.headers.origin;
 const expected=process.env.PUBLIC_APP_URL;
 if(origin && expected && origin!==new URL(expected).origin)
  return reply.code(403).send({error:"Origin not allowed"});
});
app.setErrorHandler((e,req,reply)=>{
 if(e instanceof ZodError)return reply.code(400).send({error:"Invalid input",issues:e.issues.map(x=>({path:x.path.join("."),message:x.message}))});
 const status=(e as any).statusCode;
 if(status && status<500)return reply.code(status).send({error:e instanceof Error ? e.message : "Request rejected"});
 req.log.error(e);
 return reply.code(500).send({error:"Internal server error"});
});
app.get("/api/health",async()=>{await query("SELECT 1");return {ok:true,service:"creative-soundwerks-api"};});
await authRoutes(app);
await billingRoutes(app);
await catalogRoutes(app);
app.get("/api/admin/stats",async req=>{
 await requireRole(req,["admin"]);
 const r=await query<any>("SELECT (SELECT count(*) FROM users)::int AS users,(SELECT count(*) FROM media)::int AS media,(SELECT count(*) FROM orders WHERE status='paid')::int AS orders,(SELECT count(*) FROM subscriptions WHERE status='active')::int AS subscriptions");
 return r.rows[0];
});
app.get("/api/ads/mine",async req=>{
 const u=await requireRole(req,["creator","admin"]);
 return {items:(await query("SELECT id,title,format,status,budget_cents,starts_at,ends_at FROM ad_campaigns WHERE owner_id=$1 ORDER BY created_at DESC",[u.id])).rows};
});

app.post("/api/ads",async(req,reply)=>{
 const u=await requireRole(req,["creator","admin"]);
 const {randomUUID}=await import("node:crypto");
 const {z}=await import("zod");
 const v=z.object({title:z.string().trim().min(2).max(150),format:z.enum(["audio","video"]),budgetCents:z.number().int().min(0).max(100000000).default(0)}).parse(req.body);
 const id=randomUUID();
 await query("INSERT INTO ad_campaigns(id,owner_id,title,format,budget_cents) VALUES($1,$2,$3,$4,$5)",[id,u.id,v.title,v.format,v.budgetCents]);
 return reply.code(201).send({id,status:"draft"});
});
app.patch("/api/ads/:id",async(req,reply)=>{
 const u=await requireRole(req,["creator","admin"]);const {z}=await import("zod");
 const id=z.uuid().parse((req.params as any).id);
 const v=z.object({title:z.string().trim().min(2).max(150).optional(),budgetCents:z.number().int().min(0).optional()}).strict().parse(req.body);
 const r=await query("UPDATE ad_campaigns SET title=coalesce($3,title),budget_cents=coalesce($4,budget_cents) WHERE id=$1 AND owner_id=$2 RETURNING id",[id,u.id,v.title??null,v.budgetCents??null]);
 if(!r.rowCount)return reply.code(404).send({error:"Campaign not found"});
 return {ok:true};
});

const port=Number(process.env.PORT||8787);
const host=process.env.HOST||"127.0.0.1";
await app.listen({host,port});
