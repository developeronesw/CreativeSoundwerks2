import assert from "node:assert/strict";
const base="http://127.0.0.1:8791/api";
const token=process.env.CSW_SETUP_TOKEN;
assert.ok(token && token.length>=24);
async function request(path,method="GET",data){
 const res=await fetch(base+path,{method,headers:data?{"content-type":"application/json"}:{},body:data?JSON.stringify(data):undefined});
 return {status:res.status,body:await res.json().catch(()=>({})),cookie:(res.headers.get("set-cookie")||"").split(";")[0]};
}
const setup=await request("/setup/status");
assert.equal(setup.status,200);
assert.equal(setup.body.required,true);
assert.equal(setup.body.stage,"database");
const env=await request("/setup/environment");
assert.equal(env.body.databaseConfigured,false);
const invalid=await request("/setup/database","POST",{
 setupToken:"not-the-right-setup-token-123456",host:"127.0.0.1",port:5432,
 database:"csw_panel_test",username:"csw",password:"cswtest",publicUrl:"http://localhost:5173"
});
assert.equal(invalid.status,403);
const connection=await request("/setup/database","POST",{
 setupToken:token,host:"127.0.0.1",port:5432,
 database:"csw_panel_test",username:"csw",password:"cswtest",publicUrl:"http://localhost:5173"
});
assert.equal(connection.status,200,JSON.stringify(connection.body));
assert.equal(connection.body.next,"admin");
const next=await request("/setup/status");
assert.equal(next.body.stage,"admin");
const duplicate=await request("/setup/database","POST",{
 setupToken:token,host:"127.0.0.1",port:5432,
 database:"csw_panel_test",username:"csw",password:"cswtest",publicUrl:"http://localhost:5173"
});
assert.equal(duplicate.status,409);
const owner=await request("/setup/initialize","POST",{
 setupToken:token,displayName:"Hosted Site Owner",email:"owner@panel.example",password:"PanelTestOwnerPassword1234!"
});
assert.equal(owner.status,200,JSON.stringify(owner.body));
assert.equal(owner.body.user.role,"admin");
const finished=await request("/setup/status");
assert.equal(finished.body.stage,"complete");
assert.equal(finished.body.required,false);
const front=await fetch("http://127.0.0.1:8791/");
assert.equal(front.status,200);
assert.match(await front.text(),/Creative Soundwerks/);
const deep=await fetch("http://127.0.0.1:8791/setup");
assert.equal(deep.status,200);
assert.match(await deep.text(),/Creative Soundwerks/);
const blocked=await request("/setup/database","POST",{
 setupToken:token,host:"127.0.0.1",port:5432,
 database:"csw_panel_test",username:"csw",password:"cswtest",publicUrl:"http://localhost:5173"
});
assert.equal(blocked.status,409);
console.log("Managed panel installation: database bootstrap, admin and single-port React SPA passed.");
