#!/usr/bin/env node
// Stable Creative Soundwerks launcher for standalone Node hosting.
import {existsSync,readFileSync} from "node:fs";
import {join,dirname,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {config} from "dotenv";

const root=resolve(process.env.CSW_INSTALL_ROOT||process.cwd());
const cfg=resolve(process.env.CSW_CONFIG_PATH||join(root,".env"));
config({path:cfg});
const updates=resolve(process.env.CSW_UPDATE_ROOT||join(dirname(cfg),"csw-updates"));
const active=join(updates,"current");
let entry=join(root,"apps/api/dist/index.js");
if(existsSync(active)){
 const target=join(active,"apps/api/dist/index.js");
 if(!existsSync(target))throw Error("Active update is incomplete; check update recovery before restarting");
 entry=target;
 const revision=readFileSync(join(active,".csw-revision"),"utf8").trim();
 if(!/^[a-f0-9]{40}$/.test(revision))throw Error("Invalid installed revision");
 process.env.CSW_ACTIVE_SHA=revision;
}
process.env.CSW_UPDATE_ROOT=updates;
process.env.CSW_CONFIG_PATH=cfg;
process.env.CSW_INSTALL_ROOT=root;
await import(pathToFileURL(entry).href);
