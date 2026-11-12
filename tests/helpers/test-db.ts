import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Db, SqlValue } from "../../lib/server/db";

/**
 * In-memory SQLite database with every append-only migration applied.
 * Mirrors D1's prepared-statement semantics, including transactional batches.
 */
export function createTestDb(): Db {
  const database = new DatabaseSync(":memory:");
  const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "drizzle");
  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    database.exec(readFileSync(join(migrationsDir, file), "utf8"));
  }

  return {
    async first<T>(sql: string, params: SqlValue[] = []) {
      const row = database.prepare(sql).get(...params) as Record<string, unknown> | undefined;
      return (row ? { ...row } : null) as T | null;
    },
    async all<T>(sql: string, params: SqlValue[] = []) {
      const rows = database.prepare(sql).all(...params) as Array<Record<string, unknown>>;
      return rows.map((row) => ({ ...row })) as T[];
    },
    async run(sql: string, params: SqlValue[] = []) {
      const result = database.prepare(sql).run(...params);
      return { changes: Number(result.changes) };
    },
    async batch(statements: Array<{ sql: string; params?: SqlValue[] }>) {
      database.exec("BEGIN");
      try {
        const results = statements.map((statement) => {
          const result = database.prepare(statement.sql).run(...(statement.params ?? []));
          return { changes: Number(result.changes) };
        });
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

export const id = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
