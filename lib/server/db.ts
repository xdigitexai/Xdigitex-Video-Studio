/**
 * Minimal SQL client shared by the Cloudflare D1 runtime and the Node test harness.
 * Business logic never touches `cloudflare:workers` directly, which lets the full
 * accounting and tenancy layer run under `node:sqlite` in automated tests.
 */

export type SqlValue = string | number | null;

export interface RunResult {
  changes: number;
}

export interface Db {
  first<T>(sql: string, params?: SqlValue[]): Promise<T | null>;
  all<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
  run(sql: string, params?: SqlValue[]): Promise<RunResult>;
  /** Executes all statements in a single transaction; returns per-statement change counts. */
  batch(statements: Array<{ sql: string; params?: SqlValue[] }>): Promise<RunResult[]>;
}

type D1Like = {
  prepare(sql: string): {
    bind(...values: SqlValue[]): {
      first<T>(): Promise<T | null>;
      all<T>(): Promise<{ results: T[] }>;
      run(): Promise<{ meta?: { changes?: number } }>;
    };
  };
  batch(statements: unknown[]): Promise<Array<{ meta?: { changes?: number } }>>;
};

export function d1Db(database: D1Like): Db {
  return {
    async first<T>(sql: string, params: SqlValue[] = []) {
      return (await database.prepare(sql).bind(...params).first<T>()) ?? null;
    },
    async all<T>(sql: string, params: SqlValue[] = []) {
      const result = await database.prepare(sql).bind(...params).all<T>();
      return result.results ?? [];
    },
    async run(sql: string, params: SqlValue[] = []) {
      const result = await database.prepare(sql).bind(...params).run();
      return { changes: result.meta?.changes ?? 0 };
    },
    async batch(statements) {
      if (!statements.length) return [];
      const prepared = statements.map((statement) =>
        database.prepare(statement.sql).bind(...(statement.params ?? [])),
      );
      const results = await database.batch(prepared);
      return results.map((result) => ({ changes: result.meta?.changes ?? 0 }));
    },
  };
}

export function hasDb(env: unknown): boolean {
  return Boolean(env && typeof env === "object" && "DB" in env && (env as { DB?: unknown }).DB);
}
