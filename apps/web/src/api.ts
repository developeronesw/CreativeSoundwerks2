export type User={id:string;email:string;display_name:string;role:"admin"|"creator"|"fan";creator_type?:string|null};
export type Plan={id:string;audience:"creator"|"fan";name:string;description:string;amount_cents:number;upload_limit:number;features:string[];active?:boolean};
export type Media={id:string;kind:string;title:string;description?:string;genre?:string;creator?:string;price_cents:number;visibility?:string;uploaded?:boolean;owner_id?:string};
export type LibraryAsset={id:string;owner_id:string;original_name:string;media_type:"audio"|"video";mime_type:string;size_bytes:number;extension:string;created_at:string;uploader_name?:string;uploader_email?:string};
export type CartItem={id:string;kind:string;title:string;price_cents:number};
export async function api<T>(path:string,options:RequestInit={}):Promise<T>{
 const res=await fetch("/api"+path,{credentials:"same-origin",...options,headers:{"Content-Type":"application/json",...options.headers}});
 let data:any;
 try{data=await res.json();}catch{data={};}
 if(!res.ok)throw new Error(data.error || "Request failed ("+res.status+")");
 return data as T;
}
export async function upload(path:string,file:File):Promise<void>{
 const body=new FormData();body.append("file",file);
 const response=await fetch("/api"+path,{method:"POST",body,credentials:"same-origin"});
 if(!response.ok){const j=await response.json().catch(()=>({}));throw new Error(j.error||"Upload failed");}
}
export const money=(cents:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(cents/100);
export const videoKind=(kind:string)=>["music_video","movie","short_film","episode","trailer"].includes(kind);

export async function uploadToLibrary(file:File):Promise<{item:LibraryAsset}>{
 const body=new FormData();
 body.append("file",file);
 const response=await fetch("/api/library/upload",{method:"POST",body,credentials:"same-origin"});
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(result.error||"Unable to upload media");
 return result as {item:LibraryAsset};
}
