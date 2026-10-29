import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type PointerEvent } from "react";
import { Pause, Play, SkipBack, SkipForward, Volume2, X, ExternalLink, Maximize2, Minimize2, Music2, ListMusic } from "lucide-react";
import { api, type Media, videoKind } from "./api";
type PlayerCtx={play:(m:Media)=>void;current:Media|null};
const Ctx=createContext<PlayerCtx>({play:()=>{},current:null});
export const usePlayer=()=>useContext(Ctx);
function clock(n:number){if(!Number.isFinite(n))return "0:00";return Math.floor(n/60)+":"+String(Math.floor(n%60)).padStart(2,"0");}
export function PlayerProvider({children}:{children:ReactNode}){
 const [current,setCurrent]=useState<Media|null>(null),[playing,setPlaying]=useState(false),[position,setPosition]=useState(0),[duration,setDuration]=useState(0),[volume,setVolume]=useState(.8),[minimized,setMinimized]=useState(false);
 const [offset,setOffset]=useState({x:0,y:0});
 const drag=useRef<{x:number;y:number;startX:number;startY:number}|null>(null);
 const media=useRef<HTMLMediaElement|null>(null),lastSaved=useRef(0);
 const video=!!current&&videoKind(current.kind);
 const source=current?"/api/media/"+current.id+"/stream":"";
 function play(m:Media){setCurrent(m);setPlaying(true);setPosition(0);setDuration(0);setMinimized(false);setOffset({x:0,y:0});lastSaved.current=0;}
 useEffect(()=>{
   if(!current||!media.current)return;
   media.current.volume=volume;
   if(playing)media.current.play().catch(()=>setPlaying(false));
 },[current?.id,video]);
 useEffect(()=>{if(media.current)media.current.volume=volume;},[volume]);
 function toggle(){if(!media.current)return; if(media.current.paused){media.current.play().then(()=>setPlaying(true)).catch(()=>setPlaying(false));}else{media.current.pause();setPlaying(false);}}
 function seek(sec:number){if(media.current&&Number.isFinite(sec)){media.current.currentTime=sec;setPosition(sec);}}
 function onTick(){const t=media.current?.currentTime||0;setPosition(t);if(current&&t-lastSaved.current>20){lastSaved.current=t;api("/progress/"+current.id,{method:"PUT",body:JSON.stringify({positionSeconds:Math.floor(t)})}).catch(()=>{});}}
 function dragStart(e:PointerEvent<HTMLDivElement>){if((e.target as HTMLElement).closest("button,input"))return;drag.current={x:e.clientX,y:e.clientY,startX:offset.x,startY:offset.y};e.currentTarget.setPointerCapture(e.pointerId);}
 function dragMove(e:PointerEvent<HTMLDivElement>){if(drag.current)setOffset({x:drag.current.startX+e.clientX-drag.current.x,y:drag.current.startY+e.clientY-drag.current.y});}
 async function externalPiP(){const el=media.current as HTMLVideoElement|null;if(el?.requestPictureInPicture)await el.requestPictureInPicture().catch(()=>{});}
 return <Ctx.Provider value={{play,current}}>
  {children}
  {current&&video&&<div className={"floating-video "+(minimized?"floating-video-minimized":"")} style={{transform:"translate("+offset.x+"px,"+offset.y+"px)"}} onPointerDown={dragStart} onPointerMove={dragMove} onPointerUp={()=>drag.current=null}>
   <div className="floating-video-heading"><span>NOW PLAYING · {current.title}</span><div><button title="Browser picture-in-picture" onClick={externalPiP}><ExternalLink size={16}/></button><button title="Minimize video" onClick={()=>setMinimized(true)}><Minimize2 size={16}/></button><button title="Close video" onClick={()=>{setCurrent(null);setPlaying(false);}}><X size={16}/></button></div></div>
   <div className="video-frame"><video ref={media as React.RefObject<HTMLVideoElement>} src={source} onTimeUpdate={onTick} onLoadedMetadata={e=>setDuration(e.currentTarget.duration)} onEnded={()=>setPlaying(false)} controls playsInline/></div>
   <div className="floating-caption"><span>{current.creator||"Creative Soundwerks"}</span><span>Drag to reposition</span></div>
  </div>}
  {current&&!video&&<audio ref={media as React.RefObject<HTMLAudioElement>} src={source} onTimeUpdate={onTick} onLoadedMetadata={e=>setDuration(e.currentTarget.duration)} onEnded={()=>setPlaying(false)}/>}
  <div className="player-bar">
   <div className="player-track"><div className="cover-sm"><Music2 size={20}/></div><div><strong>{current?.title||"Your soundtrack starts here"}</strong><small>{current?.creator||"Select a song, film or episode"}</small></div></div>
   <div className="player-main"><div className="transport"><button aria-label="Previous" onClick={()=>seek(0)}><SkipBack size={19}/></button><button className="play-toggle" aria-label={playing?"Pause":"Play"} onClick={toggle}>{playing?<Pause fill="currentColor" size={21}/>:<Play fill="currentColor" size={21}/>}</button><button aria-label="Forward 10 seconds" onClick={()=>seek(Math.min(duration,position+10))}><SkipForward size={19}/></button></div>
    <div className="progress"><span>{clock(position)}</span><input type="range" aria-label="Playback position" min={0} max={duration||1} step=".5" value={position} onChange={e=>seek(Number(e.target.value))}/><span>{clock(duration)}</span></div>
   </div>
   <div className="player-extra"><Volume2 size={18}/><input aria-label="Volume" type="range" min={0} max={1} step=".01" value={volume} onChange={e=>setVolume(Number(e.target.value))}/>{video&&<button onClick={()=>setMinimized(!minimized)} title="Show/hide floating video">{minimized?<Maximize2 size={19}/>:<Minimize2 size={19}/>}</button>}<ListMusic size={18}/></div>
  </div>
 </Ctx.Provider>;
}
