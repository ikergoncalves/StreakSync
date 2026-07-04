// Local-first data layer for habits and completions. SQLite is the source of
// truth for the UI: every read comes from here (instant, no network), and
// every write lands here first, together with a sync_queue row describing the
// mutation, in ONE transaction — never one without the other, or local and
// remote state could diverge permanently. The sync engine later replays the
// queue against Supabase and reconciles conflicts.

import { randomUUID } from 'expo-crypto';

import { HabitInput } from './habits';
import { getLocalDb, SyncEntityType, SyncOperation, SyncQueueRow } from './localDb';
import { Habit, HabitCompletion } from '../types';

// ---------------------------------------------------------------------------
// sync_queue payload shapes (stored as JSON text in sync_queue.payload)
// ---------------------------------------------------------------------------

/** operation 'create': the full locally-created row, pushed verbatim. */
export interface HabitCreatePayload {
  habit: Habit;
}

/**
 * operation 'update': the fields to change plus the LOCAL WRITE TIME, which
 * is the mutation's timestamp in the last-write-wins comparison against the
 * server row's updated_at when the queue drains.
 */
export interface HabitUpdatePayload {
  input: Partial<HabitInput>;
  base_updated_at: string;
}

/** operation 'delete': when the habit was soft-deleted locally. */
export interface HabitDeletePayload {
  deleted_at: string;
}

/**
 * operation 'toggle_completion': the DESIRED ABSOLUTE STATE for one
 * habit/date, not a relative flip. Because the payload is absolute, repeated
 * offline toggles collapse into this single row (see localToggleCompletion)
 * and replaying it is idempotent.
 */
export interface CompletionTogglePayload {
  /** Client-generated id used for the INSERT so replays stay idempotent. */
  completion_id: string;
  habit_id: string;
  completed_on: string;
  completed: boolean;
  /** Local write time; the LWW comparison base at drain time. */
  base_updated_at: string;
}

/** Queue key for a completion: habit UUIDs contain no ':', so this is unambiguous. */
export function completionEntityId(habitId: string, date: string): string {
  return `${habitId}:${date}`;
}

/** Inverse of completionEntityId (also maps habit rows to their habit id). */
export function habitIdOfQueueRow(row: Pick<SyncQueueRow, 'entity_type' | 'entity_id'>): string {
  return row.entity_type === 'habit' ? row.entity_id : row.entity_id.split(':')[0];
}

function enqueue(
  userId: string,
  entityType: SyncEntityType,
  entityId: string,
  operation: SyncOperation,
  payload: object,
): void {
  getLocalDb().runSync(
    `INSERT INTO sync_queue (id, user_id, entity_type, entity_id, operation, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      userId,
      entityType,
      entityId,
      operation,
      JSON.stringify(payload),
      new Date().toISOString(),
    ],
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface LocalHabitsData {
  habits: Habit[];
  /** Ascending YYYY-MM-DD completion dates per habit id (non-deleted habits only). */
  completions: Record<string, string[]>;
}

/** Everything the habits store needs, straight from SQLite — no network. */
export function hydrateHabitsData(userId: string): LocalHabitsData {
  const db = getLocalDb();
  const habits = db.getAllSync<Habit>(
    'SELECT * FROM habits WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at, id',
    [userId],
  );
  const habitIds = new Set(habits.map((habit) => habit.id));
  const completions: Record<string, string[]> = {};
  const rows = db.getAllSync<{ habit_id: string; completed_on: string }>(
    'SELECT habit_id, completed_on FROM habit_completions WHERE user_id = ? ORDER BY completed_on, habit_id',
    [userId],
  );
  for (const row of rows) {
    if (habitIds.has(row.habit_id)) {
      (completions[row.habit_id] ??= []).push(row.completed_on);
    }
  }
  return { habits, completions };
}

export function getLocalHabit(habitId: string): Habit | null {
  return getLocalDb().getFirstSync<Habit>('SELECT * FROM habits WHERE id = ?', [habitId]);
}

// ---------------------------------------------------------------------------
// Writes (each one: SQLite mirror + sync_queue row, atomically)
// ---------------------------------------------------------------------------

export function localCreateHabit(userId: string, input: HabitInput): Habit {
  const now = new Date().toISOString();
  const habit: Habit = {
    id: randomUUID(),
    user_id: userId,
    name: input.name,
    description: input.description,
    icon: input.icon,
    color: input.color,
    frequency: input.frequency,
    target_days_per_week: input.target_days_per_week,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
  const db = getLocalDb();
  db.withTransactionSync(() => {
    db.runSync(
      `INSERT INTO habits (id, user_id, name, description, icon, color, frequency, target_days_per_week, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        habit.id,
        habit.user_id,
        habit.name,
        habit.description,
        habit.icon,
        habit.color,
        habit.frequency,
        habit.target_days_per_week,
        habit.created_at,
        habit.updated_at,
        habit.deleted_at,
      ],
    );
    enqueue(userId, 'habit', habit.id, 'create', { habit } satisfies HabitCreatePayload);
  });
  return habit;
}

