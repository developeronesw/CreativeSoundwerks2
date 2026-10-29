import "dotenv/config";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import rawBody from "@fastify/raw-body";
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
 if(status && status<500)return reply.code(status).send({error:e.message});
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
const port=Number(process.env.PORT||8787);
const host=process.env.HOST||"127.0.0.1";
await app.listen({host,port});
