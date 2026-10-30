import { useEffect, useState, type FormEvent } from "react";
import { Film, Music2, ImageIcon, UploadCloud, Trash2, ShieldCheck, RefreshCw, FolderOpen, Eye } from "lucide-react";
import { api, type LibraryAsset, type User, uploadToLibrary } from "./api";

function niceSize(size:number){return size >= 1048576?(size/1048576).toFixed(1)+" MB":(size/1024).toFixed(1)+" KB";}
export default function MediaLibrary({user}:{user:User|null}){
 const [mine,setMine]=useState<LibraryAsset[]>([]),[all,setAll]=useState<LibraryAsset[]>([]);
 const [scope,setScope]=useState<"mine"|"all">("mine"),[type,setType]=useState<"all"|"audio"|"video"|"image">("all");
 const [file,setFile]=useState<File|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [queryText,setQueryText]=useState("");
 const canUpload=user?.role==="creator"||user?.role==="admin";
 async function refresh(){
  if(!canUpload)return;
  try{
   const own=await api<{items:LibraryAsset[]}>("/library");setMine(own.items);
   if(user?.role==="admin")setAll((await api<{items:LibraryAsset[]}>("/admin/library")).items);
  }catch(e){setError((e as Error).message);}
 }
 useEffect(()=>{refresh();},[user?.id]);
 async function submit(event:FormEvent){
  event.preventDefault();setError("");setNotice("");
  if(!file)return;
  const ext=file.name.split(".").pop()?.toLowerCase();
  if(!["mp3","wav","flac","ogg","m4a","mp4","mov","webm","jpg","jpeg","png","webp"].includes(ext||"")){setError("Choose an allowed audio, video or artwork image file.");return;}
  setBusy(true);
  try{
   await uploadToLibrary(file);
   setNotice("File saved securely to your Media Library.");
   setFile(null);
   const form=event.currentTarget as HTMLFormElement;
   form.reset();
   await refresh();
  }catch(e){setError((e as Error).message);}
  finally{setBusy(false);}
 }
 async function remove(id:string){
  if(!confirm("Delete this unused file from your private library?"))return;
  setError("");setNotice("");
  try{await api("/library/"+id,{method:"DELETE"});await refresh();setNotice("Media file deleted.");}
  catch(e){setError((e as Error).message);}
 }
 if(!canUpload)return <div className="empty-state"><FolderOpen size={35}/><h2>Creator access required</h2><p>Only musicians, filmmakers, content owners and administrators have an upload library.</p></div>;
 const entries=(scope==="all"?all:mine).filter(x=>(type==="all"||x.media_type===type)&&(x.original_name.toLowerCase().includes(queryText.toLowerCase())||x.uploader_name?.toLowerCase().includes(queryText.toLowerCase())));
 return <div className="media-library-page">
  <div className="page-heading"><span className="eyebrow">CENTRALIZED MEDIA MANAGER</span><h1>Media Library</h1><p>All uploaded music, video, artwork and profile-ready images live in one place. Your private files are owned by your account, and only an administrator can see everyone's uploads.</p></div>
  <div className="library-columns">
   <form className="surface-card" onSubmit={submit}>
    <UploadCloud size={27}/><h2>Upload music, video or artwork</h2>
    <p>Music/video: MP3, WAV, FLAC, OGG, M4A, MP4, MOV, WEBM (1 GB). Artwork: JPG, JPEG, PNG, WebP (10 MB).</p>
    <label className="file-drop"><UploadCloud size={36}/><strong>{file?.name||"Choose audio, video or cover image"}</strong><small>No PHP, JSON, TXT, SVG, HTML, PDF or executable files. Images are allowed for covers and avatars only.</small>
     <input aria-label="Choose audio or video file" type="file" accept=".mp3,.wav,.flac,.ogg,.m4a,.mp4,.mov,.webm,.jpg,.jpeg,.png,.webp,audio/*,video/*,image/jpeg,image/png,image/webp" onChange={e=>setFile(e.target.files?.[0]||null)}/>
    </label>
    <button className="btn-gold full" disabled={!file||busy}>{busy?"Validating and storing...":"Upload to Media Library"}</button>
    <p className="muted"><ShieldCheck size={13} style={{display:"inline"}}/> Your file is stored outside the public web directory. The server validates playable audio/video and decodes/re-encodes artwork; extensions alone cannot bypass validation.</p>
   </form>
   <div className="surface-card">
    <div className="section-heading"><h2>{scope==="all"?"All Users' Media":"My Media"}</h2><button className="btn-outline" onClick={refresh}><RefreshCw size={15}/>Refresh</button></div>
    {user?.role==="admin"&&<div className="library-tabs"><button className={scope==="mine"?"active":""} onClick={()=>setScope("mine")}>My uploads</button><button className={scope==="all"?"active":""} onClick={()=>setScope("all")}>Entire library (admin)</button></div>}
    <div className="library-filters"><input aria-label="Filter media files" placeholder="Search your uploads..." value={queryText} onChange={e=>setQueryText(e.target.value)}/><select aria-label="Media type" value={type} onChange={e=>setType(e.target.value as typeof type)}><option value="all">All types</option><option value="audio">Music</option><option value="video">Video</option><option value="image">Cover art / Images</option></select></div>
    {error&&<p className="error">{error}</p>}{notice&&<p className="success">{notice}</p>}
    <div className="media-list">
    {entries.map(a=><div className="asset-row" key={a.id}>
     <div className="asset-icon">{a.media_type==="audio"?<Music2 size={21}/>:a.media_type==="video"?<Film size={21}/>:<ImageIcon size={21}/>}</div>
     <div className="asset-details"><strong title={a.original_name}>{a.original_name}</strong><small>{a.media_type.toUpperCase()} · {niceSize(a.size_bytes)} · {new Date(a.created_at).toLocaleDateString()}</small>{scope==="all"&&<small>Uploader: {a.uploader_name} ({a.uploader_email})</small>}</div>
     <div className="asset-actions">
      <a className="btn-outline" href={"/api/library/"+a.id+"/stream"} target="_blank" rel="noreferrer" title="Preview file"><Eye size={15}/></a>
      {(scope==="mine"||a.owner_id===user?.id)&&<button className="btn-outline" onClick={()=>remove(a.id)} title="Delete unused file"><Trash2 size={15}/></button>}
     </div>
    </div>)}
    {!entries.length&&<div className="empty-state"><FolderOpen size={30}/><h3>No media or artwork files found</h3><p>Upload a media file to add it to this centralized library.</p></div>}
    </div>
   </div>
  </div>
 </div>;
}
