import { useEffect } from 'react';
import { AppState } from 'react-native';

import { subscribeOnlineStatus } from '../lib/network';
import { useHabitsStore } from '../store/habits';

/**
 * Fires a full sync (reconcile + queue drain) whenever connectivity returns
 * or the app comes back to the foreground. Mounted once in AppNavigator.
 * Overlap is safe: the sync engine serializes passes internally, so rapid
 * online/offline flapping or a foreground event during a drain just chains
 * one more pass instead of racing.
 */
export function useSyncOnReconnect(): void {
  const syncNow = useHabitsStore((state) => state.syncNow);

  useEffect(
    () =>
      subscribeOnlineStatus((isOnline) => {
        if (isOnline) {
          void syncNow();
        }
      }),
    [syncNow],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') {
        void syncNow();
      }
    });
    return () => subscription.remove();
  }, [syncNow]);
}
