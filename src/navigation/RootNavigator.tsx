import { ActivityIndicator, View } from 'react-native';

import { AppNavigator } from './AppNavigator';
import { AuthNavigator } from './AuthNavigator';
import { useAuthStore } from '../store/auth';

export function RootNavigator() {
  const session = useAuthStore((state) => state.session);
  const isLoading = useAuthStore((state) => state.isLoading);

  if (isLoading) {
    // Shown briefly on launch while the persisted session is restored.
    return (
      <View className="flex-1 items-center justify-center bg-slate-50">
        <ActivityIndicator size="large" color="#059669" />
      </View>
    );
  }

  return session ? <AppNavigator /> : <AuthNavigator />;
}