const UPDATABLE_COLUMNS = [
  'name',
  'description',
  'icon',
  'color',
  'frequency',
  'target_days_per_week',
] as const;

/** Applies a partial edit locally and queues it. Returns null for an unknown id. */
export function localUpdateHabit(
  userId: string,
  habitId: string,
  input: Partial<HabitInput>,
): Habit | null {
  const now = new Date().toISOString();
  const assignments: string[] = [];
  const params: (string | number | null)[] = [];
  for (const column of UPDATABLE_COLUMNS) {
    if (column in input) {
      assignments.push(`${column} = ?`);
      params.push(input[column] ?? null);
    }
  }
  const db = getLocalDb();
  let updated = false;
  db.withTransactionSync(() => {
    const result = db.runSync(
      `UPDATE habits SET ${[...assignments, 'updated_at = ?'].join(', ')} WHERE id = ?`,
      [...params, now, habitId],
    );
    if (result.changes === 0) {
      return;
    }
    updated = true;
    enqueue(userId, 'habit', habitId, 'update', {
      input,
      base_updated_at: now,
    } satisfies HabitUpdatePayload);
  });
  return updated ? getLocalHabit(habitId) : null;
}

/** Soft-deletes locally (mirroring the server's deleted_at) and queues it. */
export function localSoftDeleteHabit(userId: string, habitId: string): boolean {
  const now = new Date().toISOString();
  const db = getLocalDb();
  let deleted = false;
  db.withTransactionSync(() => {
    const result = db.runSync('UPDATE habits SET deleted_at = ?, updated_at = ? WHERE id = ?', [
      now,
      now,
      habitId,
    ]);
    if (result.changes === 0) {
      return;
    }
    deleted = true;
    enqueue(userId, 'habit', habitId, 'delete', { deleted_at: now } satisfies HabitDeletePayload);
  });
  return deleted;
}

export interface LocalToggleInput {
  habitId: string;
  userId: string;
  /** Local calendar date as YYYY-MM-DD. */
  date: string;
}

/**
 * Flips the completion for a habit/date in SQLite and queues the resulting
 * ABSOLUTE state. Repeated toggles of the same habit/date collapse into the
 * one existing queue row (payload replaced, version bumped) instead of
 * stacking one mutation per tap — the same net-effect dedup principle Phase 3
 * established for activity events. Re-toggling an entity whose previous sync
 * attempt failed also re-arms it: attempts and last_error reset, status back
 * to 'pending', because the user just expressed a fresh intent.
 */
