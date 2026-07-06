import * as Device from 'expo-device';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { configureNotificationHandling } from '../lib/notificationSetup';
import { registerPushToken } from '../lib/pushTokens';
import { useAuthStore } from '../store/auth';

/**
 * Registers this device's Expo push token for the signed-in user: once on
 * sign-in and again on every app foreground (tokens can rotate, and a
 * permission granted later in system settings gets picked up), mirroring
 * useSyncOnReconnect. Mounted once in AppNavigator — that tree only exists
 * after sign-in with the Today tab in front, so the permission prompt fired
 * by the first registration lands there, never on the auth screens.
 *
 * Simulators are skipped entirely (Expo push tokens require a physical
 * device), and every failure — permission denied, offline token fetch, a
 * server hiccup — is swallowed: the app must work fully without push.
 */
export function useRegisterPushToken(): void {
  const userId = useAuthStore((state) => state.user?.id ?? null);

  useEffect(() => {
    // Handler + Android channel must exist even where push registration is
    // skipped (simulators still schedule local reminders).
    configureNotificationHandling();
    if (!userId || !Device.isDevice) {
      return;
    }
    void registerPushToken(userId).catch(() => undefined);

    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') {
        void registerPushToken(userId).catch(() => undefined);
      }
    });
    return () => subscription.remove();
  }, [userId]);
}
