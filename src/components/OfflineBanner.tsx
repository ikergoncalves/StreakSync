import { Text, View } from 'react-native';

import { useIsOnline } from '../hooks/useIsOnline';

/**
 * Small, unobtrusive banner shown while the device is offline. Renders
 * nothing when online, so screens can mount it unconditionally.
 */
export function OfflineBanner() {
  const isOnline = useIsOnline();
  if (isOnline) {
    return null;
  }
  return (
    <View testID="offline-banner" className="mx-6 mb-3 rounded-xl bg-amber-50 px-4 py-2">
      <Text className="text-xs font-medium text-amber-800">
        You&apos;re offline — changes are saved on this device and will sync when you&apos;re back.
      </Text>
    </View>
  );
}
