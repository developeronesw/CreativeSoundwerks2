import { randomUUID } from "node:crypto";
import { uploadAsset, getOwnedAsset, deliverAsset } from "./assets.js";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { query } from "./db.js";
import { actor, requireActor, requireRole } from "./auth.js";

const kinds=z.enum(["track","album","music_video","movie","short_film","tv_show","episode","trailer"]);
const data=z.object({
 kind:kinds,title:z.string().trim().min(2).max(180),
 description:z.string().max(5000).default(""),genre:z.string().max(90).default(""),
 priceCents:z.number().int().min(0).max(10000000).default(0),
 parentId:z.uuid().optional(),seasonNumber:z.number().int().min(1).optional(),episodeNumber:z.number().int().min(1).optional()
});
async function mediaPermission(req:FastifyRequest,id:string){
 const result=await query<any>("SELECT m.*,a.storage_path AS asset_path,a.mime_type AS asset_mime FROM media m LEFT JOIN media_assets a ON a.id=m.asset_id AND a.owner_id=m.owner_id WHERE m.id=$1",[id]);
 const item=result.rows[0];
 if(!item)throw Object.assign(new Error("Not found"),{statusCode:404});
 const user=await actor(req);
 if(user?.role==="admin" || user?.id===item.owner_id)return item;
 if(item.visibility!=="published")throw Object.assign(new Error("Not found"),{statusCode:404});
 if(item.price_cents>0){
  if(!user)throw Object.assign(new Error("Purchase required"),{statusCode:403});
  const p=await query("SELECT 1 FROM purchases WHERE user_id=$1 AND media_id=$2",[user.id,id]);
  if(!p.rowCount)throw Object.assign(new Error("Purchase required"),{statusCode:403});
 }
 return item;
}
export async function catalogRoutes(app:FastifyInstance){
 app.get("/api/media",async req=>{
  const filters=z.object({kind:kinds.optional(),q:z.string().max(100).optional()}).parse(req.query);
  const r=await query<any>("SELECT m.id,m.kind,m.title,m.description,m.genre,m.price_cents,m.parent_id,m.season_number,m.episode_number,m.cover_asset_id,m.created_at,u.display_name AS creator FROM media m JOIN users u ON u.id=m.owner_id WHERE m.visibility='published' AND ($1::text IS NULL OR m.kind=$1) AND ($2::text IS NULL OR m.title ILIKE '%'||$2||'%') ORDER BY m.created_at DESC LIMIT 100",[filters.kind??null,filters.q??null]);
  return {items:r.rows};
 });
 app.get("/api/media/mine",async req=>{
  const u=await requireRole(req,["creator","admin"]);
  return {items:(await query<any>("SELECT id,kind,title,visibility,price_cents,cover_asset_id,asset_id,asset_id IS NOT NULL AS uploaded,created_at FROM media WHERE owner_id=$1 ORDER BY created_at DESC",[u.id])).rows};
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
  const id=z.uuid().parse((req.params as {id:string}).id);
  const v=z.object({title:z.string().min(2).max(180).optional(),description:z.string().max(5000).optional(),visibility:z.enum(["draft","published","unlisted"]).optional(),priceCents:z.number().int().min(0).optional()}).strict().parse(req.body);
  if(v.visibility==="published"){
   const existing=await query<any>("SELECT asset_id,kind FROM media WHERE id=$1 AND owner_id=$2",[id,u.id]);
   if(!existing.rows[0])return reply.code(404).send({error:"Not found"});
   if(!existing.rows[0].asset_id && !["album","tv_show"].includes(existing.rows[0].kind))return reply.code(400).send({error:"Select an audio/video asset before publishing"});
  }
  const r=await query("UPDATE media SET title=coalesce($3,title),description=coalesce($4,description),visibility=coalesce($5,visibility),price_cents=coalesce($6,price_cents) WHERE id=$1 AND owner_id=$2 RETURNING id",[id,u.id,v.title??null,v.description??null,v.visibility??null,v.priceCents??null]);
  if(!r.rowCount)return reply.code(404).send({error:"Not found"});
  return {ok:true};
 });
 // Upload only once into the unified Media Library, then link the saved asset to the release.
 app.put("/api/media/:id/asset",async(req,reply)=>{
  const u=await requireRole(req,["creator","admin"]);
  const id=z.uuid().parse((req.params as {id:string}).id);
  const {assetId}=z.object({assetId:z.uuid()}).parse(req.body);
  const own=await query<any>("SELECT kind,visibility FROM media WHERE id=$1 AND owner_id=$2",[id,u.id]);
  if(!own.rows[0])return reply.code(404).send({error:"Release not found"});
  if(own.rows[0].visibility!=="draft")return reply.code(409).send({error:"Only drafts can change their media file"});
  if(["album","tv_show"].includes(own.rows[0].kind))return reply.code(400).send({error:"This is a collection, not a playable media file"});
  const expected=own.rows[0].kind==="track"?"audio":"video";
  const a=await query("SELECT id FROM media_assets WHERE id=$1 AND owner_id=$2 AND media_type=$3",[assetId,u.id,expected]);
  if(!a.rowCount)return reply.code(404).send({error:"You cannot attach this file or its format is incompatible"});
  await query("UPDATE media SET asset_id=$3 WHERE id=$1 AND owner_id=$2 AND visibility='draft'",[id,u.id,assetId]);
  return {ok:true,assetId};
 });
 // Backward-compatible release upload now uses the same centralized validation/storage system.
 app.post("/api/media/:id/upload",async(req,reply)=>{
  const u=await requireRole(req,["creator","admin"]);
  const id=z.uuid().parse((req.params as {id:string}).id);
  const draft=await query<any>("SELECT kind FROM media WHERE id=$1 AND owner_id=$2 AND visibility='draft' AND asset_id IS NULL",[id,u.id]);
  if(!draft.rows[0])return reply.code(404).send({error:"Unattached draft not found"});
  if(["album","tv_show"].includes(draft.rows[0].kind))return reply.code(400).send({error:"Upload individual songs or episodes instead"});
  const expected=draft.rows[0].kind==="track"?"audio":"video";
  const asset=await uploadAsset(req,u,expected);
  const changed=await query("UPDATE media SET asset_id=$3 WHERE id=$1 AND owner_id=$2 AND asset_id IS NULL AND visibility='draft' RETURNING id",[id,u.id,asset.id]);
  if(!changed.rowCount)return reply.code(409).send({error:"Release was changed; file is available in your Media Library"});
  return reply.code(201).send({ok:true,assetId:asset.id});
 });
 async function sendMedia(req:FastifyRequest,reply:any,download:boolean){
  const id=z.uuid().parse((req.params as {id:string}).id);
  const m=await mediaPermission(req,id);
  if(!m.asset_id) return reply.code(404).send({error:"No playable file attached"});
  const r=await query<any>("SELECT * FROM media_assets WHERE id=$1 AND owner_id=$2",[m.asset_id,m.owner_id]);
  if(!r.rowCount)return reply.code(404).send({error:"Media file missing"});
  return deliverAsset(req,reply,r.rows[0],download);
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
