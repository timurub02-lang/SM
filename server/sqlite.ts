import { DatabaseSync, type SQLInputValue } from "node:sqlite";

// Implements the D1 operations used by CRM while keeping batch writes atomic.
export function openDatabase(path: string) {
  const connection = new DatabaseSync(path);
  connection.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=0;");
  // SQLite's synchronous busy timeout freezes HTTP and phone WebSocket authorization.
  // Retry outside transactions so other requests can run while another process writes.
  async function retryBusy<T>(operation: () => T): Promise<T> {
    const deadline = performance.now() + 5000;
    for (;;) {
      try { return operation(); }
      catch (error) {
        if (!error || typeof error !== "object" || !("errcode" in error) || (Number(error.errcode) & 255) !== 5 || performance.now() >= deadline) throw error;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
  }
  class Statement {
    readonly sql: string;
    readonly values: SQLInputValue[];
    constructor(sql: string, values: SQLInputValue[] = []) { this.sql = sql; this.values = values; }
    bind(...values: SQLInputValue[]) { return new Statement(this.sql, values); }
    async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
      return retryBusy(() => {
        const row = connection.prepare(this.sql).get(...this.values);
        return (row ? (column ? row[column] : row) : null) as T | null;
      });
    }
    async all<T = Record<string, unknown>>() {
      return retryBusy(() => ({ results: connection.prepare(this.sql).all(...this.values) as T[], success: true }));
    }
    execute() {
      const result = connection.prepare(this.sql).run(...this.values);
      return { results: [], success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
    }
    async run() { return retryBusy(() => this.execute()); }
  }
  return {
    prepare(sql: string) { return new Statement(sql); },
    async batch(statements: Statement[]) {
      return retryBusy(() => {
        connection.exec("BEGIN IMMEDIATE");
        try {
          const result = statements.map(statement => statement.execute());
          connection.exec("COMMIT");
          return result;
        } catch (error) {
          connection.exec("ROLLBACK");
          throw error;
        }
      });
    },
    close() { connection.close(); },
  };
}
