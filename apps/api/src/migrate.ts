import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";
const path = fileURLToPath(new URL("../sql/001_init.sql", import.meta.url));
try { await pool.query(await readFile(path, "utf8")); console.log("Database initialized"); }
finally { await pool.end(); }
