import { Pool } from "pg";
import { env } from "../config/env.js";

export const dbPool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});
