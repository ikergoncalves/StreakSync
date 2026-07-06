import { act, renderHook } from '@testing-library/react-native';
import * as Device from 'expo-device';
import { AppState, AppStateStatus } from 'react-native';

import { registerPushToken } from '../../lib/pushTokens';
import { useRegisterPushToken } from '../useRegisterPushToken';

// __esModule so the hook's wildcard import shares this exact object and the
// per-test isDevice flips are visible to it.
jest.mock('expo-device', () => ({ __esModule: true, isDevice: true, deviceName: 'Pixel Test' }));

jest.mock('../../lib/pushTokens', () => ({
  registerPushToken: jest.fn(),
}));

const mockConfigure = jest.fn();
jest.mock('../../lib/notificationSetup', () => ({
  configureNotificationHandling: () => mockConfigure(),
}));

let mockUser: { id: string } | null = { id: 'user-1' };
jest.mock('../../store/auth', () => ({
  useAuthStore: (selector: (state: { user: { id: string } | null }) => unknown) =>
    selector({ user: mockUser }),
}));

const mockedRegister = registerPushToken as jest.Mock;
const mutableDevice = Device as { isDevice: boolean };

type AppStateListener = (status: AppStateStatus) => void;

let appStateListener: AppStateListener | null = null;
const removeSubscription = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  appStateListener = null;
  mockUser = { id: 'user-1' };
  mutableDevice.isDevice = true;
  mockedRegister.mockResolvedValue('ExponentPushToken[device-1]');
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateListener = listener as AppStateListener;
    return { remove: removeSubscription } as ReturnType<typeof AppState.addEventListener>;
  });
});

describe('useRegisterPushToken', () => {
  it('registers the token once on mount for the signed-in user', async () => {
    await renderHook(() => useRegisterPushToken());

    expect(mockConfigure).toHaveBeenCalled();
    expect(mockedRegister).toHaveBeenCalledTimes(1);
    expect(mockedRegister).toHaveBeenCalledWith('user-1');
  });

  it('re-registers when the app returns to the foreground, not on backgrounding', async () => {
    await renderHook(() => useRegisterPushToken());
    mockedRegister.mockClear();

    await act(async () => appStateListener!('background'));
    expect(mockedRegister).not.toHaveBeenCalled();

    await act(async () => appStateListener!('active'));
    expect(mockedRegister).toHaveBeenCalledTimes(1);
  });

  it('skips registration entirely on a simulator but still configures handling (local reminders need it)', async () => {
    mutableDevice.isDevice = false;

    await renderHook(() => useRegisterPushToken());

    expect(mockConfigure).toHaveBeenCalled();
    expect(mockedRegister).not.toHaveBeenCalled();
    expect(AppState.addEventListener).not.toHaveBeenCalled();
  });

  it('does nothing while signed out', async () => {
    mockUser = null;

    await renderHook(() => useRegisterPushToken());

    expect(mockedRegister).not.toHaveBeenCalled();
  });

  it('survives a registration failure silently — push is best-effort', async () => {
    mockedRegister.mockRejectedValue(new Error('permission denied'));

    await renderHook(() => useRegisterPushToken());
    await act(async () => {});

    // No unhandled rejection, and the foreground path keeps retrying.
    await act(async () => appStateListener!('active'));
    expect(mockedRegister).toHaveBeenCalledTimes(2);
  });

  it('stops listening after unmount', async () => {
    const { unmount } = await renderHook(() => useRegisterPushToken());

    await unmount();
    expect(removeSubscription).toHaveBeenCalledTimes(1);
  });
});
