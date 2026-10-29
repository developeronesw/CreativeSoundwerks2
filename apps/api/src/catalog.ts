import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileTypeFromFile } from "file-type";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { query } from "./db.js";
import { actor, requireActor, requireRole } from "./auth.js";

const root=resolve(process.env.MEDIA_ROOT || "./storage/private");
const kinds=z.enum(["track","album","music_video","movie","short_film","tv_show","episode","trailer"]);
const data=z.object({
 kind:kinds,title:z.string().trim().min(2).max(180),
 description:z.string().max(5000).default(""),genre:z.string().max(90).default(""),
 priceCents:z.number().int().min(0).max(10000000).default(0),
 parentId:z.uuid().optional(),seasonNumber:z.number().int().min(1).optional(),episodeNumber:z.number().int().min(1).optional()
});
const mimeAllowed:Record<string,string>={"audio/mpeg":"mp3","audio/flac":"flac","audio/ogg":"ogg","audio/wav":"wav","video/mp4":"mp4","video/webm":"webm","video/quicktime":"mov"};
async function mediaPermission(req:FastifyRequest,id:string,download=false){
 const result=await query<any>("SELECT * FROM media WHERE id=$1",[id]); const item=result.rows[0];
 if(!item) throw Object.assign(new Error("Not found"),{statusCode:404});
 const user=await actor(req);
 if(user?.role==="admin" || user?.id===item.owner_id) return item;
 if(item.visibility!=="published")throw Object.assign(new Error("Not found"),{statusCode:404});
 if(item.price_cents>0){
  if(!user)throw Object.assign(new Error("Purchase required"),{statusCode:403});
  const purchased=await query("SELECT 1 FROM purchases WHERE user_id=$1 AND media_id=$2",[user.id,id]);
  if(!purchased.rowCount)throw Object.assign(new Error("Purchase required"),{statusCode:403});
 }
 // Free published media can be streamed/downloaded; paid content requires verified purchase.
 return item;
}
export async function catalogRoutes(app:FastifyInstance){
 app.get("/api/media",async req=>{
  const filters=z.object({kind:kinds.optional(),q:z.string().max(100).optional()}).parse(req.query);
  const r=await query<any>("SELECT m.id,m.kind,m.title,m.description,m.genre,m.price_cents,m.parent_id,m.season_number,m.episode_number,m.created_at,u.display_name AS creator FROM media m JOIN users u ON u.id=m.owner_id WHERE m.visibility='published' AND ($1::text IS NULL OR m.kind=$1) AND ($2::text IS NULL OR m.title ILIKE '%'||$2||'%') ORDER BY m.created_at DESC LIMIT 100",[filters.kind??null,filters.q??null]);
  return {items:r.rows};
 });
 app.get("/api/media/mine",async req=>{
  const u=await requireRole(req,["creator","admin"]);
  return {items:(await query<any>("SELECT id,kind,title,visibility,price_cents,storage_path IS NOT NULL AS uploaded,created_at FROM media WHERE owner_id=$1 ORDER BY created_at DESC",[u.id])).rows};
 });
 app.post("/api/media",async(req,reply)=>{
  const u=await requireRole(req,["creator","admin"]);const v=data.parse(req.body);
  if(v.parentId){const p=await query("SELECT id FROM media WHERE id=$1 AND owner_id=$2",[v.parentId,u.id]);if(!p.rowCount)return reply.code(403).send({error:"Parent content must belong to you"});}
  if(u.role!=="admin"){
   const s=await query<any>("SELECT p.upload_limit FROM subscriptions s JOIN plans p ON p.id=s.plan_id WHERE s.user_id=$1 AND s.status IN ('active','trialing') AND p.audience='creator' ORDER BY p.upload_limit DESC LIMIT 1",[u.id]);
   const count=await query<{total:string}>("SELECT count(*)::text AS total FROM media WHERE owner_id=$1",[u.id]);
   const limit=Number(s.rows[0]?.upload_limit ?? 0);
   if(Number(count.rows[0].total)>=limit)return reply.code(402).send({error:"Active creator membership with remaining upload capacity required"});
  }
  const id=randomUUID();
  await query("INSERT INTO media(id,owner_id,kind,title,description,genre,price_cents,parent_id,season_number,episode_number) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",[id,u.id,v.kind,v.title,v.description,v.genre,v.priceCents,v.parentId??null,v.seasonNumber??null,v.episodeNumber??null]);
  return reply.code(201).send({id});
 });
 app.patch("/api/media/:id",async(req,reply)=>{
  const u=await requireRole(req,["creator","admin"]);
  const id=z.uuid().parse((req.params as any).id);
  const v=z.object({title:z.string().min(2).max(180).optional(),description:z.string().max(5000).optional(),visibility:z.enum(["draft","published","unlisted"]).optional(),priceCents:z.number().int().min(0).optional()}).strict().parse(req.body);
  if(v.visibility==="published"){
   const existing=await query<any>("SELECT storage_path,kind FROM media WHERE id=$1 AND owner_id=$2",[id,u.id]);
   if(!existing.rows[0])return reply.code(404).send({error:"Not found"});
   if(!existing.rows[0].storage_path && !["album","tv_show"].includes(existing.rows[0].kind))return reply.code(400).send({error:"Upload a media file before publishing"});
  }
  const result=await query("UPDATE media SET title=coalesce($3,title),description=coalesce($4,description),visibility=coalesce($5,visibility),price_cents=coalesce($6,price_cents) WHERE id=$1 AND owner_id=$2 RETURNING id",[id,u.id,v.title??null,v.description??null,v.visibility??null,v.priceCents??null]);
  if(!result.rowCount)return reply.code(404).send({error:"Not found"});
  return {ok:true};
 });
 app.post("/api/media/:id/upload",async(req,reply)=>{
  const u=await requireRole(req,["creator","admin"]);const id=z.uuid().parse((req.params as any).id);
  const existing=await query<any>("SELECT id,storage_path FROM media WHERE id=$1 AND owner_id=$2 AND visibility='draft'",[id,u.id]);
  if(!existing.rowCount)return reply.code(404).send({error:"Draft media not found"});
  if(existing.rows[0].storage_path)return reply.code(409).send({error:"Media file already uploaded"});
  const file=await req.file({limits:{fileSize:1024*1024*1024,files:1}});
  if(!file)return reply.code(400).send({error:"File required"});
  await mkdir(root,{recursive:true,mode:0o700});
  const temp=join(root,"tmp-"+randomUUID());let finalPath="";
  try {
   await pipeline(file.file,createWriteStream(temp,{flags:"wx",mode:0o600}));
   if(file.file.truncated) return reply.code(413).send({error:"Upload too large"});
   const detected=await fileTypeFromFile(temp);
   const ext=detected?.mime ? mimeAllowed[detected.mime] : undefined;
   if(!ext)return reply.code(415).send({error:"Unsupported file type"});
   const s=await stat(temp);
   finalPath=join(root,id+"-"+randomUUID()+"."+ext);
   await rename(temp,finalPath);
   const updated=await query("UPDATE media SET storage_path=$3,mime_type=$4,size_bytes=$5 WHERE id=$1 AND owner_id=$2 AND storage_path IS NULL RETURNING id",[id,u.id,finalPath,detected!.mime,s.size]);
   if(!updated.rowCount){await rm(finalPath,{force:true});return reply.code(409).send({error:"Concurrent upload conflict"});}
   return {ok:true,size:s.size,mime:detected!.mime};
  }finally{await rm(temp,{force:true}).catch(()=>{});}
 });
 async function sendMedia(req:FastifyRequest,reply:FastifyReply,download:boolean){
  const id=z.uuid().parse((req.params as any).id);const m=await mediaPermission(req,id,download);
  if(!m.storage_path)return reply.code(404).send({error:"Media file not available"});
  const filename=resolve(m.storage_path);
  if(!filename.startsWith(root + "/"))return reply.code(500).send({error:"Invalid storage location"});
  let fileStat;try{fileStat=await stat(filename);}catch{return reply.code(404).send({error:"File missing"});}
  const total=fileStat.size; const range=req.headers.range;
  reply.header("Accept-Ranges","bytes").header("Cache-Control","private, no-store").header("X-Content-Type-Options","nosniff").type(m.mime_type||"application/octet-stream");
  if(download)reply.header("Content-Disposition","attachment; filename=\"download."+((m.mime_type||"").split("/")[1]||"bin").replace(/[^a-z0-9]/gi,"")+"\"");
  if(range){
   const match=/^bytes=(\d+)-(\d*)$/.exec(range);
   if(!match)return reply.code(416).header("Content-Range","bytes */"+total).send();
   const start=Number(match[1]);const end=match[2]?Math.min(Number(match[2]),total-1):total-1;
   if(start>=total||start>end)return reply.code(416).header("Content-Range","bytes */"+total).send();
   reply.code(206).header("Content-Range","bytes "+start+"-"+end+"/"+total).header("Content-Length",end-start+1);
   return reply.send(createReadStream(filename,{start,end}));
  }
  return reply.header("Content-Length",total).send(createReadStream(filename));
 }
 app.get("/api/media/:id/stream",async(req,reply)=>sendMedia(req,reply,false));
 app.get("/api/media/:id/download",async(req,reply)=>sendMedia(req,reply,true));
 app.put("/api/progress/:id",async req=>{
  const u=await requireActor(req);const id=z.uuid().parse((req.params as any).id);
  const {positionSeconds}=z.object({positionSeconds:z.number().int().min(0)}).parse(req.body);
  await mediaPermission(req,id);
  await query("INSERT INTO playback_progress(user_id,media_id,position_seconds) VALUES($1,$2,$3) ON CONFLICT(user_id,media_id) DO UPDATE SET position_seconds=excluded.position_seconds,updated_at=now()",[u.id,id,positionSeconds]);
  return {ok:true};
 });
 app.get("/api/progress",async req=>{
  const u=await requireActor(req);
  return {items:(await query("SELECT media_id,position_seconds FROM playback_progress WHERE user_id=$1",[u.id])).rows};
 });
}
