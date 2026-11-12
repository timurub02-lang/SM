import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";

// Implements the D1 operations used by CRM while keeping batch writes atomic.
export function openDatabase(path: string) {
  const connection = new DatabaseSync(path);
  connection.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=0;");
  // Native calls reset/rebind on each execution and reprepare after schema changes.
  // Keep only 256 strong references; Node finalizes evicted statements on GC or close.
  const statements = new Map<string, StatementSync>();
  function prepared(sql: string): StatementSync {
    const cached = statements.get(sql);
    if (cached) {
      statements.delete(sql);
      statements.set(sql, cached);
      return cached;
    }
    const statement = connection.prepare(sql);
    if (statements.size >= 256) statements.delete(statements.keys().next().value!);
    statements.set(sql, statement);
    return statement;
  }
  let yieldDeadline=performance.now()+2,pendingYield:Promise<void>|undefined;
  // SQLite's synchronous busy timeout freezes HTTP and phone WebSocket authorization.
  // Retry outside transactions so other requests can run while another process writes.
  async function retryBusy<T>(operation: () => T): Promise<T> {
    let deadline=0;
    for (;;) {
      // Share a short CPU budget, not one queue round-trip for every tiny SQL query.
      // Recheck after waking so concurrent callers cannot all bypass the budget.
      while(performance.now()>=yieldDeadline){
        pendingYield??=new Promise<void>(resolve=>setImmediate(()=>{yieldDeadline=performance.now()+2;pendingYield=undefined;resolve();}));
        await pendingYield;
      }
      if(!deadline)deadline=performance.now()+5000;
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
        const row = prepared(this.sql).get(...this.values);
        return (row ? (column ? row[column] : row) : null) as T | null;
      });
    }
    async all<T = Record<string, unknown>>() {
      return retryBusy(() => ({ results: prepared(this.sql).all(...this.values) as T[], success: true }));
    }
    execute() {
      const result = prepared(this.sql).run(...this.values);
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
    // Dedicated worker connections only: an async read transaction must never be shared with HTTP.
    async readSnapshot<T>(read: () => Promise<T>): Promise<T> {
      connection.exec("BEGIN");
      try { return await read(); } finally { connection.exec("ROLLBACK"); }
    },
    close() { statements.clear(); connection.close(); },
  };
}
