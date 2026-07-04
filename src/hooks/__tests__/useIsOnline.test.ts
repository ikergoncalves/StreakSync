import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { act, renderHook } from '@testing-library/react-native';

import { getIsOnline, setOnlineStatus } from '../../lib/network';
import { useIsOnline, useNetworkStatusMonitor } from '../useIsOnline';

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn() },
}));

const mockedAddEventListener = NetInfo.addEventListener as jest.Mock;

type NetInfoListener = (state: NetInfoState) => void;

function makeState(
  isConnected: boolean | null,
  isInternetReachable: boolean | null,
): NetInfoState {
  return { isConnected, isInternetReachable } as NetInfoState;
}

let netInfoListener: NetInfoListener | null = null;
const unsubscribe = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  netInfoListener = null;
  mockedAddEventListener.mockImplementation((listener: NetInfoListener) => {
    netInfoListener = listener;
    return unsubscribe;
  });
  setOnlineStatus(true);
});

describe('useNetworkStatusMonitor + useIsOnline', () => {
  it('pipes NetInfo transitions into the shared flag and re-renders consumers', async () => {
    const { result } = await renderHook(() => {
      useNetworkStatusMonitor();
      return useIsOnline();
    });

    expect(result.current).toBe(true);

    await act(async () => netInfoListener!(makeState(false, false)));
    expect(result.current).toBe(false);
    expect(getIsOnline()).toBe(false);

    await act(async () => netInfoListener!(makeState(true, true)));
    expect(result.current).toBe(true);
    expect(getIsOnline()).toBe(true);
  });

  it('treats a connection that verifiably cannot reach the internet as offline', async () => {
    const { result } = await renderHook(() => {
      useNetworkStatusMonitor();
      return useIsOnline();
    });

    await act(async () => netInfoListener!(makeState(true, false)));
    expect(result.current).toBe(false);
  });

  it('stays online while reachability is still undetermined (tri-state null)', async () => {
    const { result } = await renderHook(() => {
      useNetworkStatusMonitor();
      return useIsOnline();
    });

    await act(async () => netInfoListener!(makeState(true, null)));
    expect(result.current).toBe(true);
  });

  it('unsubscribes from NetInfo on unmount', async () => {
    const { unmount } = await renderHook(() => useNetworkStatusMonitor());

    await unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
