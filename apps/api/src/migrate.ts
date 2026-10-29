import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { pool } from "./db.js";
const directory=fileURLToPath(new URL("../sql/",import.meta.url));
const migrations=(await readdir(directory)).filter(n=>/^\d+_.+\.sql$/.test(n)).sort();
const client=await pool.connect();
try{
 await client.query("BEGIN");
 await client.query("SELECT pg_advisory_xact_lock(26710935)");
 await client.query("CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
 for(const name of migrations){
  const done=await client.query("SELECT 1 FROM schema_migrations WHERE name=$1",[name]);
  if(done.rowCount)continue;
  await client.query(await readFile(join(directory,name),"utf8"));
  await client.query("INSERT INTO schema_migrations(name) VALUES($1)",[name]);
  console.log("Applied database migration:",name);
 }
 await client.query("COMMIT");
 console.log("Database schema ready");
}catch(error){await client.query("ROLLBACK");throw error;}
finally{client.release();await pool.end();}
