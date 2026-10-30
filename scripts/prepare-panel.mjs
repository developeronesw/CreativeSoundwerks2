#!/usr/bin/env node
/**
 * Prepares the browser-guided installation for ANY Node.js hosting panel.
 * No root, no Nginx edits, no PostgreSQL provisioning and no outbound calls.
 * Run after npm install && npm run build. The panel must supply a PostgreSQL
 * database and a HTTPS reverse proxy to the Node process.
 */
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const configPath = resolve(process.env.CSW_CONFIG_PATH || join(root, ".env"));
const mediaPath = resolve(process.env.MEDIA_ROOT || join(dirname(root), ".creative-soundwerks-private-media"));
if(process.argv.includes("--check")){
 for(const file of ["package.json","apps/api/dist/index.js","apps/web/dist/index.html"]){
  if(!existsSync(join(root,file))){console.error("Missing "+file+". Run npm install && npm run build.");process.exitCode=1;}
 }
 if(process.exitCode!==1)console.log("Managed Node.js build is ready. Run npm run setup:panel.");
}else{
 if(existsSync(configPath)){
  console.error("Configuration already exists:",configPath);
  console.error("Will not overwrite credentials. Use the existing setup token or contact your hosting administrator.");
  process.exitCode=1;
 }else{
  const token=randomBytes(32).toString("hex");
  const text = [
   "NODE_ENV=production","HOST=127.0.0.1","PORT="+(process.env.PORT||"8787"),
   "COOKIE_SECURE=true","CSW_SETUP_TOKEN="+token,"MEDIA_ROOT="+mediaPath,
   "STRIPE_SECRET_KEY=","STRIPE_WEBHOOK_SECRET=",""
  ].join("\n");
  await mkdir(dirname(configPath),{recursive:true,mode:0o700});
  const handle=await open(configPath,"wx",0o600);
  try{await handle.writeFile(text);}finally{await handle.close();}
  await mkdir(mediaPath,{recursive:true,mode:0o700});
  console.log("Managed installation prepared; no sudo or DevOne Server required.");
  console.log("Place the Node project OUTSIDE your public document root.");
  console.log("Set the hosting panel's application entry point to apps/api/dist/index.js.");
  console.log("Proxy HTTPS requests /api/* to the Node app and serve apps/web/dist/ as static SPA.");
  console.log("Do not use an externally accessible HTTP-only installation.");
  console.log("One-time installer token (keep PRIVATE):",token);
  console.log("Open https://YOUR_DOMAIN/setup and complete database + admin setup.");
 }
}
