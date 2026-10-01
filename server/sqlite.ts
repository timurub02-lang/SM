import { DatabaseSync, type SQLInputValue } from "node:sqlite";

// Implements the D1 operations used by CRM while keeping batch writes atomic.
export function openDatabase(path: string) {
  const connection = new DatabaseSync(path);
  connection.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  class Statement {
    readonly sql: string;
    readonly values: SQLInputValue[];
    constructor(sql: string, values: SQLInputValue[] = []) { this.sql = sql; this.values = values; }
    bind(...values: SQLInputValue[]) { return new Statement(this.sql, values); }
    async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
      const row = connection.prepare(this.sql).get(...this.values);
      return (row ? (column ? row[column] : row) : null) as T | null;
    }
    async all<T = Record<string, unknown>>() {
      return { results: connection.prepare(this.sql).all(...this.values) as T[], success: true };
    }
    execute() {
      const result = connection.prepare(this.sql).run(...this.values);
      return { results: [], success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
    }
    async run() { return this.execute(); }
  }
  return {
    prepare(sql: string) { return new Statement(sql); },
    async batch(statements: Statement[]) {
      connection.exec("BEGIN IMMEDIATE");
      try {
        const result = statements.map(statement => statement.execute());
        connection.exec("COMMIT");
        return result;
      } catch (error) {
        connection.exec("ROLLBACK");
        throw error;
      }
    },
    close() { connection.close(); },
  };
}
