import NetInfo from '@react-native-community/netinfo';
import { useEffect, useSyncExternalStore } from 'react';

import { getIsOnline, setOnlineStatus, subscribeOnlineStatus } from '../lib/network';

/**
 * Pipes NetInfo connectivity events into lib/network's observable. Mount it
 * once, high in the signed-in tree (AppNavigator); every consumer then reads
 * the shared value through useIsOnline or lib/network directly.
 */
export function useNetworkStatusMonitor(): void {
  useEffect(
    () =>
      // NetInfo invokes the listener immediately with the current state, so
      // this also seeds the initial value.
      NetInfo.addEventListener((state) => {
        // isInternetReachable is tri-state; only an explicit false (connected
        // to a network that verifiably can't reach the internet) forces
        // offline while isConnected is true.
        setOnlineStatus(state.isConnected === true && state.isInternetReachable !== false);
      }),
    [],
  );
}

/** Current connectivity, re-rendering on transitions. */
export function useIsOnline(): boolean {
  return useSyncExternalStore(subscribeOnlineStatus, getIsOnline);
}
