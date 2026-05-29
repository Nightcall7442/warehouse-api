import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { env } from "../lib/env";
import * as schema from "@db/schema";
import * as relations from "@db/relations";

const fullSchema = { ...schema, ...relations };

type DrizzleInstance = ReturnType<typeof drizzle<typeof fullSchema>>;

let instance: DrizzleInstance | null = null;

export function getDb(): DrizzleInstance {
  if (!instance) {
    const pool = mysql.createPool({
      uri:              env.databaseUrl,
      waitForConnections: true,
      connectionLimit:  10,
      queueLimit:       0,
      enableKeepAlive:  true,
      keepAliveInitialDelay: 0,
    });

    instance = drizzle(pool, {
      schema:  fullSchema,
      mode:    "default",       // ← was "planetscale" — disabled FK checks + transactions
      logger:  !env.isProduction,
    });
  }
  return instance;
}
