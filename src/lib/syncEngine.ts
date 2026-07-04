// Sync engine: replays the sync_queue against Supabase and reconciles the
// local SQLite mirror with the server.
//
// CONFLICT POLICY — last-write-wins by updated_at. Before a queued
// update/toggle syncs, the server row is fetched; if its updated_at is newer
// than the local mutation's base timestamp (the local write time), the server
// version wins: the local SQLite row is overwritten with it and the queued
// mutation is dropped. LIMITATION, by design: a genuine concurrent edit from
// two devices can silently lose one side's change (and an un-completion made
// elsewhere leaves no tombstone to compare against, so a queued completion
// can resurrect it). That is the industry-standard trade-off for a personal
// habit tracker where true multi-device concurrent editing is rare — a
// documented policy, not a gap papered over. Deletes always win: syncing a
// queued delete never consults the server row first.

import {
  createHabit,
  getCompletion,
  getHabit,
  HabitInput,
  listCompletions,
  listHabits,
  softDeleteHabit,
  toggleCompletion,
  updateHabit,
} from './habits';
import { deleteQueueRow, listPendingQueueRows, recordQueueAttempt, SyncQueueRow } from './localDb';
import {
  applyServerCompletion,
  applyServerHabit,
  CompletionTogglePayload,
  HabitCreatePayload,
  HabitUpdatePayload,
  habitIdOfQueueRow,
  mergeServerData,
  removeLocalHabit,
} from './localHabits';
import { UNIQUE_VIOLATION } from './postgresErrors';

/**
 * Permanent-error retry cap. Rationale: a genuinely permanent failure (an
 * RLS denial, a constraint violation, a 4xx) will never succeed, so retrying
 * forever only burns requests and hides the problem — but classification is
 * heuristic, so a handful of retries covers an error misjudged as permanent
 * during flaky conditions. Drains fire on reconnect, on foreground, and on
 * every mutation, so 5 attempts are exhausted quickly; after that the row is
 * marked 'failed', kept as evidence, and surfaced by the sync-issue banner.
 * Network errors never count toward the cap — they simply mean "offline" and
 * resolve themselves when connectivity returns.
 */
export const MAX_SYNC_ATTEMPTS = 5;

/**
 * Transient = worth retrying forever (connectivity will return); anything
 * else is treated as permanent and counts toward MAX_SYNC_ATTEMPTS. React
 * Native's fetch rejects with "Network request failed"; other stacks say
 * fetch/timeout/connection. PostgrestErrors (which carry SQLSTATE codes)
 * never match these patterns and are correctly treated as permanent.
 */
export function isTransientSyncError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === 'AbortError' || /network|fetch|timeout|connection/i.test(error.message);
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === UNIQUE_VIOLATION;
}

/** Numeric comparison — server timestamps use '+00:00' offsets, local ones 'Z'. */
function isNewer(candidate: string, base: string): boolean {
  return new Date(candidate).getTime() > new Date(base).getTime();
}

export interface DrainResult {
  /** Rows attempted this pass (skipped rows excluded). */
  processed: number;
  /** Mutations accepted by the server. */
  synced: number;
  /** Mutations dropped because the server row was newer (LWW). */
  serverWins: number;
  /** Permanent failures recorded this pass. */
  permanentFailures: number;
  /** Rows left untouched because an earlier row for the same habit failed. */
  skipped: number;
  /** True when a network error stopped the pass early (retry on reconnect). */
  abortedByNetworkError: boolean;
}

type ApplyOutcome = 'synced' | 'server-won';

/**
 * Pushes one queue row to the server, resolving conflicts per the LWW policy
 * above. Local mirror writes happen here only when the server side wins.
 */
async function applyQueueRow(row: SyncQueueRow, hasLaterRowForEntity: boolean): Promise<ApplyOutcome> {
  if (row.entity_type === 'habit') {
    switch (row.operation) {
      case 'create': {
        const { habit } = JSON.parse(row.payload) as HabitCreatePayload;
        const input: HabitInput = {
          name: habit.name,
          description: habit.description,
          icon: habit.icon,
          color: habit.color,
          frequency: habit.frequency,
          target_days_per_week: habit.target_days_per_week,
        };
        try {
          await createHabit(row.user_id, input, { id: habit.id, createdAt: habit.created_at });
        } catch (error) {
          // Replay after a crash between server insert and queue-row delete:
          // the row already exists, which is exactly the state we wanted.
          if (!isUniqueViolation(error)) {
            throw error;
          }
        }
        return 'synced';
      }
      case 'update': {
        const payload = JSON.parse(row.payload) as HabitUpdatePayload;
        const server = await getHabit(row.entity_id);
        if (!server) {
          // Hard-deleted upstream; nothing to update, mirror follows suit.
          removeLocalHabit(row.entity_id);
          return 'server-won';
        }
        if (isNewer(server.updated_at, payload.base_updated_at)) {
          // Server wins — but if a LATER queued mutation targets this habit,
          // leave the mirror alone: it reflects that newer local intent, and
          // that row will re-run this comparison itself.
          if (!hasLaterRowForEntity) {
            applyServerHabit(server);
          }
          return 'server-won';
        }
        await updateHabit(row.entity_id, payload.input);
        return 'synced';
      }
      default: {
        // 'delete': deletes always win; no LWW check (see policy above).
        await softDeleteHabit(row.entity_id);
        return 'synced';
      }
    }
  }

  // habit_completion / toggle_completion: the payload carries the desired
  // ABSOLUTE state, so replays and already-converged states are no-ops.
  const payload = JSON.parse(row.payload) as CompletionTogglePayload;
  const server = await getCompletion(payload.habit_id, payload.completed_on);
  if (payload.completed) {
    if (server) {
      // Already completed server-side (another device, or a replay); align
      // the mirror to the server row so ids/timestamps converge.
      applyServerCompletion(server);
      return 'synced';
    }
    await toggleCompletion({
      habitId: payload.habit_id,
      userId: row.user_id,
      date: payload.completed_on,
      completed: true,
      id: payload.completion_id,
    });
    return 'synced';
  }
  if (!server) {
    // Already absent server-side; nothing to delete.
    return 'synced';
  }
  if (isNewer(server.updated_at, payload.base_updated_at)) {
    // The completion was (re)written elsewhere AFTER this local uncheck:
    // server wins, resurrect it locally, drop the queued mutation.
    applyServerCompletion(server);
    return 'server-won';
  }
  await toggleCompletion({
    habitId: payload.habit_id,
    userId: row.user_id,
    date: payload.completed_on,
    completed: false,
  });
  return 'synced';
}

