import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm, rename, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileTypeFromFile } from "file-type";
import sharp from "sharp";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Actor } from "./auth.js";
import { actor, requireActor, requireRole } from "./auth.js";
import { MEDIA_ROOT, getOwnedAsset, deliverAsset, type Asset } from "./assets.js";
import { query } from "./db.js";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const accepted:Record<string,string> = {".jpg":"image/jpeg",".jpeg":"image/jpeg",".png":"image/png",".webp":"image/webp"};
const invalid=(msg:string,statusCode=415)=>Object.assign(new Error(msg),{statusCode});

export async function uploadImage(req:FastifyRequest,owner:Actor):Promise<Asset>{
 const file=await req.file({limits:{files:1,fileSize:MAX_IMAGE_BYTES}});
 if(!file)throw invalid("An artwork image is required",400);
 const name=basename(file.filename.replace(/\\/g,"/")).normalize("NFC").slice(0,255);
 const ext=extname(name).toLowerCase();
 const expectedMime=accepted[ext];
 const id=randomUUID(),tmp=join(MEDIA_ROOT,"pending-image-"+randomUUID());
 const folder=join(MEDIA_ROOT,owner.id),destination=join(folder,id+".webp");
 await mkdir(MEDIA_ROOT,{recursive:true,mode:0o700});
 try{
  await pipeline(file.file,createWriteStream(tmp,{flags:"wx",mode:0o600}));
  if(file.file.truncated)throw invalid("Images must be 10 MB or smaller",413);
  if(!expectedMime)throw invalid("Only JPG, JPEG, PNG and WebP images are accepted");
  const signature=await fileTypeFromFile(tmp);
  if(!signature || signature.mime!==expectedMime)throw invalid("File does not contain a valid permitted image");
  try{
   // Decode and re-encode to canonical WebP. This strips EXIF and prevents serving
   // source polyglot/script payloads and unbounded image dimensions.
   await mkdir(folder,{recursive:true,mode:0o700});
   await sharp(tmp,{failOn:"error",limitInputPixels:40_000_000})
    .rotate().resize({width:2400,height:2400,fit:"inside",withoutEnlargement:true})
    .webp({quality:85}).toFile(destination);
  }catch{
   throw invalid("Invalid, oversized or undecodable image");
  }
  const size=(await stat(destination)).size;
  if(size<20)throw invalid("Invalid image");
  try{
   const r=await query<Asset>("INSERT INTO media_assets(id,owner_id,original_name,media_type,mime_type,extension,storage_path,size_bytes) VALUES($1,$2,$3,'image','image/webp','webp',$4,$5) RETURNING *",[id,owner.id,name,destination,size]);
   return r.rows[0];
  }catch(e){await rm(destination,{force:true});throw e;}
 }catch(e){await rm(destination,{force:true}).catch(()=>{});throw e;}
 finally{await rm(tmp,{force:true}).catch(()=>{});}
}

function imageItem(a:Asset){
 return {id:a.id,owner_id:a.owner_id,original_name:a.original_name,media_type:a.media_type,mime_type:a.mime_type,extension:a.extension,size_bytes:a.size_bytes,created_at:a.created_at};
}
export async function imageRoutes(app:FastifyInstance){
 app.post("/api/library/image",async(req,reply)=>{
  const u=await requireRole(req,["creator","admin"]);
  return reply.code(201).send({item:imageItem(await uploadImage(req,u))});
 });
 app.post("/api/profile/avatar/upload",async(req,reply)=>{
  const u=await requireActor(req);
  const a=await uploadImage(req,u);
  await query("UPDATE users SET avatar_asset_id=$2 WHERE id=$1",[u.id,a.id]);
  return reply.code(201).send({item:imageItem(a)});
 });
 app.put("/api/profile/avatar",async req=>{
  const u=await requireActor(req);
  const {assetId}=z.object({assetId:z.uuid()}).parse(req.body);
  const a=await query("UPDATE users SET avatar_asset_id=$2 WHERE id=$1 AND EXISTS(SELECT 1 FROM media_assets WHERE id=$2 AND owner_id=$1 AND media_type='image') RETURNING id",[u.id,assetId]);
  if(!a.rowCount)throw invalid("Avatar must be an image you own",404);
  return {ok:true};
 });
 app.get("/api/profiles/:id/avatar",async(req,reply)=>{
  const userId=z.uuid().parse((req.params as {id:string}).id);
  const r=await query<Asset>("SELECT a.* FROM users u JOIN media_assets a ON a.id=u.avatar_asset_id AND a.owner_id=u.id AND a.media_type='image' WHERE u.id=$1",[userId]);
  if(!r.rowCount)return reply.code(404).send({error:"Avatar not found"});
  return deliverAsset(req,reply,r.rows[0],false);
 });
 app.put("/api/media/:id/cover",async(req,reply)=>{
  const u=await requireRole(req,["creator","admin"]);
  const id=z.uuid().parse((req.params as {id:string}).id);
  const {assetId}=z.object({assetId:z.uuid()}).parse(req.body);
  const r=await query("UPDATE media SET cover_asset_id=$3 WHERE id=$1 AND owner_id=$2 AND EXISTS(SELECT 1 FROM media_assets WHERE id=$3 AND owner_id=$2 AND media_type='image') RETURNING id",[id,u.id,assetId]);
  if(!r.rowCount)return reply.code(404).send({error:"Release or owned image not found"});
  return {ok:true};
 });
 app.get("/api/media/:id/cover",async(req,reply)=>{
  const id=z.uuid().parse((req.params as {id:string}).id);
  const u=await actor(req);
  const media=await query<Asset>("SELECT a.* FROM media m JOIN media_assets a ON a.id=m.cover_asset_id AND a.owner_id=m.owner_id AND a.media_type='image' WHERE m.id=$1 AND (m.visibility='published' OR m.owner_id=$2 OR $3::boolean)",[id,u?.id??null,u?.role==="admin"]);
  if(!media.rowCount)return reply.code(404).send({error:"Cover image not found"});
  return deliverAsset(req,reply,media.rows[0],false);
 });
}
