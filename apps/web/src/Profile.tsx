import { useState, type FormEvent } from "react";
import { Camera, ShieldCheck, UserRound } from "lucide-react";
import { type User, imageExtensions } from "./api";

export default function Profile({user,onUpdated}:{user:User|null;onUpdated:()=>Promise<void>}){
 const [file,setFile]=useState<File|null>(null);
 const [error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false);
 if(!user)return <div className="empty-state"><UserRound size={38}/><h2>Sign in to manage your profile</h2></div>;
 async function save(e:FormEvent){
  e.preventDefault();if(!file)return;setError("");setNotice("");
  if(!imageExtensions.includes(file.name.split(".").pop()?.toLowerCase()||"")){setError("Choose a JPG, JPEG, PNG or WebP photo.");return;}
  setBusy(true);
  try{
   const body=new FormData();body.append("file",file);
   const response=await fetch("/api/profile/avatar/upload",{method:"POST",credentials:"same-origin",body});
   const result=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(result.error||"Avatar upload failed");
   await onUpdated();
   setFile(null);setNotice("Your profile photo was updated.");
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 return <div className="profile-page"><div className="page-heading"><span className="eyebrow">YOUR IDENTITY</span><h1>My Profile</h1><p>Your Creative Soundwerks profile, personal information and avatar are managed under your account.</p></div>
 <div className="surface-card profile-card">
  <div className="profile-photo">{user.avatar_asset_id?<img src={"/api/profiles/"+user.id+"/avatar?v="+user.avatar_asset_id} alt="Your profile photo"/>:<UserRound size={55}/>}</div>
  <h2>{user.display_name}</h2><p>{user.email} · {user.role==="creator"?"Creator":user.role==="admin"?"Administrator":"Listener"}</p>
  <form onSubmit={save} className="upload-form"><h3><Camera size={20}/> Profile picture</h3>
   <label className="file-drop"><Camera size={31}/><strong>{file?.name||"Choose a profile photo"}</strong><small>JPG, PNG or WebP · Max 10 MB · Automatically converted to safe WebP</small>
    <input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" onChange={e=>setFile(e.target.files?.[0]||null)}/></label>
   {error&&<p className="error">{error}</p>}{notice&&<p className="success">{notice}</p>}
   <button className="btn-gold" disabled={!file||busy}>{busy?"Saving...":"Update profile picture"}</button>
  </form>
  <p className="muted"><ShieldCheck size={15} style={{display:"inline"}}/> Only you can upload and assign your profile image. Published avatars are visible to visitors.</p>
 </div></div>;
}
