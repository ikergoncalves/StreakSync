import { useState } from 'react';
import { Text, View } from 'react-native';

import { Button } from '../components/Button';
import { Screen } from '../components/Screen';
import { useAuthStore } from '../store/auth';

// Placeholder home screen: proves the auth flow end to end. Habit tracking
// replaces this in Phase 2.
export function HomeScreen() {
  const profile = useAuthStore((state) => state.profile);
  const user = useAuthStore((state) => state.user);
  const signOut = useAuthStore((state) => state.signOut);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setError(null);
    setSigningOut(true);
    const result = await signOut();
    setSigningOut(false);
    if (result.error) {
      setError(result.error);
    }
  };

  const greeting = profile ? `@${profile.username}` : (user?.email ?? 'there');

  return (
    <Screen>
      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-5xl">🔥</Text>
        <Text className="mt-4 text-2xl font-bold text-slate-900">Welcome, {greeting}</Text>
        <Text className="mt-2 text-center text-base text-slate-500">
          You are signed in. Habits and streaks arrive in Phase 2.
        </Text>

        {error ? <Text className="mt-4 text-sm text-red-600">{error}</Text> : null}

        <View className="mt-10 w-full">
          <Button
            title="Sign out"
            variant="secondary"
            loading={signingOut}
            onPress={() => void handleSignOut()}
            testID="sign-out-button"
          />
        </View>
      </View>
    </Screen>
  );
}
