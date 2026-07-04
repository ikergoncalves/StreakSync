import { act, renderHook } from '@testing-library/react-native';
import { AppState, AppStateStatus } from 'react-native';

import { setOnlineStatus } from '../../lib/network';
import { useSyncOnReconnect } from '../useSyncOnReconnect';

const mockSyncNow = jest.fn();

jest.mock('../../store/habits', () => ({
  useHabitsStore: (selector: (state: { syncNow: jest.Mock }) => unknown) =>
    selector({ syncNow: mockSyncNow }),
}));

type AppStateListener = (status: AppStateStatus) => void;

let appStateListener: AppStateListener | null = null;
const removeSubscription = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  appStateListener = null;
  mockSyncNow.mockResolvedValue(undefined);
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateListener = listener as AppStateListener;
    return { remove: removeSubscription } as ReturnType<typeof AppState.addEventListener>;
  });
  setOnlineStatus(true);
});

describe('useSyncOnReconnect', () => {
  it('syncs when connectivity returns, not when it drops', async () => {
    await renderHook(() => useSyncOnReconnect());

    await act(async () => setOnlineStatus(false));
    expect(mockSyncNow).not.toHaveBeenCalled();

    await act(async () => setOnlineStatus(true));
    expect(mockSyncNow).toHaveBeenCalledTimes(1);
  });

  it('syncs when the app returns to the foreground', async () => {
    await renderHook(() => useSyncOnReconnect());

    await act(async () => appStateListener!('background'));
    expect(mockSyncNow).not.toHaveBeenCalled();

    await act(async () => appStateListener!('active'));
    expect(mockSyncNow).toHaveBeenCalledTimes(1);
  });

  it('stops listening after unmount', async () => {
    const { unmount } = await renderHook(() => useSyncOnReconnect());

    await unmount();
    expect(removeSubscription).toHaveBeenCalledTimes(1);

    await act(async () => {
      setOnlineStatus(false);
      setOnlineStatus(true);
    });
    expect(mockSyncNow).not.toHaveBeenCalled();
  });
});
