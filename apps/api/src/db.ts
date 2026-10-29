import pg from "pg";
import "dotenv/config";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params: unknown[] = []) {
  return pool.query<T>(sql, params);
}
