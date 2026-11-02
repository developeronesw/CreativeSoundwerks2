import {useEffect,useState} from "react";
import {Music2,Video,RefreshCcw,ShieldCheck} from "lucide-react";
import {api} from "./api";
type DemoStatus={job:{state:"idle"|"running"|"succeeded"|"failed";message:string;updatedAt:string|null};installedTitles:number};
export default function AdminDemo({onCatalogUpdated}:{onCatalogUpdated:()=>Promise<void>}){
 const [info,setInfo]=useState<DemoStatus|null>(null),[password,setPassword]=useState("");
 const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 async function refresh(){
  const next=await api<DemoStatus>("/admin/demo");
  setInfo(next);
  if(next.job.state==="succeeded")void onCatalogUpdated().catch(()=>{});
 }
 useEffect(()=>{void refresh().catch(()=>{});},[]);
 useEffect(()=>{
  if(info?.job.state!=="running")return;
  const timer=setInterval(()=>void refresh().catch(()=>{}),3500);
  return ()=>clearInterval(timer);
 },[info?.job.state]);
 async function install(){
  setBusy(true);setError("");
  try{
   await api("/admin/demo/seed",{method:"POST",body:JSON.stringify({confirmed:true,password})});
   setPassword("");setConfirmed(false);
   await refresh();
  }catch(e){setError((e as Error).message);}
  finally{setBusy(false);}
 }
 const running=info?.job.state==="running";
 return <section className="surface-card" aria-label="Demo music and video">
  <span className="eyebrow">OPTIONAL TEST CONTENT</span>
  <h2><Music2 size={20} style={{display:"inline",verticalAlign:"middle",marginRight:9}}/>Demo audio and videos</h2>
  <p>Generate two original synthetic audio tracks, two playable H.264 videos, artwork, and a demo album with a real playback queue. All samples are free and clearly labeled “Demo.”</p>
  <p className="muted"><Video size={15} style={{display:"inline",verticalAlign:"middle",marginRight:7}}/>
   Samples are generated locally with FFmpeg and stored in the normal private Media Library. No copyrighted songs or film footage are included. Nothing is installed automatically on customer sites.</p>
  <p><ShieldCheck size={15} style={{display:"inline",verticalAlign:"middle",marginRight:7}}/>
   Installed demo titles: <strong>{info?.installedTitles??"—"}/5</strong>
   {info?.job.state==="running"?" · Generating media…":""}</p>
  {info?.job.state==="failed"&&<p className="error">{info.job.message}</p>}
  {info?.job.state==="succeeded"&&<p className="success">{info.job.message}</p>}
  {info?.installedTitles!==5&&<div className="edit-form" style={{maxWidth:440}}>
   <label>Confirm administrator password
    <input type="password" autoComplete="current-password" value={password}
     onChange={e=>setPassword(e.target.value)} disabled={busy||running}/></label>
   <label style={{display:"flex",alignItems:"flex-start",gap:9}}>
    <input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}
     disabled={busy||running}/>
    I approve generating optional demo content in this installation.
   </label>
   <button className="btn-gold" disabled={!password||!confirmed||busy||running}
    onClick={()=>void install()}>{running?"Generating samples…":"Install demo music and videos"}</button>
  </div>}
  <button className="btn-outline" style={{marginTop:12}} disabled={busy}
   onClick={()=>void refresh().catch(e=>setError((e as Error).message))}>
   <RefreshCcw size={15}/>Refresh demo status</button>
  {error&&<p className="error">{error}</p>}
 </section>;
}
