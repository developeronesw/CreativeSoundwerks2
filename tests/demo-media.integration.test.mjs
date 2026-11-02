import test from "node:test";
import assert from "node:assert/strict";
const url="http://127.0.0.1:8787";
const album="00000000-0000-4000-8000-00000000d100";
const song1="00000000-0000-4000-8000-00000000d101";
const song2="00000000-0000-4000-8000-00000000d102";
const video="00000000-0000-4000-8000-00000000d103";
const shortFilm="00000000-0000-4000-8000-00000000d104";
test("seeded original audio/video are published and albums resolve a real queue",async()=>{
 const listing=await fetch(url+"/api/media");
 assert.equal(listing.status,200);
 const {items}=await listing.json();
 for(const id of [album,song1,song2,video,shortFilm]){
  const item=items.find(x=>x.id===id);
  assert.ok(item,"demo title must be visible: "+id);
  assert.equal(item.price_cents,0,"demo must be free");
 }
 const result=await fetch(url+"/api/media/"+album+"/queue");
 assert.equal(result.status,200);
 const queue=await result.json();
 assert.deepEqual(queue.items.map(x=>x.id),[song1,song2]);
 assert.equal(queue.startIndex,0);
 const second=await fetch(url+"/api/media/"+song2+"/queue");
 assert.equal(second.status,200);
 assert.equal((await second.json()).startIndex,1);
});
test("demo audio and H264 video support valid, seekable HTTP Range responses",async()=>{
 for(const [id,mime] of [[song1,"audio/mpeg"],[video,"video/mp4"],[shortFilm,"video/mp4"]]){
  const response=await fetch(url+"/api/media/"+id+"/stream",{headers:{Range:"bytes=0-1023"}});
  assert.equal(response.status,206,id);
  assert.match(response.headers.get("content-type")||"",new RegExp(mime.replace("/","\\/")));
  assert.match(response.headers.get("content-range")||"",/^bytes 0-1023\/\d+$/);
  const bytes=await response.arrayBuffer();
  assert.equal(bytes.byteLength,1024,id);
 }
});
test("demo artwork and queue respect media access and content type",async()=>{
 const cover=await fetch(url+"/api/media/"+album+"/cover");
 assert.equal(cover.status,200);
 assert.match(cover.headers.get("content-type")||"",/image\/webp/);
 const data=Buffer.from(await cover.arrayBuffer());
 assert.equal(data.toString("ascii",0,4),"RIFF");
 assert.equal(data.toString("ascii",8,12),"WEBP");
 const unknown=await fetch(url+"/api/media/00000000-0000-4000-8000-00000000dead/queue");
 assert.equal(unknown.status,404);
});
