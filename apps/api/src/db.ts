import pg from "pg";
import "./env.js";
export let pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
export const configured = () => Boolean(process.env.DATABASE_URL);
export async function switchDatabase(url:string, ready:pg.Pool){
 if(configured())throw Object.assign(new Error("Database already configured"),{statusCode:409});
 const old=pool;process.env.DATABASE_URL=url;pool=ready;await old.end();
}
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(sql:string,params:unknown[]=[]){
 if(!configured())throw Object.assign(new Error("Database setup required"),{statusCode:503});
 return pool.query<T>(sql,params);
}
