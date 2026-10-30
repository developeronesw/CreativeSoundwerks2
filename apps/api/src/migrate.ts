import { pool, configured } from "./db.js";
import { runMigrations } from "./migrations.js";
if(!configured())throw Error("DATABASE_URL required before migration");
try{await runMigrations(pool);console.log("Database schema ready");}
finally{await pool.end();}
