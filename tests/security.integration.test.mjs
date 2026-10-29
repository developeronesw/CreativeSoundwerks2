import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import pg from "pg";
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
 const a=await register("a"),b=await register("b");
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
 assert.equal((await call("/auth/logout","POST",{},a.cookie)).status,200);
 assert.equal((await call("/media/mine","GET",undefined,a.cookie)).status,401);
 await db.end();
});
