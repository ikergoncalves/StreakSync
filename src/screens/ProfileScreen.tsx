import { useState } from 'react';
import { Text, View } from 'react-native';

import { Button } from '../components/Button';
import { Screen } from '../components/Screen';
import { useAuthStore } from '../store/auth';

export function ProfileScreen() {
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

  const displayName = profile?.display_name ?? user?.email ?? 'there';

  return (
    <Screen edges={['top']}>
      <View className="px-6 pb-4 pt-2">
        <Text className="text-3xl font-bold text-slate-900">Profile</Text>
      </View>

      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-5xl">🔥</Text>
        <Text className="mt-4 text-2xl font-bold text-slate-900">{displayName}</Text>
        {profile ? <Text className="mt-1 text-base text-slate-500">@{profile.username}</Text> : null}
        <Text className="mt-2 text-center text-base text-slate-500">
          Groups and shared streaks arrive in Phase 3.
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
