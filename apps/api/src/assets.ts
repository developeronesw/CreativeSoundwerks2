import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat, lstat } from "node:fs/promises";
import { join, resolve, relative, isAbsolute, extname } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { fileTypeFromFile } from "file-type";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { Actor } from "./auth.js";
import { requireActor, requireRole } from "./auth.js";
import { query } from "./db.js";

const exec = promisify(execFile);
export const MEDIA_ROOT = resolve(process.env.MEDIA_ROOT || "./storage/private");
export const MAX_FILE_BYTES = 1024 * 1024 * 1024;
type Format = {kind:"audio"|"video";mimes:string[];servedMime:string};
const formats: Record<string,Format> = {
 ".mp3":{kind:"audio",mimes:["audio/mpeg"],servedMime:"audio/mpeg"},
 ".flac":{kind:"audio",mimes:["audio/flac"],servedMime:"audio/flac"},
 ".wav":{kind:"audio",mimes:["audio/wav","audio/x-wav","audio/vnd.wave"],servedMime:"audio/wav"},
 ".ogg":{kind:"audio",mimes:["audio/ogg"],servedMime:"audio/ogg"},
 ".m4a":{kind:"audio",mimes:["audio/mp4","audio/x-m4a","video/mp4"],servedMime:"audio/mp4"},
 ".mp4":{kind:"video",mimes:["video/mp4"],servedMime:"video/mp4"},
 ".mov":{kind:"video",mimes:["video/quicktime"],servedMime:"video/quicktime"},
 ".webm":{kind:"video",mimes:["video/webm"],servedMime:"video/webm"}
};
const reject = (message:string,statusCode=415) => Object.assign(new Error(message),{statusCode});
export function privatePath(file:string){
 const real=resolve(file),rel=relative(MEDIA_ROOT,real);
 if(!rel || rel.startsWith("..") || isAbsolute(rel))throw reject("Invalid media storage path",500);
 return real;
}
export function allowedExtension(name:string){
 const ext=extname(name).toLowerCase();
 return formats[ext] ? ext : null;
}
export type Asset={id:string;owner_id:string;original_name:string;media_type:"audio"|"video";mime_type:string;storage_path:string;size_bytes:number;created_at:string;extension:string};
export async function uploadAsset(req:FastifyRequest,owner:Actor,expectedKind?:"audio"|"video"){
 const multipart=await req.file({limits:{files:1,fileSize:MAX_FILE_BYTES}});
 if(!multipart)throw reject("Select an audio or video file",400);
 const original= multipart.filename.normalize("NFC").slice(0,255);
 const ext=allowedExtension(original);
 // All multipart streams are consumed or destroyed; unrecognized files never become assets.
 const id=randomUUID(),tmp=join(MEDIA_ROOT,"pending-"+randomUUID());
 const folder=join(MEDIA_ROOT,owner.id);
 let finalPath="";
 await mkdir(MEDIA_ROOT,{recursive:true,mode:0o700});
 try {
  await pipeline(multipart.file,createWriteStream(tmp,{flags:"wx",mode:0o600}));
  if(multipart.file.truncated)throw reject("File too large (1 GB maximum)",413);
  if(!ext)throw reject("Only MP3, FLAC, WAV, OGG, M4A, MP4, MOV and WEBM audio/video are permitted");
  const format=formats[ext];
  if(expectedKind && expectedKind!==format.kind)throw reject("The release requires a "+expectedKind+" file");
  const detected=await fileTypeFromFile(tmp);
  if(!detected || !format.mimes.includes(detected.mime))throw reject("File signature does not match an allowed audio/video format");
  // A magic header alone is not sufficient: verify the file has a real playable stream.
  let streams: Array<{codec_type:string}>;
  try{
   const result=await exec("ffprobe",["-v","error","-show_entries","stream=codec_type","-of","json",tmp],{timeout:20000,maxBuffer:1024*1024});
   const probe=JSON.parse(result.stdout) as {streams?:Array<{codec_type:string}>};
   streams=probe.streams||[];
  }catch{throw reject("Invalid or unplayable audio/video file");}
  if(!streams.some(s=>s.codec_type===format.kind))throw reject("Media stream does not match the file type");
  const metadata=await stat(tmp);
  if(metadata.size<16 || metadata.size>MAX_FILE_BYTES)throw reject("Media file size is invalid");
  // A creator's uploaded assets count toward their configured plan limit.
  if(owner.role==="creator"){
   const plan=await query<{upload_limit:number}>("SELECT p.upload_limit FROM subscriptions s JOIN plans p ON p.id=s.plan_id WHERE s.user_id=$1 AND s.status IN ('active','trialing') AND p.audience='creator' ORDER BY p.upload_limit DESC LIMIT 1",[owner.id]);
   const count=await query<{total:string}>("SELECT count(*)::text AS total FROM media_assets WHERE owner_id=$1",[owner.id]);
   if(Number(count.rows[0].total)>=Number(plan.rows[0]?.upload_limit??0))throw reject("Creator membership media limit reached",402);
  }
  await mkdir(folder,{recursive:true,mode:0o700});
  finalPath=join(folder,id+ext);
  await rename(tmp,finalPath);
  try{
   const saved=await query<Asset>("INSERT INTO media_assets(id,owner_id,original_name,media_type,mime_type,extension,storage_path,size_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",[id,owner.id,original,format.kind,format.servedMime,ext.slice(1),finalPath,metadata.size]);
   return saved.rows[0];
  }catch(e){await rm(finalPath,{force:true});throw e;}
 }finally{await rm(tmp,{force:true}).catch(()=>{});}
}
export async function getOwnedAsset(id:string,actor:Actor):Promise<Asset>{
 const q=actor.role==="admin" ? "SELECT * FROM media_assets WHERE id=$1" : "SELECT * FROM media_assets WHERE id=$1 AND owner_id=$2";
 const r=await query<Asset>(q,actor.role==="admin"?[id]:[id,actor.id]);
 if(!r.rowCount)throw reject("Media asset not found",404);
 return r.rows[0];
}
async function deliver(req:FastifyRequest,reply:FastifyReply,asset:Asset,attachment:boolean){
 const file=privatePath(asset.storage_path);
 try{if((await lstat(file)).isSymbolicLink())throw reject("Invalid media file",404);}catch(e){if((e as any).statusCode)throw e;throw reject("Media file missing",404);}
 const s=await stat(file);
 reply.header("X-Content-Type-Options","nosniff").header("Cache-Control","private, no-store").header("Accept-Ranges","bytes").type(asset.mime_type);
 if(attachment){
  // A fixed, server-generated filename avoids reflected headers and path traversal.
  reply.header("Content-Disposition", 'attachment; filename="soundwerks-'+asset.id+'.'+asset.extension+'"');
 }
 const range=req.headers.range;
 if(range){
  const match=/^bytes=(\d+)-(\d*)$/.exec(range);
  if(!match)return reply.code(416).header("Content-Range","bytes */"+s.size).send();
  const start=Number(match[1]),end=match[2]?Number(match[2]):s.size-1;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=s.size||end>=s.size||end<start)
   return reply.code(416).header("Content-Range","bytes */"+s.size).send();
  return reply.code(206).header("Content-Range","bytes "+start+"-"+end+"/"+s.size).header("Content-Length",end-start+1).send(createReadStream(file,{start,end}));
 }
 return reply.header("Content-Length",s.size).send(createReadStream(file));
}
export {deliver as deliverAsset};
export async function assetRoutes(app:FastifyInstance){
 app.get("/api/library",async(req)=>{
  const u=await requireRole(req,["creator","admin"]);
  const r=await query("SELECT id,owner_id,original_name,media_type,mime_type,extension,size_bytes,created_at FROM media_assets WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 500",[u.id]);
  return {items:r.rows};
 });
 app.get("/api/admin/library",async(req)=>{
  await requireRole(req,["admin"]);
  const r=await query("SELECT a.id,a.owner_id,a.original_name,a.media_type,a.mime_type,a.extension,a.size_bytes,a.created_at,u.email AS uploader_email,u.display_name AS uploader_name FROM media_assets a JOIN users u ON u.id=a.owner_id ORDER BY a.created_at DESC LIMIT 1000");
  return {items:r.rows};
 });
 app.post("/api/library/upload",async(req,reply)=>{
  const u=await requireRole(req,["creator","admin"]);
  const asset=await uploadAsset(req,u);
  return reply.code(201).send({item:{id:asset.id,owner_id:asset.owner_id,original_name:asset.original_name,media_type:asset.media_type,mime_type:asset.mime_type,size_bytes:asset.size_bytes,created_at:asset.created_at,extension:asset.extension}});
 });
 app.get("/api/library/:id",async(req)=>{
  const u=await requireRole(req,["creator","admin"]);
  const id=z.uuid().parse((req.params as {id:string}).id);
  const asset=await getOwnedAsset(id,u);
  const {storage_path,...safe}=asset;
  return {item:safe};
 });
 app.get("/api/library/:id/stream",async(req,reply)=>{
  const u=await requireRole(req,["creator","admin"]);
  const id=z.uuid().parse((req.params as {id:string}).id);
  const asset=await getOwnedAsset(id,u);
  return deliver(req,reply,asset,false);
 });
 app.get("/api/library/:id/download",async(req,reply)=>{
  const u=await requireRole(req,["creator","admin"]);
  const id=z.uuid().parse((req.params as {id:string}).id);
  const asset=await getOwnedAsset(id,u);
  return deliver(req,reply,asset,true);
 });
 app.delete("/api/library/:id",async(req,reply)=>{
  const u=await requireRole(req,["creator","admin"]);
  const id=z.uuid().parse((req.params as {id:string}).id);
  const asset=await getOwnedAsset(id,u);
  const attached=await query("SELECT id FROM media WHERE asset_id=$1 LIMIT 1",[id]);
  if(attached.rowCount)return reply.code(409).send({error:"Asset is in use by a release; detach it before deleting"});
  await query("DELETE FROM media_assets WHERE id=$1 AND owner_id=$2",[id,asset.owner_id]);
  await rm(privatePath(asset.storage_path),{force:true});
  return {ok:true};
 });
}
