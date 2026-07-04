// Runs against the real schema on a real SQL engine: the expo-sqlite module
// is backed by better-sqlite3 in tests (see __mocks__/expo-sqlite.ts), so
// migrations, transactions, and constraints behave like they do on device.

import { deleteDatabaseSync } from 'expo-sqlite';

import {
  closeLocalDb,
  deleteQueueRow,
  getLocalDb,
  listAllQueueRows,
  listPendingQueueRows,
  LOCAL_DB_NAME,
  LOCAL_DB_SCHEMA_VERSION,
  migrateLocalDb,
  recordQueueAttempt,
} from '../localDb';

function insertQueueRow(
  id: string,
  createdAt: string,
  overrides: { status?: string; version?: number } = {},
): void {
  getLocalDb().runSync(
    `INSERT INTO sync_queue (id, user_id, entity_type, entity_id, operation, payload, created_at, status, version)
     VALUES (?, 'user-1', 'habit', ?, 'create', '{}', ?, ?, ?)`,
    [id, `habit-${id}`, createdAt, overrides.status ?? 'pending', overrides.version ?? 0],
  );
}

beforeEach(() => {
  closeLocalDb();
  deleteDatabaseSync(LOCAL_DB_NAME);
});

describe('schema and migrations', () => {
  it('creates all tables and stamps the schema version on first open', () => {
    const db = getLocalDb();

    const tables = db
      .getAllSync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .map((row) => row.name);
    expect(tables).toEqual(
      expect.arrayContaining(['habits', 'habit_completions', 'sync_queue']),
    );
    expect(db.getFirstSync<{ user_version: number }>('PRAGMA user_version')).toEqual({
      user_version: LOCAL_DB_SCHEMA_VERSION,
    });
  });

  it('is idempotent: reopening neither errors nor wipes existing data', () => {
    getLocalDb().runSync(
      `INSERT INTO habits (id, user_id, name, frequency, created_at, updated_at)
       VALUES ('habit-1', 'user-1', 'Read', 'daily', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z')`,
      [],
    );

    // Simulates the app process being killed and relaunched: the handle is
    // dropped, the file (registry-backed in tests) persists.
    closeLocalDb();
    const reopened = getLocalDb();

    // Running the migrations a second time must be a no-op — a duplicate
    // CREATE TABLE would throw here if the version gate failed.
    expect(reopened.getAllSync<{ id: string }>('SELECT id FROM habits')).toEqual([
      { id: 'habit-1' },
    ]);
    expect(
      reopened.getAllSync<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'habits'",
      ),
    ).toHaveLength(1);
  });

  it('applies only migrations newer than the stored version, preserving data', () => {
    const db = getLocalDb();
    db.runSync(
      `INSERT INTO habits (id, user_id, name, frequency, created_at, updated_at)
       VALUES ('habit-1', 'user-1', 'Read', 'daily', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z')`,
      [],
    );

    // A hypothetical Phase 5+ migration: existing databases must upgrade in
    // place — new column present, old rows intact, version bumped.
    const withExtra = [
      'SELECT 1', // placeholder for v1 (already applied; must NOT run again)
      'ALTER TABLE habits ADD COLUMN reminder_time TEXT',
    ];
    migrateLocalDb(db, withExtra);

    expect(
      db.getFirstSync<{ id: string; reminder_time: string | null }>(
        'SELECT id, reminder_time FROM habits',
      ),
    ).toEqual({ id: 'habit-1', reminder_time: null });
    expect(db.getFirstSync<{ user_version: number }>('PRAGMA user_version')).toEqual({
      user_version: 2,
    });
  });
});

describe('sync queue helpers', () => {
  it('lists pending rows oldest first, excluding failed rows', () => {
    insertQueueRow('row-2', '2026-07-02T00:00:00.000Z');
    insertQueueRow('row-1', '2026-07-01T00:00:00.000Z');
    insertQueueRow('row-3', '2026-07-03T00:00:00.000Z', { status: 'failed' });

    expect(listPendingQueueRows('user-1').map((row) => row.id)).toEqual(['row-1', 'row-2']);
    expect(listAllQueueRows('user-1').map((row) => row.id)).toEqual(['row-1', 'row-2', 'row-3']);
  });

  it('breaks created_at ties by insertion order', () => {
    insertQueueRow('row-a', '2026-07-01T00:00:00.000Z');
    insertQueueRow('row-b', '2026-07-01T00:00:00.000Z');

    expect(listPendingQueueRows('user-1').map((row) => row.id)).toEqual(['row-a', 'row-b']);
  });

  it('scopes rows to the given user', () => {
    insertQueueRow('row-1', '2026-07-01T00:00:00.000Z');

    expect(listPendingQueueRows('user-2')).toEqual([]);
  });

  it('deletes a row only when the version still matches', () => {
    insertQueueRow('row-1', '2026-07-01T00:00:00.000Z', { version: 1 });

    // A stale version means the row was collapsed with newer state while its
    // old payload was in flight — it must survive to sync that newer state.
    expect(deleteQueueRow('row-1', 0)).toBe(false);
    expect(listPendingQueueRows('user-1')).toHaveLength(1);

    expect(deleteQueueRow('row-1', 1)).toBe(true);
    expect(listPendingQueueRows('user-1')).toHaveLength(0);
  });

  it('records attempts and failure status only for the version it read', () => {
    insertQueueRow('row-1', '2026-07-01T00:00:00.000Z');

    recordQueueAttempt('row-1', 0, 'permission denied', 'failed');
    const [failed] = listAllQueueRows('user-1');
    expect(failed).toMatchObject({ attempts: 1, last_error: 'permission denied', status: 'failed' });

    // Same guard as deletion: a collapsed row keeps its fresh pending state.
    insertQueueRow('row-2', '2026-07-02T00:00:00.000Z', { version: 3 });
    recordQueueAttempt('row-2', 2, 'stale write', 'failed');
    const row2 = listAllQueueRows('user-1').find((row) => row.id === 'row-2');
    expect(row2).toMatchObject({ attempts: 0, last_error: null, status: 'pending' });
  });
});
