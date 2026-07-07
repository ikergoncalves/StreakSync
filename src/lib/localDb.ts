// Local SQLite database: the offline-first mirror of the user's personal data
// (habits and habit_completions) plus the queue of mutations awaiting sync.
//
// Only PERSONAL data lives here by design — groups, the activity feed, and
// the leaderboard stay online-only in Phase 4, so nothing social is mirrored.

import { deleteDatabaseSync, openDatabaseSync, SQLiteDatabase } from 'expo-sqlite';

export const LOCAL_DB_NAME = 'streaksync.db';

// Versioned migrations via PRAGMA user_version: entry N migrates a database
// at version N to version N+1, and each entry runs exactly once, inside its
// own transaction. Future phases append entries (e.g. ALTER TABLE ... ADD
// COLUMN) instead of editing existing ones, so shipped devices upgrade
// in place without wiping local data.
const MIGRATIONS: readonly string[] = [
  // v0 -> v1: initial schema. habits and habit_completions mirror the server
  // tables column for column (timestamps stored as ISO-8601 text, matching
  // the app's Habit/HabitCompletion types). sync_queue holds one row per
  // pending mutation, drained in creation order by the sync engine.
  `
  CREATE TABLE habits (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    icon TEXT,
    color TEXT,
    frequency TEXT NOT NULL,
    target_days_per_week INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE INDEX habits_user_id_idx ON habits (user_id);

  CREATE TABLE habit_completions (
    id TEXT PRIMARY KEY NOT NULL,
    habit_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    completed_on TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (habit_id, completed_on)
  );
  CREATE INDEX habit_completions_user_id_idx ON habit_completions (user_id);

  CREATE TABLE sync_queue (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    version INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX sync_queue_user_status_idx ON sync_queue (user_id, status);
  `,
];

export const LOCAL_DB_SCHEMA_VERSION = MIGRATIONS.length;

/**
 * Runs every not-yet-applied migration. Exported for tests, which verify
 * that re-running is a no-op and that appending a migration upgrades an
 * existing database without touching its data.
 */
export function migrateLocalDb(
  db: SQLiteDatabase,
  migrations: readonly string[] = MIGRATIONS,
): void {
  const row = db.getFirstSync<{ user_version: number }>('PRAGMA user_version');
  const startVersion = row?.user_version ?? 0;
  for (let version = startVersion; version < migrations.length; version += 1) {
    db.withTransactionSync(() => {
      db.execSync(migrations[version]);
      // PRAGMA cannot take bound parameters; version is a loop integer.
      db.execSync(`PRAGMA user_version = ${version + 1}`);
    });
  }
}

let db: SQLiteDatabase | null = null;

/** Opens (and migrates) the local database once, then reuses the handle. */
export function getLocalDb(): SQLiteDatabase {
  if (!db) {
    db = openDatabaseSync(LOCAL_DB_NAME);
    migrateLocalDb(db);
  }
  return db;
}

/**
 * Closes the cached handle so the next getLocalDb() reopens from disk.
 * Tests use it to simulate the app process being killed and relaunched.
 */
export function closeLocalDb(): void {
  if (db) {
    db.closeSync();
    db = null;
  }
}

/**
 * Deletes the database FILE, not just the handle (account deletion). A future
 * sign-up on this device must never see a stranger's leftover habits: closing
 * alone keeps the data on disk, so the file itself has to go. The next
 * getLocalDb() recreates a fresh, empty schema from scratch.
 */
export function deleteLocalDb(): void {
  closeLocalDb();
  deleteDatabaseSync(LOCAL_DB_NAME);
}

// ---------------------------------------------------------------------------
// sync_queue rows
// ---------------------------------------------------------------------------

export type SyncEntityType = 'habit' | 'habit_completion';
export type SyncOperation = 'create' | 'update' | 'delete' | 'toggle_completion';
/**
 * 'pending' rows are drained; 'failed' rows exhausted MAX attempts on a
 * permanent error and are kept only as evidence for the "sync issue" UI (a
 * new user action on the same entity re-arms them back to 'pending'). The
 * status column is an addition over the minimal queue spec precisely so
 * that giving up is a recorded state instead of a silent delete.
 */
export type SyncQueueStatus = 'pending' | 'failed';

export interface SyncQueueRow {
  id: string;
  user_id: string;
  entity_type: SyncEntityType;
  entity_id: string;
  operation: SyncOperation;
  /** JSON text; see the payload types in localHabits.ts. */
  payload: string;
  created_at: string;
  attempts: number;
  last_error: string | null;
  status: SyncQueueStatus;
  /**
   * Bumped whenever an existing row is collapsed in place (repeated offline
   * toggles of the same habit/date). The sync engine deletes and updates
   * rows guarded by the version it read, so a collapse that lands while the
   * row's mutation is in flight is never lost: the guarded write misses and
   * the row stays pending with its new payload.
   */
  version: number;
}

/** Pending mutations for one user, oldest first (rowid breaks created_at ties). */
export function listPendingQueueRows(userId: string): SyncQueueRow[] {
  return getLocalDb().getAllSync<SyncQueueRow>(
    "SELECT * FROM sync_queue WHERE user_id = ? AND status = 'pending' ORDER BY created_at, rowid",
    [userId],
  );
}

/** Every queue row for one user regardless of status (tests, UI counts). */
export function listAllQueueRows(userId: string): SyncQueueRow[] {
  return getLocalDb().getAllSync<SyncQueueRow>(
    'SELECT * FROM sync_queue WHERE user_id = ? ORDER BY created_at, rowid',
    [userId],
  );
}

/**
 * Deletes a synced queue row, but only if it still carries the version the
 * drain read. Returns false when a concurrent collapse bumped the version —
 * the row now describes a NEWER local state that still needs syncing.
 */
export function deleteQueueRow(id: string, version: number): boolean {
  const result = getLocalDb().runSync('DELETE FROM sync_queue WHERE id = ? AND version = ?', [
    id,
    version,
  ]);
  return result.changes > 0;
}

/**
 * Records a failed sync attempt, version-guarded like deleteQueueRow: if the
 * row was collapsed while its old payload was failing, the fresh user action
 * keeps its clean pending state instead of inheriting this failure.
 */
export function recordQueueAttempt(
  id: string,
  version: number,
  lastError: string,
  status: SyncQueueStatus,
): void {
  getLocalDb().runSync(
    'UPDATE sync_queue SET attempts = attempts + 1, last_error = ?, status = ? WHERE id = ? AND version = ?',
    [lastError, status, id, version],
  );
}
