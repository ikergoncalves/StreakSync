import * as Notifications from 'expo-notifications';

let configured = false;

/**
 * One-time process-wide notification plumbing, safe to call from any mount
 * point (subsequent calls are no-ops):
 *
 * - the foreground handler, so reminders and social pushes arriving while
 *   the app is open still show as banners instead of vanishing silently;
 * - the Android notification channel (required on Android 8+ for anything
 *   to display; a no-op on iOS, so no platform branch is needed).
 *
 * Deliberately does NOT touch permissions — prompting is owned by
 * registerPushToken so it happens at a sensible moment after sign-in.
 */
export function configureNotificationHandling(): void {
  if (configured) {
    return;
  }
  configured = true;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });

  void Notifications.setNotificationChannelAsync('default', {
    name: 'Default',
    importance: Notifications.AndroidImportance.DEFAULT,
  }).catch(() => undefined);
}