/**
 * One pass over the pending queue, oldest first. Failure handling:
 *
 * - Network errors abort the pass (everything after would fail the same
 *   way); the row stays pending and is retried on the next drain, forever —
 *   being offline is not a failure of the mutation.
 * - Permanent errors increment attempts; at MAX_SYNC_ATTEMPTS the row is
 *   marked 'failed' and no longer drained (the sync-issue banner surfaces
 *   it). Later rows touching the same habit are skipped for the rest of the
 *   pass so dependent mutations (a completion of a habit whose create just
 *   failed) don't burn their attempts on certain failures.
 *
 * Successful rows are deleted with a version guard: if the user collapsed
 * new state into the row while its old payload was in flight (offline
 * re-toggle racing a drain), the guarded delete misses and the row — now
 * describing the newer state — stays pending for the next pass.
 */
async function drainQueueOnce(userId: string): Promise<DrainResult> {
  const rows = listPendingQueueRows(userId);
  const result: DrainResult = {
    processed: 0,
    synced: 0,
    serverWins: 0,
    permanentFailures: 0,
    skipped: 0,
    abortedByNetworkError: false,
  };
  const blockedHabitIds = new Set<string>();
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const habitId = habitIdOfQueueRow(row);
    if (blockedHabitIds.has(habitId)) {
      result.skipped += 1;
      continue;
    }
    const hasLaterRowForEntity = rows.some(
      (candidate, candidateIndex) =>
        candidateIndex > index &&
        candidate.entity_type === row.entity_type &&
        candidate.entity_id === row.entity_id,
    );
    result.processed += 1;
    try {
      const outcome = await applyQueueRow(row, hasLaterRowForEntity);
      deleteQueueRow(row.id, row.version);
      if (outcome === 'synced') {
        result.synced += 1;
      } else {
        result.serverWins += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isTransientSyncError(error)) {
        recordQueueAttempt(row.id, row.version, message, 'pending');
        result.abortedByNetworkError = true;
        break;
      }
      const exhausted = row.attempts + 1 >= MAX_SYNC_ATTEMPTS;
      recordQueueAttempt(row.id, row.version, message, exhausted ? 'failed' : 'pending');
      blockedHabitIds.add(habitId);
      result.permanentFailures += 1;
    }
  }
  return result;
}

// Sync passes are serialized through a single promise chain — the same
// discipline as useGroupRealtime's per-topic serialization from Phase 3.
// Overlapping triggers (rapid online/offline flapping, a mutation landing
// during a reconnect drain) each get their own FULL pass, run strictly one
// after another, so a drain never races itself or a reconciliation: two
// concurrent passes would read the same pending rows and push each mutation
// twice. A pass re-reads the queue when it starts, so a chained pass also
// picks up anything enqueued while its predecessor ran.
let syncChain: Promise<unknown> = Promise.resolve();

function runExclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = syncChain.then(() => task());
  // The chain itself must never carry a rejection (it would poison every
  // later pass); callers still see failures through `run`.
  syncChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Processes queued mutations in creation order. Called on reconnect, on app
 * foreground, and fire-and-forget after every local mutation while online.
 */
export function drainSyncQueue(userId: string): Promise<DrainResult> {
  return runExclusive(() => drainQueueOnce(userId));
}

/**
 * Full reconciliation: pull the server's habits/completions, merge them into
 * SQLite (server wins, except entities with queued local mutations), then
 * drain the queue. Runs inside the same serialization as drains so a drain
 * can never interleave between the pull and the merge (which could otherwise
 * delete a just-synced row from the mirror because the pulled snapshot
 * predates it). Rejects on pull failure (e.g. offline) — callers treat that
 * as "reconcile later", never as data loss.
 */
export function reconcile(userId: string): Promise<DrainResult> {
  return runExclusive(async () => {
    const [habits, completions] = await Promise.all([
      listHabits(userId),
      listCompletions(userId),
    ]);
    mergeServerData(userId, habits, completions);
    return drainQueueOnce(userId);
  });
}
