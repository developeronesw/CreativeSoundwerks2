#!/usr/bin/env node
// Explicit opt-in development fixture. Original procedural audio and video,
// synthesized on the target server; no copyrighted recordings are distributed.
import {config} from "dotenv";
import {randomUUID} from "node:crypto";
import {mkdir,stat,rm,readFile} from "node:fs/promises";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {execFile} from "node:child_process";
import pg from "pg";
import sharp from "sharp";
const root=fileURLToPath(new URL("../",import.meta.url));
const configPath=process.env.CSW_CONFIG_PATH||join(root,".env");
config({path:configPath});
const connectionString=process.env.DATABASE_URL;
if(!connectionString)throw Error("Configure DATABASE_URL and finish the administrator wizard before adding samples.");
const mediaRoot=resolve(process.env.MEDIA_ROOT||join(root,"storage/private"));
const fixed=(name)=>"00000000-0000-4000-8000-"+name;
const album=fixed("00000000d100");
const covers=[
 {id:fixed("00000000f100"),title:"Night Drive",sub:"Original synth test • DEMO",tone:"#c69c62",dark:"#171d32"},
 {id:fixed("00000000f200"),title:"Studio Motion",sub:"Original video test • DEMO",tone:"#92aaab",dark:"#172331"}
];
const items=[
 {id:fixed("00000000d101"),asset:fixed("00000000e101"),kind:"track",title:"Neon Avenue (Demo)",genre:"Synth Instrumental",cover:covers[0].id,parent:album,frequency:[174.61,220,261.63],ext:"mp3",type:"audio/mpeg"},
 {id:fixed("00000000d102"),asset:fixed("00000000e102"),kind:"track",title:"Golden Signal (Demo)",genre:"Ambient Instrumental",cover:covers[0].id,parent:album,frequency:[196,246.94,293.66],ext:"mp3",type:"audio/mpeg"},
 {id:fixed("00000000d103"),asset:fixed("00000000e103"),kind:"music_video",title:"Studio Motion (Demo Video)",genre:"Music Video",cover:covers[1].id,parent:null,frequency:329.63,ext:"mp4",type:"video/mp4"},
 {id:fixed("00000000d104"),asset:fixed("00000000e104"),kind:"short_film",title:"Color Drift (Demo Short)",genre:"Short Film",cover:covers[1].id,parent:null,frequency:261.63,ext:"mp4",type:"video/mp4"}
];
const exec=(binary,args,timeout=60000)=>new Promise((resolve,reject)=>{
 execFile(binary,args,{timeout,maxBuffer:8192},(error,stdout,stderr)=>
  error?reject(Error(binary+" failed during demo fixture generation")):resolve(stdout));
});
async function synthAudio(destination,notes){
 const args=["-hide_banner","-nostdin","-loglevel","error","-y"];
 for(const hz of notes)args.push("-f","lavfi","-i","sine=frequency="+hz+":sample_rate=44100:duration=14");
 args.push("-filter_complex",
  "[0:a]volume=0.30[a];[1:a]volume=0.22[b];[2:a]volume=0.14[c];"+
  "[a][b][c]amix=inputs=3:duration=shortest,"+
  "afade=t=in:st=0:d=0.7,afade=t=out:st=12:d=2[out]",
  "-map","[out]","-codec:a","libmp3lame","-qscale:a","5",destination);
 await exec("ffmpeg",args);
}
async function synthVideo(destination,hz,index){
 await exec("ffmpeg",[
  "-hide_banner","-nostdin","-loglevel","error","-y",
  "-f","lavfi","-i","testsrc2=size=640x360:rate=24:duration=10",
  "-f","lavfi","-i","sine=frequency="+hz+":sample_rate=44100:duration=10",
  "-vf","hue=h=t*"+(index===0?12:8)+":s=0.85",
  "-t","10","-c:v","libx264","-preset","ultrafast","-crf","29",
  "-pix_fmt","yuv420p","-c:a","aac","-b:a","96k",
  "-movflags","+faststart",destination
 ]);
}
async function validate(path,type){
 const text=await exec("ffprobe",["-v","error","-show_entries","stream=codec_type","-of","json",path]);
 const streams=JSON.parse(text).streams||[];
 if(!streams.some(s=>s.codec_type===type))throw Error("Generated demo did not contain a playable "+type+" stream");
}
function svgCover(data){
 const text=data.title.replace(/[&<>"]/g,"");
 const sub=data.sub.replace(/[&<>"]/g,"");
 return Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="650">'+
  '<defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="'+data.dark+'"/>'+
  '<stop offset="1" stop-color="'+data.tone+'"/></linearGradient></defs>'+
  '<rect width="900" height="650" fill="url(#g)"/>'+
  '<circle cx="680" cy="220" r="190" fill="#ffffff" opacity=".07"/>'+
  '<text x="62" y="84" font-size="24" fill="#fae6c1" font-family="sans-serif" letter-spacing="5">CREATIVE SOUNDWERKS</text>'+
  '<text x="62" y="410" font-size="68" font-weight="700" font-family="sans-serif" fill="#ffffff">'+text+'</text>'+
  '<text x="66" y="473" font-size="26" font-family="sans-serif" fill="#eee9df">'+sub+'</text>'+
  '<text x="66" y="572" font-size="20" font-family="sans-serif" fill="#ffffff">TEST CONTENT • NOT FOR COMMERCIAL RELEASE</text></svg>');
}
const client=new pg.Client({connectionString});
await client.connect();
let directory="";
let created=0,skipped=0;
try{
 const admin=await client.query("SELECT id FROM users WHERE role='admin' ORDER BY created_at ASC LIMIT 1");
 if(!admin.rows.length)throw Error("Complete the first administrator account before seeding demo media.");
 const owner=admin.rows[0].id;
 directory=join(mediaRoot,owner);
 await mkdir(directory,{recursive:true,mode:0o700});
 const hasAlbum=await client.query("SELECT id FROM media WHERE id=$1",[album]);
 const missing=[];
 for(const item of items){
  const exists=await client.query("SELECT id FROM media WHERE id=$1",[item.id]);
  if(exists.rowCount)skipped++;
  else missing.push(item);
 }
 if(!missing.length&&hasAlbum.rowCount){
  console.log("Demo media already installed. Nothing to change.");
  process.exitCode=0;
 }else{
  const artwork=[];
  for(const cover of covers){
   const existing=await client.query("SELECT id FROM media_assets WHERE id=$1",[cover.id]);
   if(existing.rowCount)continue;
   const path=join(directory,cover.id+".webp");
   await sharp(svgCover(cover)).webp({quality:84}).toFile(path);
   artwork.push({id:cover.id,path,title:cover.title,size:(await stat(path)).size});
  }
  const files=[];
  for(const item of missing){
   const path=join(directory,item.asset+"."+item.ext);
   if(item.ext==="mp3")await synthAudio(path,item.frequency);
   else await synthVideo(path,item.frequency,item.id===items[2].id?0:1);
   await validate(path,item.ext==="mp3"?"audio":"video");
   files.push({...item,path,size:(await stat(path)).size});
  }
  await client.query("BEGIN");
  try{
   for(const a of artwork)await client.query(
    "INSERT INTO media_assets(id,owner_id,original_name,media_type,mime_type,extension,storage_path,size_bytes)"+
    " VALUES($1,$2,$3,'image','image/webp','webp',$4,$5) ON CONFLICT(id) DO NOTHING",
    [a.id,owner,a.title+" demo artwork",a.path,a.size]);
   if(!hasAlbum.rowCount){
    await client.query("INSERT INTO media(id,owner_id,kind,title,description,genre,visibility,price_cents,cover_asset_id) "+
     "VALUES($1,$2,'album','Night Drive (Demo Album)','Original synthetic sample album for testing playback queues.','Synth','published',0,$3) ON CONFLICT(id) DO NOTHING",
     [album,owner,covers[0].id]);
   }
   for(const item of files){
    await client.query("INSERT INTO media_assets(id,owner_id,original_name,media_type,mime_type,extension,storage_path,size_bytes) "+
     "VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING",
     [item.asset,owner,item.title+"."+item.ext,item.ext==="mp3"?"audio":"video",item.type,item.ext,item.path,item.size]);
    await client.query("INSERT INTO media(id,owner_id,kind,title,description,genre,visibility,price_cents,parent_id,asset_id,cover_asset_id) "+
     "VALUES($1,$2,$3,$4,'Original synthetic demonstration content. Not licensed commercial media.',$5,'published',0,$6,$7,$8) ON CONFLICT(id) DO NOTHING",
     [item.id,owner,item.kind,item.title,item.genre,item.parent,item.asset,item.cover]);
    created++;
   }
   await client.query("COMMIT");
  }catch(e){await client.query("ROLLBACK");throw e;}
  console.log("Installed "+created+" playable demo samples and Night Drive album. "+skipped+" existed.");
 }
}catch(e){
 console.error(e instanceof Error?e.message:"Demo generation failed");
 process.exitCode=1;
}finally{await client.end();}
