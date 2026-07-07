import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { AppNavigator } from './AppNavigator';
import { AuthNavigator } from './AuthNavigator';
import { hasSeenOnboarding } from '../lib/onboarding';
import { ACCENT } from '../lib/theme';
import { FirstRunOnboarding } from '../screens/OnboardingScreen';
import { useAuthStore } from '../store/auth';

function LaunchSpinner() {
  return (
    <View className="flex-1 items-center justify-center bg-slate-50 dark:bg-slate-950">
      <ActivityIndicator size="large" color={ACCENT} />
    </View>
  );
}

export function RootNavigator() {
  const session = useAuthStore((state) => state.session);
  const isLoading = useAuthStore((state) => state.isLoading);
  // null = flag not read yet for the current session. Checked once each time
  // a session begins (first sign-up, sign-in on a fresh install, restored
  // launch) — the flag is device-scoped, so after any first run it reads
  // "seen" and the intro never auto-shows again (see src/lib/onboarding.ts).
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);
  const hasSession = session !== null;

  // Reset the answer whenever the session comes or goes, so each new session
  // re-reads the flag instead of reusing the previous session's answer
  // (render-time state adjustment, per the React docs, instead of a
  // setState-in-effect).
  const [prevHasSession, setPrevHasSession] = useState(hasSession);
  if (prevHasSession !== hasSession) {
    setPrevHasSession(hasSession);
    setShowOnboarding(null);
  }

  useEffect(() => {
    if (!hasSession) {
      return;
    }
    let cancelled = false;
    void hasSeenOnboarding().then((seen) => {
      if (!cancelled) {
        setShowOnboarding(!seen);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [hasSession]);

  if (isLoading) {
    // Shown briefly on launch while the persisted session is restored.
    return <LaunchSpinner />;
  }

  if (!hasSession) {
    return <AuthNavigator />;
  }

  if (showOnboarding === null) {
    // Session exists but the seen flag is still being read (one fast
    // AsyncStorage hit) — keep the launch spinner rather than flashing the
    // app and then covering it with the intro.
    return <LaunchSpinner />;
  }

  if (showOnboarding) {
    return <FirstRunOnboarding onComplete={() => setShowOnboarding(false)} />;
  }

  return <AppNavigator />;
}
