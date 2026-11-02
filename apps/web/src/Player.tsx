import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type PointerEvent } from "react";
import { Pause, Play, SkipBack, SkipForward, Volume2, X, ExternalLink, Maximize2, Minimize2, Music2, ListMusic } from "lucide-react";
import { api, type Media, videoKind } from "./api";

type PlayerContext={play:(m:Media)=>void;current:Media|null};
const Ctx=createContext<PlayerContext>({play:()=>{},current:null});
export const usePlayer=()=>useContext(Ctx);
function clock(sec:number){
 if(!Number.isFinite(sec)||sec<0)return "0:00";
 return Math.floor(sec/60)+":"+String(Math.floor(sec%60)).padStart(2,"0");
}
export function PlayerProvider({children}:{children:ReactNode}){
 const [queue,setQueue]=useState<Media[]>([]);
 const [index,setIndex]=useState(0);
 const [current,setCurrent]=useState<Media|null>(null);
 const [playing,setPlaying]=useState(false);
 const [position,setPosition]=useState(0),[duration,setDuration]=useState(0);
 const [volume,setVolume]=useState(.8),[minimized,setMinimized]=useState(false);
 const [showQueue,setShowQueue]=useState(false);
 const [error,setError]=useState("");
 const [loading,setLoading]=useState(false);
 const [offset,setOffset]=useState({x:0,y:0});
 const drag=useRef<{x:number;y:number;startX:number;startY:number}|null>(null);
 const media=useRef<HTMLMediaElement|null>(null),lastSaved=useRef(0),request=useRef(0);
 const video=Boolean(current&&videoKind(current.kind));
 const source=current?"/api/media/"+current.id+"/stream":"";
 function select(item:Media,positionInQueue:number){
  setIndex(positionInQueue);setCurrent(item);setPlaying(true);
  setPosition(0);setDuration(0);setError("");
  setMinimized(false);setOffset({x:0,y:0});lastSaved.current=0;
 }
 async function load(item:Media){
  const selected=++request.current;
  setLoading(true);setError("");
  try{
   const result=await api<{items:Media[];startIndex:number}>("/media/"+item.id+"/queue");
   if(selected!==request.current)return;
   if(!result.items.length||result.startIndex<0)throw Error("No playable tracks in this release.");
   setQueue(result.items);
   select(result.items[result.startIndex],result.startIndex);
   setShowQueue(false);
  }catch(e){
   if(selected===request.current)setError((e as Error).message||"Unable to play this title.");
  }finally{if(selected===request.current)setLoading(false);}
 }
 function play(item:Media){void load(item);}
 function next(){
  if(!current||index>=queue.length-1)return;
  select(queue[index+1],index+1);
 }
 function previous(){
  if(!current)return;
  if(position>3){seek(0);return;}
  if(index>0)select(queue[index-1],index-1);
  else seek(0);
 }
 function toggle(){
  const element=media.current;if(!element)return;
  if(element.paused)element.play().catch(()=>setError("Playback blocked or this file is unavailable."));
  else element.pause();
 }
 function seek(time:number){
  const element=media.current;
  if(!element||!Number.isFinite(time)||!Number.isFinite(duration)||duration<=0)return;
  const target=Math.max(0,Math.min(time,duration));
  element.currentTime=target;setPosition(target);
 }
 function onTick(){
  const t=media.current?.currentTime??0;
  if(!Number.isFinite(t))return;
  setPosition(t);
  if(current&&t-lastSaved.current>=20){
   lastSaved.current=t;
   api("/progress/"+current.id,{method:"PUT",body:JSON.stringify({positionSeconds:Math.floor(t)})}).catch(()=>{});
  }
 }
 function onEnded(){
  if(index<queue.length-1)next();
  else setPlaying(false);
 }
 // Browser autoplay is best-effort; play button remains available if it is blocked.
 useEffect(()=>{
  const element=media.current;
  if(!element||!current)return;
  element.volume=volume;
  element.play().catch(()=>{setPlaying(false);setError("Tap Play to start listening.");});
 },[current?.id,video]);
 useEffect(()=>{if(media.current)media.current.volume=volume;},[volume]);
 function dragStart(e:PointerEvent<HTMLDivElement>){
  if((e.target as HTMLElement).closest("button,input,video"))return;
  drag.current={x:e.clientX,y:e.clientY,startX:offset.x,startY:offset.y};
  e.currentTarget.setPointerCapture(e.pointerId);
 }
 function dragMove(e:PointerEvent<HTMLDivElement>){
  if(drag.current)setOffset({x:drag.current.startX+e.clientX-drag.current.x,y:drag.current.startY+e.clientY-drag.current.y});
 }
 async function externalPiP(){
  const element=media.current as HTMLVideoElement|null;
  if(element?.requestPictureInPicture)await element.requestPictureInPicture().catch(()=>{});
 }
 const currentTitle=current?.title||"Choose something to play";
 const currentCreator=current?.creator||"Explore music, movies and TV";
 return <Ctx.Provider value={{play,current}}>
  {children}
  {current&&video&&<div className={"floating-video "+(minimized?"floating-video-minimized":"")}
   style={{transform:"translate("+offset.x+"px,"+offset.y+"px)"}}
   onPointerDown={dragStart} onPointerMove={dragMove} onPointerUp={()=>drag.current=null}
   onPointerCancel={()=>drag.current=null}>
   <div className="floating-video-heading"><span>NOW PLAYING · {current.title}</span>
    <div><button title="Browser picture-in-picture" onClick={externalPiP}><ExternalLink size={16}/></button>
     <button title="Minimize video" onClick={()=>setMinimized(true)}><Minimize2 size={16}/></button>
     <button title="Close video" onClick={()=>{
      ++request.current;setCurrent(null);setQueue([]);setPlaying(false);setShowQueue(false);
     }}><X size={16}/></button></div>
   </div>
   <div className="video-frame">
    <video key={current.id} ref={media as React.RefObject<HTMLVideoElement>} src={source}
     preload="metadata" onTimeUpdate={onTick} onDurationChange={e=>setDuration(Number.isFinite(e.currentTarget.duration)?e.currentTarget.duration:0)}
     onPlaying={()=>{setPlaying(true);setError("");}} onPause={()=>setPlaying(false)}
     onEnded={onEnded} onError={()=>{setPlaying(false);setError("Video could not be loaded. Check this file's format or access.");}}
     controls playsInline/>
   </div>
   <div className="floating-caption"><span>{currentCreator}</span><span>Drag to reposition</span></div>
  </div>}
  {current&&!video&&<audio key={current.id} ref={media as React.RefObject<HTMLAudioElement>} src={source}
   preload="metadata" onTimeUpdate={onTick}
   onDurationChange={e=>setDuration(Number.isFinite(e.currentTarget.duration)?e.currentTarget.duration:0)}
   onPlaying={()=>{setPlaying(true);setError("");}} onPause={()=>setPlaying(false)}
   onEnded={onEnded} onError={()=>{setPlaying(false);setError("Audio could not be loaded. Check the media file or access.");}}/>}
  <div className="player-bar" role="region" aria-label="Media player">
   <div className="player-track">
    <div className="cover-sm">
     {current?.cover_asset_id?<img src={"/api/media/"+current.id+"/cover"} alt="" style={{width:"100%",height:"100%",objectFit:"cover",borderRadius:7}}/>:<Music2 size={20}/>}
    </div>
    <div><strong title={currentTitle}>{loading?"Loading media…":currentTitle}</strong>
     <small title={currentCreator}>{currentCreator}</small>
    </div>
   </div>
   <div className="player-main">
    <div className="transport">
     <button aria-label="Previous track or restart" title="Previous track" onClick={previous} disabled={!current}>
      <SkipBack size={20}/></button>
     <button className="play-toggle" aria-label={playing?"Pause":"Play"} onClick={toggle} disabled={!current||loading}>
      {playing?<Pause fill="currentColor" size={22}/>:<Play fill="currentColor" size={22}/>}
     </button>
     <button aria-label="Next track" title="Next track" onClick={next} disabled={!current||index>=queue.length-1}>
      <SkipForward size={20}/></button>
    </div>
    <div className="progress">
     <span>{clock(position)}</span>
     <input type="range" aria-label="Playback position" min={0} max={duration||1}
      step=".5" value={Math.min(position,duration||1)} disabled={!current||!duration}
      onChange={e=>seek(Number(e.target.value))}/>
     <span>{clock(duration)}</span>
    </div>
   </div>
   <div className="player-extra">
    <Volume2 size={18}/><input aria-label="Volume" type="range" min={0} max={1} step=".01"
     value={volume} onChange={e=>setVolume(Number(e.target.value))}/>
    {video&&<button onClick={()=>setMinimized(!minimized)} title="Show/hide floating video">
      {minimized?<Maximize2 size={19}/>:<Minimize2 size={19}/>}</button>}
    <button className="player-queue-toggle" aria-label="Show playback queue"
     aria-expanded={showQueue} onClick={()=>setShowQueue(!showQueue)} disabled={!current}>
     <ListMusic size={19}/></button>
   </div>
   {current&&<button className="player-queue-toggle player-queue-mobile" aria-label="Show playback queue"
    aria-expanded={showQueue} onClick={()=>setShowQueue(!showQueue)}>
    <ListMusic size={20}/></button>}
   {showQueue&&queue.length>0&&<div className="player-queue" role="region" aria-label="Playback queue">
    <div className="player-queue-header"><strong>Up next · {queue.length} title{queue.length===1?"":"s"}</strong>
     <button aria-label="Close playback queue" onClick={()=>setShowQueue(false)}><X size={17}/></button></div>
    {queue.map((item,i)=><button key={item.id} className={"player-queue-item "+(i===index?"active":"")}
     onClick={()=>{select(item,i);setShowQueue(false);}}>
     <Music2 size={16}/><span>{item.title}</span>{i===index&&<span aria-label="Current" style={{flex:"none"}}>●</span>}
    </button>)}
   </div>}
   {error&&<div className="player-status" role="alert" title={error}>{error}</div>}
  </div>
 </Ctx.Provider>;
}
