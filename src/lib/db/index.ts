import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Reuse one pool across dev hot reloads.
const g = globalThis as unknown as { sql?: ReturnType<typeof postgres> };
const sql = g.sql ?? postgres(process.env.DATABASE_URL ?? "postgres://localhost/eskupstina", { max: 10 });
if (process.env.NODE_ENV !== "production") g.sql = sql;

export const db = drizzle(sql, { schema, casing: "snake_case" });
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
