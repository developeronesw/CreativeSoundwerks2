import { useState, type ReactNode } from "react";
import { ArrowRight, Play, ShoppingCart, Music2, Film, Clapperboard, Tv, UploadCloud, Headphones, Crown, Megaphone, ShieldCheck, CheckCircle2 } from "lucide-react";
import { api, money, type Media, type Plan, type User, videoKind } from "./api";
import { usePlayer } from "./Player";
export function Section({title,children,aside}:{title:string;children:ReactNode;aside?:ReactNode}){return <section className="section"><div className="section-heading"><h2>{title}</h2>{aside}</div>{children}</section>;}
export function ButtonLink({children,onClick}:{children:ReactNode;onClick?:()=>void}){return <button className="link-button" onClick={onClick}>{children}<ArrowRight size={15}/></button>}
const gradients=["linear-gradient(125deg,#162235,#89615d,#dac0a0)","linear-gradient(125deg,#1c1d36,#6e427c,#dc9eb6)","linear-gradient(125deg,#263747,#6f8a93,#c4be9b)","linear-gradient(125deg,#2e221d,#a77845,#f4d69d)","linear-gradient(125deg,#1b202a,#47526e,#b3a8c8)","linear-gradient(125deg,#273839,#398d8f,#a4c5ac)"];
export function MediaCard({item,index=0,cartChanged}:{item:Media;index?:number;cartChanged?:()=>void}){
 const {play}=usePlayer();const [msg,setMsg]=useState("");
 const paid=item.price_cents>0;
 async function add(){try{await api("/cart",{method:"POST",body:JSON.stringify({mediaId:item.id})});setMsg("Added");cartChanged?.();}catch(e){setMsg((e as Error).message);}}
 return <article className="media-card"><div className="media-art" style={{background:gradients[index%gradients.length]}}>
  {item.cover_asset_id?<img className="cover-image" src={"/api/media/"+item.id+"/cover"} alt={item.title+" cover art"} loading="lazy"/>:videoKind(item.kind)?<Film size={46} strokeWidth={1.2}/>:<Music2 size={46} strokeWidth={1.2}/>}
  <span className="media-type">{item.kind.replaceAll("_"," ")}</span>
  <button className="media-play" onClick={()=>play(item)} aria-label={"Play "+item.title}><Play size={18} fill="currentColor"/></button>
 </div><div className="media-label"><strong>{item.title}</strong><span>{item.creator||item.genre||"Creative Soundwerks"}</span></div>
 {paid&&<button className="mini-purchase" onClick={add}><ShoppingCart size={13}/>{msg||money(item.price_cents)}</button>}
 </article>;
}
export function Plans({plans,user,onSubscribed}:{plans:Plan[];user:User|null;onSubscribed?:()=>void}){
 const [loading,setLoading]=useState<string|null>(null),[error,setError]=useState("");
 async function choose(p:Plan){
  if(!user){window.location.assign("/join");return;}
  if(user.role!=="admin"&&p.audience!==(user.role==="creator"?"creator":"fan")){setError("Choose a plan for your account type.");return;}
  if(p.amount_cents===0){setError("Free listener access is included in your account.");return;}
  setLoading(p.id);setError("");
  try{const {url}=await api<{url:string}>("/checkout/plan",{method:"POST",body:JSON.stringify({planId:p.id})});if(url)window.location.assign(url);onSubscribed?.();}
  catch(e){setError((e as Error).message);}finally{setLoading(null);}
 }
 return <><div className="plan-grid">{plans.map((p,i)=><div className={"plan-card "+(i===1?"featured-plan":"")} key={p.id}>{i===1&&<span className="best-badge">Most popular</span>}<h3>{p.name}</h3><div className="plan-price">{money(p.amount_cents)}<small>/month</small></div><p>{p.description}</p><ul>{p.features.map(f=><li key={f}><CheckCircle2 size={15}/>{f}</li>)}</ul><button disabled={loading===p.id} className={i===1?"btn-gold":"btn-outline"} onClick={()=>choose(p)}>{loading===p.id?"Redirecting...":"Select plan"}</button></div>)}</div>{error&&<p className="error">{error}</p>}</>;
}
export function FeatureTiles(){
 return <div className="feature-tiles">
  <a href="/join" className="feature-tile"><Headphones/> <span><strong>For listeners</strong><small>Music, movies and television</small></span><ArrowRight size={17}/></a>
  <a href="/join" className="feature-tile"><Clapperboard/> <span><strong>For creators</strong><small>Upload, monetize, build an audience</small></span><ArrowRight size={17}/></a>
  <a href="/ads" className="feature-tile"><Megaphone/> <span><strong>For businesses</strong><small>Advertising and partnerships</small></span><ArrowRight size={17}/></a>
 </div>;
}
export const CategoryIcon=({kind}:{kind:string})=>kind==="music"?<Music2/>:kind==="movies"?<Film/>:kind==="tv"?<Tv/>:<UploadCloud/>;
export const features={creator:<Crown/>,ad:<Megaphone/>,setup:<ShieldCheck/>,upload:<UploadCloud/>,watch:<Play/>,music:<Music2/>,tv:<Tv/>,film:<Film/>};
