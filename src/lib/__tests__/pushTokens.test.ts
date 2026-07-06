import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

import {
  deleteInvalidTokens,
  ensureNotificationPermission,
  listGroupPeerTokens,
  registerPushToken,
} from '../pushTokens';
import { supabase } from '../supabase';

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'uuid-1'),
}));

// Mutable factory object: individual tests flip isDevice to simulate running
// on a simulator. __esModule makes the wildcard import share this exact
// object instead of an interop copy, so those flips are visible to the lib.
jest.mock('expo-device', () => ({ __esModule: true, isDevice: true, deviceName: 'Pixel Test' }));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { eas: { projectId: 'project-1' } } },
    easConfig: null,
  },
}));

jest.mock('../supabase', () => ({
  supabase: { from: jest.fn() },
}));

// expo-notifications comes from the root __mocks__ automatic mock; grab the
// typed handles so tests can steer permission outcomes.
const mockedGetPermissions = Notifications.getPermissionsAsync as jest.Mock;
const mockedRequestPermissions = Notifications.requestPermissionsAsync as jest.Mock;
const mockedGetToken = Notifications.getExpoPushTokenAsync as jest.Mock;
const mockedFrom = supabase.from as jest.Mock;
const mutableDevice = Device as { isDevice: boolean };

function permission(granted: boolean, canAskAgain = true) {
  return { granted, canAskAgain, status: granted ? 'granted' : 'denied' };
}

beforeEach(() => {
  jest.clearAllMocks();
  mutableDevice.isDevice = true;
  mockedGetPermissions.mockResolvedValue(permission(true));
  mockedRequestPermissions.mockResolvedValue(permission(true));
  mockedGetToken.mockResolvedValue({ type: 'expo', data: 'ExponentPushToken[device-1]' });
});

describe('ensureNotificationPermission', () => {
  it('does not re-prompt when permission is already granted', async () => {
    await expect(ensureNotificationPermission()).resolves.toBe(true);
    expect(mockedRequestPermissions).not.toHaveBeenCalled();
  });

  it('prompts once when undetermined and reports the granted result', async () => {
    mockedGetPermissions.mockResolvedValue(permission(false));

    await expect(ensureNotificationPermission()).resolves.toBe(true);
    expect(mockedRequestPermissions).toHaveBeenCalledTimes(1);
  });

  it('never nags once the OS says it cannot ask again', async () => {
    mockedGetPermissions.mockResolvedValue(permission(false, false));

    await expect(ensureNotificationPermission()).resolves.toBe(false);
    expect(mockedRequestPermissions).not.toHaveBeenCalled();
  });
});

describe('registerPushToken', () => {
  it('upserts the token on its unique column for the signed-in user', async () => {
    const upsert = jest.fn().mockResolvedValue({ error: null });
    mockedFrom.mockReturnValue({ upsert });

    await expect(registerPushToken('user-1')).resolves.toBe('ExponentPushToken[device-1]');

    expect(mockedGetToken).toHaveBeenCalledWith({ projectId: 'project-1' });
    expect(mockedFrom).toHaveBeenCalledWith('push_tokens');
    expect(upsert).toHaveBeenCalledWith(
      {
        id: 'uuid-1',
        user_id: 'user-1',
        token: 'ExponentPushToken[device-1]',
        device_name: 'Pixel Test',
      },
      { onConflict: 'token' },
    );
  });

  it('is a graceful no-op on a simulator: no permission prompt, no token, no crash', async () => {
    mutableDevice.isDevice = false;

    await expect(registerPushToken('user-1')).resolves.toBeNull();

    expect(mockedGetPermissions).not.toHaveBeenCalled();
    expect(mockedGetToken).not.toHaveBeenCalled();
    expect(mockedFrom).not.toHaveBeenCalled();
  });

  it('returns null without fetching or storing anything when permission is denied', async () => {
    mockedGetPermissions.mockResolvedValue(permission(false));
    mockedRequestPermissions.mockResolvedValue(permission(false));

    await expect(registerPushToken('user-1')).resolves.toBeNull();

    expect(mockedGetToken).not.toHaveBeenCalled();
    expect(mockedFrom).not.toHaveBeenCalled();
  });

  it('propagates a storage failure so callers can treat it as best-effort', async () => {
    mockedFrom.mockReturnValue({
      upsert: jest.fn().mockResolvedValue({ error: { code: '42501', message: 'denied' } }),
    });

    await expect(registerPushToken('user-1')).rejects.toEqual(
      expect.objectContaining({ code: '42501' }),
    );
  });
});

describe('listGroupPeerTokens', () => {
  function mockPeerQueries(peerIds: string[], tokens: string[]) {
    const neq = jest.fn().mockResolvedValue({
      data: peerIds.map((user_id) => ({ user_id })),
      error: null,
    });
    const membersEq = jest.fn(() => ({ neq }));
    const membersSelect = jest.fn(() => ({ eq: membersEq }));

    const tokensIn = jest.fn().mockResolvedValue({
      data: tokens.map((token) => ({ token })),
      error: null,
    });
    const tokensSelect = jest.fn(() => ({ in: tokensIn }));

    mockedFrom.mockImplementation((table: string) =>
      table === 'group_members' ? { select: membersSelect } : { select: tokensSelect },
    );
    return { membersSelect, membersEq, neq, tokensSelect, tokensIn };
  }

  it('returns the tokens of every member EXCEPT the acting user', async () => {
    const queries = mockPeerQueries(['user-2', 'user-3'], ['tok-2', 'tok-3']);

    await expect(listGroupPeerTokens('user-1', 'group-1')).resolves.toEqual(['tok-2', 'tok-3']);

    expect(queries.membersEq).toHaveBeenCalledWith('group_id', 'group-1');
    expect(queries.neq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(queries.tokensIn).toHaveBeenCalledWith('user_id', ['user-2', 'user-3']);
  });

  it('skips the token query entirely for a group with no other members', async () => {
    const queries = mockPeerQueries([], []);

    await expect(listGroupPeerTokens('user-1', 'group-solo')).resolves.toEqual([]);

    expect(queries.tokensSelect).not.toHaveBeenCalled();
  });
});

describe('deleteInvalidTokens', () => {
  it('deletes the reported tokens', async () => {
    const inFilter = jest.fn().mockResolvedValue({ error: null });
    mockedFrom.mockReturnValue({ delete: jest.fn(() => ({ in: inFilter })) });

    await deleteInvalidTokens(['tok-dead-1', 'tok-dead-2']);

    expect(mockedFrom).toHaveBeenCalledWith('push_tokens');
    expect(inFilter).toHaveBeenCalledWith('token', ['tok-dead-1', 'tok-dead-2']);
  });

  it('makes no request at all for an empty list', async () => {
    await deleteInvalidTokens([]);

    expect(mockedFrom).not.toHaveBeenCalled();
  });
});