export function localToggleCompletion({ habitId, userId, date }: LocalToggleInput): {
  completed: boolean;
} {
  const now = new Date().toISOString();
  const db = getLocalDb();
  let completed = false;
  db.withTransactionSync(() => {
    const existing = db.getFirstSync<{ id: string }>(
      'SELECT id FROM habit_completions WHERE habit_id = ? AND completed_on = ?',
      [habitId, date],
    );
    completed = !existing;
    let completionId: string;
    if (existing) {
      completionId = existing.id;
      db.runSync('DELETE FROM habit_completions WHERE id = ?', [existing.id]);
    } else {
      completionId = randomUUID();
      db.runSync(
        `INSERT INTO habit_completions (id, habit_id, user_id, completed_on, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [completionId, habitId, userId, date, now, now],
      );
    }
    const entityId = completionEntityId(habitId, date);
    const payload: CompletionTogglePayload = {
      completion_id: completionId,
      habit_id: habitId,
      completed_on: date,
      completed,
      base_updated_at: now,
    };
    const pendingRow = db.getFirstSync<{ id: string }>(
      "SELECT id FROM sync_queue WHERE user_id = ? AND entity_type = 'habit_completion' AND entity_id = ?",
      [userId, entityId],
    );
    if (pendingRow) {
      db.runSync(
        `UPDATE sync_queue
         SET payload = ?, attempts = 0, last_error = NULL, status = 'pending', version = version + 1
         WHERE id = ?`,
        [JSON.stringify(payload), pendingRow.id],
      );
    } else {
      enqueue(userId, 'habit_completion', entityId, 'toggle_completion', payload);
    }
  });
  return { completed };
}

// ---------------------------------------------------------------------------
// Server -> local (used by the sync engine)
// ---------------------------------------------------------------------------

/** Server timestamps arrive as '+00:00' offsets; store everything as ISO Z. */
function normalizeTimestamp(value: string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

/** Overwrites (or inserts) the local mirror row with the server's version. */
export function applyServerHabit(habit: Habit): void {
  getLocalDb().runSync(
    `INSERT OR REPLACE INTO habits (id, user_id, name, description, icon, color, frequency, target_days_per_week, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      habit.id,
      habit.user_id,
      habit.name,
      habit.description,
      habit.icon,
      habit.color,
      habit.frequency,
      habit.target_days_per_week,
      normalizeTimestamp(habit.created_at),
      normalizeTimestamp(habit.updated_at),
      normalizeTimestamp(habit.deleted_at),
    ],
  );
}

/**
 * Overwrites the local completion for the server row's habit/date. The
 * UNIQUE(habit_id, completed_on) constraint makes OR REPLACE displace a local
 * row with a different id for the same logical completion.
 */
export function applyServerCompletion(completion: HabitCompletion): void {
  getLocalDb().runSync(
    `INSERT OR REPLACE INTO habit_completions (id, habit_id, user_id, completed_on, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      completion.id,
      completion.habit_id,
      completion.user_id,
      completion.completed_on,
      normalizeTimestamp(completion.created_at),
      normalizeTimestamp(completion.updated_at),
    ],
  );
}

/** Removes a habit (and its completions) that no longer exists on the server. */
export function removeLocalHabit(habitId: string): void {
  const db = getLocalDb();
  db.withTransactionSync(() => {
    db.runSync('DELETE FROM habit_completions WHERE habit_id = ?', [habitId]);
    db.runSync('DELETE FROM habits WHERE id = ?', [habitId]);
  });
}

/**
 * Reconciliation merge: makes the local mirror match the server snapshot for
 * this user — EXCEPT for entities that still have sync_queue rows (any
 * status), whose local state embodies unsynced user intent. Those are left
 * untouched here; the drain step resolves them against the server using the
 * last-write-wins policy right after. Runs in one transaction so a mutation
 * committed while the server snapshot was in flight is either fully ahead of
 * the merge (its queue row protects it) or fully behind it.
 *
 * Absence encodes deletion: the server queries exclude soft-deleted habits,
 * so a local habit missing from the snapshot (with no pending mutations) was
 * deleted elsewhere and is dropped from the mirror.
 */
export function mergeServerData(
  userId: string,
  serverHabits: Habit[],
  serverCompletions: HabitCompletion[],
): void {
  const db = getLocalDb();
  db.withTransactionSync(() => {
    const queueRows = db.getAllSync<Pick<SyncQueueRow, 'entity_type' | 'entity_id'>>(
      'SELECT entity_type, entity_id FROM sync_queue WHERE user_id = ?',
      [userId],
    );
    const pendingHabitIds = new Set(
      queueRows.filter((row) => row.entity_type === 'habit').map((row) => row.entity_id),
    );
    const pendingCompletionKeys = new Set(
      queueRows
        .filter((row) => row.entity_type === 'habit_completion')
        .map((row) => row.entity_id),
    );

    const serverHabitIds = new Set<string>();
    for (const habit of serverHabits) {
      // Defense in depth (same rule as the store): habits RLS deliberately
      // exposes group peers' rows, so never mirror anything but the user's own.
      if (habit.user_id !== userId) {
        continue;
      }
      serverHabitIds.add(habit.id);
      if (!pendingHabitIds.has(habit.id)) {
        applyServerHabit(habit);
      }
    }
    for (const row of db.getAllSync<{ id: string }>('SELECT id FROM habits WHERE user_id = ?', [
      userId,
    ])) {
      if (!serverHabitIds.has(row.id) && !pendingHabitIds.has(row.id)) {
        db.runSync('DELETE FROM habits WHERE id = ?', [row.id]);
      }
    }

    const serverCompletionKeys = new Set<string>();
    for (const completion of serverCompletions) {
      if (completion.user_id !== userId) {
        continue;
      }
      const key = completionEntityId(completion.habit_id, completion.completed_on);
      serverCompletionKeys.add(key);
      if (!pendingCompletionKeys.has(key)) {
        applyServerCompletion(completion);
      }
    }
    for (const row of db.getAllSync<{ habit_id: string; completed_on: string }>(
      'SELECT habit_id, completed_on FROM habit_completions WHERE user_id = ?',
      [userId],
    )) {
      const key = completionEntityId(row.habit_id, row.completed_on);
      if (!serverCompletionKeys.has(key) && !pendingCompletionKeys.has(key)) {
        db.runSync('DELETE FROM habit_completions WHERE habit_id = ? AND completed_on = ?', [
          row.habit_id,
          row.completed_on,
        ]);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Queue status (for the "pending sync" and "sync issue" UI)
// ---------------------------------------------------------------------------

export interface SyncQueueSummary {
  /** Habit ids with at least one queued mutation (their own or a completion's). */
  pendingHabitIds: string[];
  /** True when any row gave up after repeated permanent errors. */
  hasFailures: boolean;
}

export function getSyncQueueSummary(userId: string): SyncQueueSummary {
  const rows = getLocalDb().getAllSync<
    Pick<SyncQueueRow, 'entity_type' | 'entity_id' | 'status'>
  >('SELECT entity_type, entity_id, status FROM sync_queue WHERE user_id = ?', [userId]);
  const habitIds = new Set<string>();
  let hasFailures = false;
  for (const row of rows) {
    habitIds.add(habitIdOfQueueRow(row));
    if (row.status === 'failed') {
      hasFailures = true;
    }
  }
  return { pendingHabitIds: [...habitIds].sort(), hasFailures };
}
