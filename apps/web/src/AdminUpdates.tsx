import {useEffect,useState} from "react";
import {ArrowDownToLine,RefreshCw,ShieldCheck,AlertTriangle,CheckCircle2,ServerCog} from "lucide-react";
import {api} from "./api";

type Status={
 currentSha:string;latestSha:string|null;updateAvailable:boolean;
 approved:boolean;ciStatus:string;ciUrl:string|null;
 workerReady:boolean;state:{stage:string;targetSha:string|null;error:string|null;updatedAt:string|null}|null;
 error:string|null;
};
const busyStages=new Set(["queued","checking","building","backing_up","migrating","restart_required","rollback_restart_required"]);
const labels:Record<string,string>={
 checking:"Verifying official release",
 building:"Installing dependencies and building new release",
 backing_up:"Backing up PostgreSQL",
 migrating:"Applying database migrations",
 restart_required:"Restarting application",
 rollback_restart_required:"Restoring previous release",
 succeeded:"Update completed",
 rolled_back:"Previous version restored",
 failed:"Update failed before deployment",
 needs_inspection:"Update needs administrator inspection"
};
export default function AdminUpdates(){
 const [status,setStatus]=useState<Status|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[password,setPassword]=useState(""),[approved,setApproved]=useState(false),[feedback,setFeedback]=useState("");
 const refresh=async(silent=false)=>{
  if(!silent)setBusy(true);
  try{setStatus(await api<Status>("/admin/updates"));if(!silent)setError("");}
  catch(e){if(!silent)setError((e as Error).message);}
  finally{if(!silent)setBusy(false);}
 };
 useEffect(()=>{void refresh();},[]);
 useEffect(()=>{
  if(!status?.state||!busyStages.has(status.state.stage))return;
  const timer=setInterval(()=>{void refresh(true);},4000);
  return ()=>clearInterval(timer);
 },[status?.state?.stage]);
 const inProgress=Boolean(status?.state&&busyStages.has(status.state.stage));
 const allowed=!!status?.workerReady&&!!status.approved&&status.updateAvailable&&!inProgress;
 async function apply(){
  if(!status?.latestSha)return;
  setBusy(true);setError("");setFeedback("");
  try{
   await api("/admin/updates/apply",{method:"POST",headers:{Origin:window.location.origin},
    body:JSON.stringify({targetSha:status.latestSha,password,confirmed:true})});
   setFeedback("Update request accepted. Creative Soundwerks will build, back up, and apply it through its independent updater.");
   setPassword("");setApproved(false);
   await refresh(true);
  }catch(e){setError((e as Error).message);}
  finally{setBusy(false);}
 }
 return <section className="surface-card self-update-panel" aria-label="Creative Soundwerks software updates">
  <div className="self-update-head"><div><span className="eyebrow">SYSTEM MAINTENANCE</span>
   <h2>Software updates</h2>
   <p className="muted">Update directly from the official Creative Soundwerks GitHub repository. DevOne Server is not required.</p>
  </div><ServerCog size={29}/></div>
  <div className="self-update-revisions">
   <div><small>Installed revision</small><strong>{status?.currentSha.slice(0,12)??"Checking…"}</strong></div>
   <div><small>Official main revision</small><strong>{status?.latestSha?.slice(0,12)??"Unavailable"}</strong></div>
  </div>
  <div className="self-update-checks">
   <span><ShieldCheck size={18}/> GitHub CI: {status?.ciStatus??"Checking"}</span>
   <span>{status?.workerReady?<CheckCircle2 size={18}/>:<AlertTriangle size={18}/>}
    Independent updater: {status?.workerReady?"Online":"Not configured or offline"}</span>
  </div>
  {status?.ciUrl&&<a href={status.ciUrl} target="_blank" rel="noopener noreferrer" className="small-link">
   View official GitHub test results</a>}
  {status?.state&&<div className="self-update-progress" role="status">
   <strong>{labels[status.state.stage]??status.state.stage}</strong>
   {status.state.targetSha&&<span>Target: {status.state.targetSha.slice(0,12)}</span>}
   {status.state.error&&<p className="error">Reason: {status.state.error}</p>}
   {status.state.stage==="needs_inspection"&&<p>Keep the website in maintenance mode and inspect the server backups before retrying.</p>}
  </div>}
  {!status?.workerReady&&<p className="muted">
   The independent Creative Soundwerks update service must be installed once on this host.
   The normal standalone VPS installer includes it; existing panel deployments need the one-time updater setup.
  </p>}
  {status?.updateAvailable&&status.approved&&<div className="self-update-approval">
   <p>An approved new revision is ready. Updating briefly pauses writes, backs up PostgreSQL, and verifies the new release before ending maintenance.</p>
   <label>Confirm administrator password
    <input type="password" autoComplete="current-password" value={password}
     onChange={e=>setPassword(e.target.value)} disabled={!allowed||busy}/></label>
   <label className="self-update-confirm"><input type="checkbox" checked={approved}
    onChange={e=>setApproved(e.target.checked)} disabled={!allowed||busy}/>
    I approve updating this Creative Soundwerks installation to the tested GitHub revision.</label>
  </div>}
  {feedback&&<p className="success">{feedback}</p>}{error&&<p className="error">{error}</p>}
  <div className="self-update-actions">
   <button type="button" className="btn-outline" disabled={busy} onClick={()=>void refresh()}>
    <RefreshCw size={16}/> {busy?"Checking…":"Check for updates"}</button>
   {status?.updateAvailable&&<button type="button" className="btn-gold"
    disabled={!allowed||!password||!approved||busy} onClick={()=>void apply()}>
    <ArrowDownToLine size={16}/> {inProgress?"Updating…":"Install approved update"}</button>}
  </div>
 </section>;
}
