// Personal data export (Phase 8). Pure formatting over data that is already
// on the device: habits and completions come from the local SQLite mirror
// (the app's source of truth), profile and group metadata from what the
// stores have cached. No network calls happen here, so the export works
// fully offline — consistent with the offline-first philosophy. The trade-off
// is documented in the shape itself: group metadata reflects the LAST SYNC,
// not a guaranteed-fresh server pull, which is acceptable for a personal
// data export that must not depend on connectivity.

import { GroupWithMemberCount } from './groups';
import { hydrateHabitsData } from './localHabits';
import { GroupRole, Habit, Profile } from '../types';

/** Group-membership metadata only — names and the user's own role. Other
 * members' personal data (profiles, habits, streaks) is deliberately never
 * exported, even though the leaderboard caches it: the same defense-in-depth
 * rule as the Phase 4 RLS-leak fix (never persist or emit peers' rows). */
export interface DataExportGroup {
  name: string;
  role: GroupRole;
  member_count: number;
}

export interface DataExport {
  /** ISO timestamp of when the export was built (on-device clock). */
  exported_at: string;
  /** Null when the profile hasn't been cached yet (e.g. exported right after
   * an offline app start); habits and completions are still complete. */
  profile: Profile | null;
  habits: Habit[];
  /** Ascending YYYY-MM-DD completion dates keyed by habit id. */
  completions: Record<string, string[]>;
  /** Cached group memberships as of the last sync (may be stale offline). */
  groups: DataExportGroup[];
}

/** Everything the export needs beyond the local database, supplied by the
 * caller from the auth/groups stores so this module stays store-free. */
export interface DataExportCache {
  profile: Profile | null;
  groups: GroupWithMemberCount[];
}

/**
 * Builds the signed-in user's personal data export. Habits and completions
 * are read from the local SQLite mirror via hydrateHabitsData, which filters
 * by user_id in SQL — a peer's rows can never appear even if something else
 * ever wrote them locally. The role is derived from owner_id: the app has no
 * ownership transfer, so the group creator is exactly the owner-role holder.
 */
export function buildDataExport(userId: string, cache: DataExportCache): DataExport {
  const { habits, completions } = hydrateHabitsData(userId);
  return {
    exported_at: new Date().toISOString(),
    profile: cache.profile && cache.profile.id === userId ? cache.profile : null,
    habits,
    completions,
    groups: cache.groups.map((group) => ({
      name: group.name,
      role: group.owner_id === userId ? 'owner' : 'member',
      member_count: group.member_count,
    })),
  };
}
