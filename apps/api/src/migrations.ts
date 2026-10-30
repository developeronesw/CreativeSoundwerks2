import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type pg from "pg";

const directory = fileURLToPath(new URL("../sql/", import.meta.url));
export async function runMigrations(db:pg.Pool) {
 const list=(await readdir(directory)).filter(n=>/^\d+_.+\.sql$/.test(n)).sort();
 const c=await db.connect();
 try{
  await c.query("BEGIN");
  await c.query("SELECT pg_advisory_xact_lock(26710935)");
  await c.query("CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  for(const name of list){
   if((await c.query("SELECT 1 FROM schema_migrations WHERE name=$1",[name])).rowCount)continue;
   await c.query(await readFile(join(directory,name),"utf8"));
   await c.query("INSERT INTO schema_migrations(name) VALUES($1)",[name]);
  }
  await c.query("COMMIT");
 }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
}
