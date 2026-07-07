import { deleteDatabaseSync } from 'expo-sqlite';

import { buildDataExport } from '../dataExport';
import { GroupWithMemberCount } from '../groups';
import { closeLocalDb, getLocalDb, LOCAL_DB_NAME } from '../localDb';
import { localCreateHabit, localSoftDeleteHabit, localToggleCompletion } from '../localHabits';
import { Profile } from '../../types';

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => jest.requireActual<typeof import('crypto')>('crypto').randomUUID()),
}));

const INPUT = {
  name: 'Read',
  description: null,
  icon: '📚',
  color: '#10b981',
  frequency: 'daily' as const,
  target_days_per_week: null,
};

const PROFILE: Profile = {
  id: 'user-1',
  username: 'ada',
  display_name: 'Ada',
  avatar_url: null,
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
};

function makeGroup(overrides: Partial<GroupWithMemberCount> = {}): GroupWithMemberCount {
  return {
    id: 'group-1',
    name: 'Morning crew',
    invite_code: 'A7K2M9XZ',
    owner_id: 'user-1',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    member_count: 2,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  closeLocalDb();
  deleteDatabaseSync(LOCAL_DB_NAME);
});

describe('buildDataExport', () => {
  it('exports the user’s habits and completions from the local mirror', () => {
    const habit = localCreateHabit('user-1', INPUT);
    localToggleCompletion({ habitId: habit.id, userId: 'user-1', date: '2026-07-06' });
    localToggleCompletion({ habitId: habit.id, userId: 'user-1', date: '2026-07-07' });

    const data = buildDataExport('user-1', { profile: PROFILE, groups: [] });

    expect(data.profile).toEqual(PROFILE);
    expect(data.habits).toEqual([habit]);
    expect(data.completions).toEqual({ [habit.id]: ['2026-07-06', '2026-07-07'] });
    // exported_at is a real timestamp, parseable and current-ish.
    expect(Number.isNaN(Date.parse(data.exported_at))).toBe(false);
  });

  it('never includes another user’s rows, even when they exist locally', () => {
    // Defense in depth (Phase 4 RLS-leak reasoning): nothing should ever
    // write a peer's rows into the mirror, but if something did, the export
    // must still not leak them — hydrateHabitsData filters by user_id in SQL.
    const own = localCreateHabit('user-1', INPUT);
    const peerHabit = localCreateHabit('user-2', { ...INPUT, name: 'Peer secret habit' });
    localToggleCompletion({ habitId: peerHabit.id, userId: 'user-2', date: '2026-07-07' });

    const data = buildDataExport('user-1', { profile: PROFILE, groups: [] });

    expect(data.habits).toEqual([own]);
    expect(data.completions).toEqual({});
    expect(JSON.stringify(data)).not.toContain('Peer secret habit');
    expect(JSON.stringify(data)).not.toContain(peerHabit.id);
  });

  it('works on an empty local database (fresh account) without crashing', () => {
    // Opening the db lazily creates the schema; no habits were ever written.
    getLocalDb();

    const data = buildDataExport('user-1', { profile: null, groups: [] });

    expect(data).toEqual({
      exported_at: expect.any(String),
      profile: null,
      habits: [],
      completions: {},
      groups: [],
    });
  });

  it('excludes soft-deleted habits, matching what the user sees in the app', () => {
    const kept = localCreateHabit('user-1', INPUT);
    const deleted = localCreateHabit('user-1', { ...INPUT, name: 'Old habit' });
    localSoftDeleteHabit('user-1', deleted.id);

    const data = buildDataExport('user-1', { profile: PROFILE, groups: [] });

    expect(data.habits.map((habit) => habit.id)).toEqual([kept.id]);
  });

  it('reduces groups to membership metadata — never other members’ personal data', () => {
    getLocalDb();
    const owned = makeGroup({ id: 'group-owned', name: 'Owned crew', member_count: 3 });
    const joined = makeGroup({
      id: 'group-joined',
      name: 'Joined crew',
      owner_id: 'user-9',
      member_count: 2,
    });

    const data = buildDataExport('user-1', { profile: PROFILE, groups: [owned, joined] });

    expect(data.groups).toEqual([
      { name: 'Owned crew', role: 'owner', member_count: 3 },
      { name: 'Joined crew', role: 'member', member_count: 2 },
    ]);
    // Nothing beyond name/role/member_count leaves the device: no ids, no
    // invite codes (shareable secrets), no other user ids.
    const serialized = JSON.stringify(data.groups);
    expect(serialized).not.toContain('A7K2M9XZ');
    expect(serialized).not.toContain('user-9');
    expect(serialized).not.toContain('group-owned');
  });

  it('drops a cached profile that belongs to someone else', () => {
    getLocalDb();

    const data = buildDataExport('user-1', {
      profile: { ...PROFILE, id: 'user-2', username: 'peer' },
      groups: [],
    });

    expect(data.profile).toBeNull();
  });
});
