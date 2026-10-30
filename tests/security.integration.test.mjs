import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import pg from "pg";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
const db=new pg.Pool({connectionString:process.env.DATABASE_URL});
const suffix=randomUUID().slice(0,8);
async function call(path,method="GET",data,session="",origin){
 const response=await fetch("http://127.0.0.1:8787/api"+path,{method,
 headers:{...(session?{cookie:session}:{}),...(data?{"content-type":"application/json"}:{}),...(origin?{origin}:{})},
 ...(data?{body:JSON.stringify(data)}:{})});
 const body=await response.json().catch(()=>({}));
 return {status:response.status,body,cookie:(response.headers.get("set-cookie")||"").split(";")[0]};
}
test("admin bootstrap and creator isolation",async()=>{
 const setup=await call("/setup/initialize","POST",{displayName:"Owner",email:"owner-"+suffix+"@example.test",password:"AdminPasswordLong!23",setupToken:process.env.CSW_SETUP_TOKEN});
 assert.equal(setup.status,200,JSON.stringify(setup.body));
 assert.equal((await call("/setup/initialize","POST",{displayName:"Owner2",email:"second@example.test",password:"AdminPasswordLong!23",setupToken:process.env.CSW_SETUP_TOKEN})).status,409);
 const register=name=>call("/auth/register","POST",{displayName:name,email:name+"-"+suffix+"@example.test",password:"CreatorPasswordLong!23",role:"creator",creatorType:"musician"});
 const a=await register("AlphaCreator"),b=await register("BetaCreator");
 assert.equal(a.status,200,JSON.stringify(a.body));assert.equal(b.status,200,JSON.stringify(b.body));
 await db.query("INSERT INTO subscriptions(id,user_id,plan_id,status) VALUES($1,$2,$3,'active'),($4,$5,$3,'active')",[randomUUID(),a.body.user.id,"00000000-0000-4000-8000-000000000101",randomUUID(),b.body.user.id]);
 const title=await call("/media","POST",{kind:"track",title:"Private track",priceCents:500},a.cookie);
 assert.equal(title.status,201,JSON.stringify(title.body));
 const owner=await call("/media/mine","GET",undefined,a.cookie),stranger=await call("/media/mine","GET",undefined,b.cookie);
 assert.ok(owner.body.items.some(x=>x.id===title.body.id));
 assert.ok(!stranger.body.items.some(x=>x.id===title.body.id));
 assert.equal((await call("/media/"+title.body.id,"PATCH",{title:"Stolen"},b.cookie)).status,404);
 assert.equal((await call("/media/"+title.body.id+"/stream","GET",undefined,b.cookie)).status,404);
 assert.equal((await call("/cart","POST",{mediaId:title.body.id},b.cookie)).status,400);
 assert.equal((await call("/admin/plans","GET",undefined,b.cookie)).status,403);

 // Native updater is admin-only, cannot be triggered by a creator or anonymous user,
 // and requires a browser Origin even for a logged-in admin.
 assert.equal((await call("/admin/updates/apply","POST",{targetSha:"a".repeat(40),password:"anything",confirmed:true})).status,401);
 assert.equal((await call("/admin/updates/apply","POST",{targetSha:"a".repeat(40),password:"anything",confirmed:true},b.cookie,"http://localhost:5173")).status,403);
 assert.equal((await call("/admin/updates/apply","POST",{targetSha:"a".repeat(40),password:"AdminPasswordLong!23",confirmed:true},setup.cookie)).status,403);

 const plans=await call("/plans"),p=plans.body.items.find(x=>x.name==="Pro Creator");
 assert.ok(p);
 assert.equal((await call("/admin/plans/"+p.id,"PATCH",{amountCents:3500},b.cookie)).status,403);
 const updated=await call("/admin/plans/"+p.id,"PATCH",{amountCents:3500,uploadLimit:150},setup.cookie);
 assert.equal(updated.status,200,JSON.stringify(updated.body));assert.equal(updated.body.item.amount_cents,3500);
 assert.equal((await call("/auth/logout","POST",{},b.cookie,"https://evil.example")).status,403);
 assert.equal((await call("/stripe/webhook","POST",{id:"unsigned"})).status,400);
 const ad=await call("/ads","POST",{title:"Test audio ad",format:"audio",budgetCents:1500},a.cookie);
 assert.equal(ad.status,201,JSON.stringify(ad.body));
 assert.equal((await call("/ads/"+ad.body.id,"PATCH",{title:"Changed"},b.cookie)).status,404);

 // Audio/video content is stored once in an owner-scoped library, never in public web roots.
 const sendAsset=async (cookie,name,bytes,mime="application/octet-stream")=>{
  const form=new FormData();
  form.set("file",new Blob([bytes],{type:mime}),name);
  const response=await fetch("http://127.0.0.1:8787/api/library/upload",{method:"POST",headers:{cookie},body:form});
  return {status:response.status,body:await response.json().catch(()=>({}))};
 };
 const source=Buffer.from("<?php echo json_encode(['password'=>'secret']); ?>");
 for(const name of ["attack.php","config.json","readme.txt","fake.mp3","fake.mp4","image.png"]){
  const result=await sendAsset(a.cookie,name,source,"application/octet-stream");
  assert.equal(result.status,415,JSON.stringify({name,result}));
 }
 const temp=mkdtempSync(join(tmpdir(),"soundwerks-ci-"));
 try{
  const mp3=join(temp,"valid.mp3"),mp4=join(temp,"valid.mp4");
  execFileSync("ffmpeg",["-hide_banner","-loglevel","error","-f","lavfi","-i","sine=frequency=440:duration=0.4","-codec:a","libmp3lame","-qscale:a","4","-y",mp3]);
  execFileSync("ffmpeg",["-hide_banner","-loglevel","error","-f","lavfi","-i","color=c=blue:s=160x90:r=15:d=0.4","-codec:v","mpeg4","-y",mp4]);
  assert.equal((await sendAsset(a.cookie,"audio.php",readFileSync(mp3),"audio/mpeg")).status,415,"A valid MP3 disguised as PHP must be rejected");
  const audio=await sendAsset(a.cookie,"valid.mp3",readFileSync(mp3),"audio/mpeg");
  assert.equal(audio.status,201,JSON.stringify(audio.body));
  const video=await sendAsset(b.cookie,"movie.mp4",readFileSync(mp4),"video/mp4");
  assert.equal(video.status,201,JSON.stringify(video.body));
  const audioId=audio.body.item.id,videoId=video.body.item.id;
  const myLibrary=await call("/library","GET",undefined,a.cookie);
  assert.equal(myLibrary.status,200);
  assert.ok(myLibrary.body.items.some(x=>x.id===audioId));
  assert.ok(!myLibrary.body.items.some(x=>x.id===videoId));
  assert.ok(myLibrary.body.items.every(x=>!x.storage_path),"Never reveal absolute VPS file paths");
  assert.equal((await call("/library/"+videoId,"GET",undefined,a.cookie)).status,404);
  assert.equal((await call("/library/"+videoId+"/download","GET",undefined,a.cookie)).status,404);
  assert.equal((await call("/library/"+videoId+"/stream","GET",undefined,a.cookie)).status,404);
  assert.equal((await call("/library/"+videoId,"DELETE",undefined,a.cookie)).status,404);
  assert.equal((await call("/admin/library","GET",undefined,b.cookie)).status,403);
  const adminView=await call("/admin/library","GET",undefined,setup.cookie);
  assert.equal(adminView.status,200);
  assert.ok(adminView.body.items.some(x=>x.id===audioId&&x.owner_id===a.body.user.id));
  assert.ok(adminView.body.items.some(x=>x.id===videoId&&x.owner_id===b.body.user.id));
  assert.ok(adminView.body.items.some(x=>x.id===audioId&&x.uploader_email));
  assert.ok(adminView.body.items.every(x=>!x.storage_path));
  assert.equal((await call("/media/"+title.body.id+"/asset","PUT",{assetId:videoId},a.cookie)).status,404);
  assert.equal((await call("/media/"+title.body.id+"/asset","PUT",{assetId:audioId},b.cookie)).status,404);
  assert.equal((await call("/media/"+title.body.id+"/asset","PUT",{assetId:audioId},a.cookie)).status,200);
  assert.equal((await call("/library/"+audioId,"DELETE",undefined,a.cookie)).status,409,"Linked assets must not be deleted");
  assert.equal((await call("/media/"+title.body.id+"/stream","GET",undefined,b.cookie)).status,404,"Draft remains private");
  const range=await fetch("http://127.0.0.1:8787/api/media/"+title.body.id+"/stream",{headers:{cookie:a.cookie,range:"bytes=0-31"}});
  assert.equal(range.status,206);
  assert.equal(range.headers.get("content-type"),"audio/mpeg");
  assert.equal((await range.arrayBuffer()).byteLength,32);
  assert.equal((await call("/library/"+videoId,"GET",undefined,setup.cookie)).status,200,"Administrator can inspect all");
  assert.equal((await call("/library/"+videoId,"DELETE",undefined,b.cookie)).status,200,"Unattached owner asset can be removed");

 // Artwork must be real raster imagery, converted to canonical WebP.
 const sendImage=async(cookie,name,bytes,route="/library/image")=>{
  const form=new FormData();
  form.append("file",new Blob([bytes],{type:"application/octet-stream"}),name);
  const response=await fetch("http://127.0.0.1:8787/api"+route,{method:"POST",headers:{cookie},body:form});
  return {status:response.status,body:await response.json().catch(()=>({}))};
 };
 const check=await call("/setup/prerequisites");
 assert.equal(check.status,200);
 assert.equal(check.body.ffmpeg.ready,true);
 assert.equal(check.body.ffprobe.ready,true);
 const sample=Buffer.from("<?php echo 'x'; ?>");
 for(const name of ["upload.php","data.json","note.txt","vector.svg","cover.png","photo.jpg","poster.webp"]){
  const result=await sendImage(a.cookie,name,sample);
  assert.equal(result.status,415,JSON.stringify({name,result}));
 }
 const coverPath=join(temp,"cover.png");
 execFileSync("ffmpeg",["-hide_banner","-loglevel","error","-f","lavfi","-i","color=c=blue:s=160x160:r=1:d=1","-frames:v","1","-y",coverPath]);
 const png=readFileSync(coverPath);
 assert.equal((await sendImage(a.cookie,"cover.php",png)).status,415,"Real PNG renamed to PHP must fail");
 const artwork=await sendImage(a.cookie,"ArtWork.PNG",png);
 assert.equal(artwork.status,201,JSON.stringify(artwork.body));
 assert.equal(artwork.body.item.media_type,"image");
 assert.equal(artwork.body.item.mime_type,"image/webp");
 const artworkId=artwork.body.item.id;
 assert.equal((await call("/library/"+artworkId,"GET",undefined,b.cookie)).status,404);
 assert.equal((await call("/media/"+title.body.id+"/cover","PUT",{assetId:artworkId},b.cookie)).status,404);
 const ownAlbum=await call("/media","POST",{kind:"album",title:"First Album"},a.cookie);
 assert.equal(ownAlbum.status,201,JSON.stringify(ownAlbum.body));
 assert.equal((await call("/media/"+ownAlbum.body.id+"/cover","PUT",{assetId:artworkId},a.cookie)).status,200);
 assert.equal((await call("/library/"+artworkId,"DELETE",undefined,a.cookie)).status,409,"Artwork attached to an album is protected");
 assert.equal((await call("/media/"+ownAlbum.body.id+"/cover")).status,404,"Draft image cannot be read anonymously");
 assert.equal((await call("/media/"+ownAlbum.body.id,"PATCH",{visibility:"published"},a.cookie)).status,200);
 const publicCover=await fetch("http://127.0.0.1:8787/api/media/"+ownAlbum.body.id+"/cover");
 assert.equal(publicCover.status,200);
 assert.match(publicCover.headers.get("content-type")||"",/image\/webp/);
 const buffer=Buffer.from(await publicCover.arrayBuffer());
 assert.equal(buffer.toString("ascii",0,4),"RIFF");
 assert.equal(buffer.toString("ascii",8,12),"WEBP");
 const catalog=await call("/media");
 assert.ok(catalog.body.items.find(x=>x.id===ownAlbum.body.id)?.cover_asset_id===artworkId);
 const fan=await call("/auth/register","POST",{displayName:"Regular Fan",email:"fan-"+suffix+"@example.test",password:"FanPasswordLong!23",role:"fan"});
 assert.equal(fan.status,200);
 assert.equal((await sendImage(fan.cookie,"fan.png",png)).status,403,"Fans do not access the creator library");
 const avatar=await sendImage(fan.cookie,"my-photo.png",png,"/profile/avatar/upload");
 assert.equal(avatar.status,201,JSON.stringify(avatar.body));
 assert.equal((await call("/library/"+avatar.body.item.id,"GET",undefined,a.cookie)).status,404);
 assert.equal((await call("/profile/avatar","PUT",{assetId:artworkId},fan.cookie)).status,404,"Fans cannot claim other creators' covers");
 const self=await call("/me","GET",undefined,fan.cookie);
 assert.equal(self.body.user.avatar_asset_id,avatar.body.item.id);
 const visibleAvatar=await fetch("http://127.0.0.1:8787/api/profiles/"+fan.body.user.id+"/avatar");
 assert.equal(visibleAvatar.status,200);
 assert.match(visibleAvatar.headers.get("content-type")||"",/image\/webp/);
 assert.equal((await call("/library/"+avatar.body.item.id,"DELETE",undefined,setup.cookie)).status,409,"Attached avatar is not deletable");

 }finally{rmSync(temp,{recursive:true,force:true});}
 assert.equal((await call("/auth/logout","POST",{},a.cookie)).status,200);
 assert.equal((await call("/media/mine","GET",undefined,a.cookie)).status,401);

 await db.end();
});
