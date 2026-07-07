import {
  deleteOwnAccount,
  listBlockingGroups,
  SOLE_OWNER_BLOCKED_CODE,
  SoleOwnerDeletionError,
} from '../accountDeletion';
import { GroupWithMemberCount, listGroupMembers, listMyGroups } from '../groups';
import { supabase } from '../supabase';
import { GroupMember } from '../../types';

// The group queries themselves are covered by the groups lib tests; here we
// steer their results to exercise the blocking rule (which reuses the real
// isSoleOwner from membership.ts, deliberately unmocked).
jest.mock('../groups', () => ({
  listMyGroups: jest.fn(),
  listGroupMembers: jest.fn(),
}));

jest.mock('../supabase', () => ({
  supabase: { rpc: jest.fn() },
}));

const mockedListMyGroups = listMyGroups as jest.Mock;
const mockedListGroupMembers = listGroupMembers as jest.Mock;
const mockedRpc = supabase.rpc as jest.Mock;

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

function makeMember(userId: string, role: GroupMember['role']): GroupMember {
  return {
    group_id: 'group-1',
    user_id: userId,
    role,
    joined_at: '2026-07-01T00:00:00Z',
    profile: {
      id: userId,
      username: userId,
      display_name: userId,
      avatar_url: null,
      created_at: '2026-06-01T00:00:00Z',
      updated_at: '2026-06-01T00:00:00Z',
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('listBlockingGroups', () => {
  it('blocks a sole owner of a group that still has other members', async () => {
    const shared = makeGroup({ id: 'group-1', name: 'Morning crew', member_count: 2 });
    mockedListMyGroups.mockResolvedValue([shared]);
    mockedListGroupMembers.mockResolvedValue([
      makeMember('user-1', 'owner'),
      makeMember('user-2', 'member'),
    ]);

    await expect(listBlockingGroups('user-1')).resolves.toEqual([shared]);
  });

  it('does not block a sole owner of a SOLO group (only member is themselves)', async () => {
    mockedListMyGroups.mockResolvedValue([makeGroup({ member_count: 1 })]);

    await expect(listBlockingGroups('user-1')).resolves.toEqual([]);
    // Solo groups are filtered out by member_count before any member query.
    expect(mockedListGroupMembers).not.toHaveBeenCalled();
  });

  it('does not block a regular member of every shared group', async () => {
    mockedListMyGroups.mockResolvedValue([
      makeGroup({ id: 'group-1', owner_id: 'user-9', member_count: 3 }),
    ]);
    mockedListGroupMembers.mockResolvedValue([
      makeMember('user-9', 'owner'),
      makeMember('user-1', 'member'),
      makeMember('user-2', 'member'),
    ]);

    await expect(listBlockingGroups('user-1')).resolves.toEqual([]);
  });

  it('does not block when another owner shares the group', async () => {
    mockedListMyGroups.mockResolvedValue([makeGroup({ member_count: 2 })]);
    mockedListGroupMembers.mockResolvedValue([
      makeMember('user-1', 'owner'),
      makeMember('user-2', 'owner'),
    ]);

    await expect(listBlockingGroups('user-1')).resolves.toEqual([]);
  });

  it('never blocks a user in zero groups', async () => {
    mockedListMyGroups.mockResolvedValue([]);

    await expect(listBlockingGroups('user-1')).resolves.toEqual([]);
    expect(mockedListGroupMembers).not.toHaveBeenCalled();
  });

  it('returns only the blocking groups out of a mixed membership', async () => {
    const blocking = makeGroup({ id: 'group-owned', name: 'Owned & shared', member_count: 2 });
    const memberOnly = makeGroup({
      id: 'group-member',
      name: 'Just a member',
      owner_id: 'user-9',
      member_count: 4,
    });
    const solo = makeGroup({ id: 'group-solo', name: 'Solo notes', member_count: 1 });
    mockedListMyGroups.mockResolvedValue([blocking, memberOnly, solo]);
    mockedListGroupMembers.mockImplementation((groupId: string) =>
      Promise.resolve(
        groupId === 'group-owned'
          ? [makeMember('user-1', 'owner'), makeMember('user-2', 'member')]
          : [makeMember('user-9', 'owner'), makeMember('user-1', 'member')],
      ),
    );

    await expect(listBlockingGroups('user-1')).resolves.toEqual([blocking]);
  });
});

describe('deleteOwnAccount', () => {
  it('calls the parameterless RPC — there is nothing to target another user with', async () => {
    mockedRpc.mockResolvedValue({ data: null, error: null });

    await expect(deleteOwnAccount()).resolves.toBeUndefined();
    expect(mockedRpc).toHaveBeenCalledTimes(1);
    expect(mockedRpc).toHaveBeenCalledWith('delete_own_account');
  });

  it('maps the sole-owner SQLSTATE to SoleOwnerDeletionError with the server message', async () => {
    mockedRpc.mockResolvedValue({
      data: null,
      error: {
        code: SOLE_OWNER_BLOCKED_CODE,
        message: 'You are the only owner of shared groups that still have other members: "Crew".',
      },
    });

    await expect(deleteOwnAccount()).rejects.toThrow(SoleOwnerDeletionError);
    await expect(deleteOwnAccount()).rejects.toThrow(/only owner.*"Crew"/);
  });

  it('rethrows every other failure as a plain error, not the blocking kind', async () => {
    mockedRpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'unexpected server error' },
    });

    const failure = await deleteOwnAccount().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(SoleOwnerDeletionError);
    expect((failure as Error).message).toBe('unexpected server error');
  });
});
