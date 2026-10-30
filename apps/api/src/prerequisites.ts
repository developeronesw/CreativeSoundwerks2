import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FastifyInstance } from "fastify";
const exec=promisify(execFile);
async function binary(name:"ffmpeg"|"ffprobe"){
 try{
  const r=await exec(name,["-version"],{timeout:5000,maxBuffer:8192});
  return {ready:true,version:r.stdout.split("\n")[0].slice(0,120)};
 }catch{return {ready:false,version:null};}
}
export async function prerequisiteRoutes(app:FastifyInstance){
 app.get("/api/setup/prerequisites",async()=>{
  const [ffmpeg,ffprobe]=await Promise.all([binary("ffmpeg"),binary("ffprobe")]);
  return {ready:ffmpeg.ready&&ffprobe.ready,ffmpeg,ffprobe,node:process.version,
   installCommand:"sudo bash scripts/install-ubuntu.sh"};
 });
}
