// Jest stand-in for expo-sqlite, backed by better-sqlite3 so tests exercise
// REAL SQL semantics — transactions that roll back, UNIQUE constraints,
// PRAGMA user_version migrations — instead of a hand-written fake that would
// only mirror our assumptions back at us.
//
// Placed in the root __mocks__ directory (adjacent to node_modules), so Jest
// substitutes it automatically wherever 'expo-sqlite' is imported.
//
// Persistence model: the underlying better-sqlite3 database lives in a
// module-level registry keyed by database name, and closeSync() only drops
// the wrapper's handle — exactly like closing a real on-disk database. A
// test that closes the database and reopens it therefore sees the same data
// (simulating an app process restart), while deleteDatabaseSync() is the
// "wipe the file" escape hatch used for isolation between tests.

import Database from 'better-sqlite3';

const databasesByName = new Map<string, Database.Database>();

type BindParams = unknown[];

class MockSQLiteDatabase {
  constructor(private readonly db: Database.Database) {}

  execSync(source: string): void {
    this.db.exec(source);
  }

  runSync(source: string, params: BindParams = []): { changes: number; lastInsertRowId: number } {
    const result = this.db.prepare(source).run(...(params as never[]));
    return { changes: result.changes, lastInsertRowId: Number(result.lastInsertRowid) };
  }

  getFirstSync<T>(source: string, params: BindParams = []): T | null {
    return (this.db.prepare(source).get(...(params as never[])) as T | undefined) ?? null;
  }

  getAllSync<T>(source: string, params: BindParams = []): T[] {
    return this.db.prepare(source).all(...(params as never[])) as T[];
  }

  withTransactionSync(task: () => void): void {
    this.db.transaction(task)();
  }

  closeSync(): void {
    // Intentionally keeps the registry entry: data survives like a file on
    // disk would, so reopening after closeSync() simulates an app relaunch.
  }
}

export function openDatabaseSync(databaseName: string): MockSQLiteDatabase {
  let db = databasesByName.get(databaseName);
  if (!db) {
    db = new Database(':memory:');
    databasesByName.set(databaseName, db);
  }
  return new MockSQLiteDatabase(db);
}

export function deleteDatabaseSync(databaseName: string): void {
  const db = databasesByName.get(databaseName);
  if (db) {
    db.close();
    databasesByName.delete(databaseName);
  }
}

export type SQLiteDatabase = MockSQLiteDatabase;
