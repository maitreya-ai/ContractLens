import { config } from "@/lib/config";
import { SCHEMA_SQL } from "@/lib/db/schema";

/** Minimal query surface shared by PGlite and postgres.js. Parameters use $1, $2... */
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Queryable {
  kind: "pglite" | "postgres";
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
}

async function createPglite(): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { vector } = await import("@electric-sql/pglite-pgvector");
  const dataDir = config.pgliteDir === "memory" ? undefined : config.pgliteDir;
  if (dataDir) {
    const fs = await import("node:fs");
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const pg = new PGlite({ dataDir, extensions: { vector } });
  await pg.exec(SCHEMA_SQL);
  return {
    kind: "pglite",
    async query<T>(sql: string, params: unknown[] = []) {
      return (await pg.query<T>(sql, params)).rows;
    },
    tx(fn) {
      return pg.transaction((t) =>
        fn({
          async query<T>(sql: string, params: unknown[] = []) {
            return (await t.query<T>(sql, params)).rows;
          },
        }),
      );
    },
  };
}

async function createPostgres(): Promise<Db> {
  const { default: postgres } = await import("postgres");
  const sql = postgres(config.databaseUrl, { max: 5, onnotice: () => {} });
  await sql.unsafe(SCHEMA_SQL);
  type Param = Parameters<typeof sql.unsafe>[1];
  return {
    kind: "postgres",
    async query<T>(text: string, params: unknown[] = []) {
      return (await sql.unsafe(text, params as Param)) as unknown as T[];
    },
    async tx(fn) {
      const result = await sql.begin((t) =>
        fn({
          async query<T>(text: string, params: unknown[] = []) {
            return (await t.unsafe(text, params as Param)) as unknown as T[];
          },
        }),
      );
      return result as Awaited<ReturnType<typeof fn>>;
    },
  };
}

// Survive Next.js hot reloads: one database handle per process.
const globalForDb = globalThis as unknown as { __contractlensDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  if (!globalForDb.__contractlensDb) {
    globalForDb.__contractlensDb = (config.databaseUrl ? createPostgres() : createPglite()).catch(
      (err) => {
        globalForDb.__contractlensDb = undefined;
        throw err;
      },
    );
  }
  return globalForDb.__contractlensDb;
}

/** pgvector literal for a parameter: '[0.1,0.2,...]' (cast with ::vector in SQL). */
export function toVector(v: number[]): string {
  return `[${v.join(",")}]`;
}
