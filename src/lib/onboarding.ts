import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * "Has this device shown the intro?" flag.
 *
 * Scope decision (Phase 6): the flag is per-device/install, NOT per-account.
 * A fresh install shows the intro exactly once — even to an existing account
 * signing back in — and a second account created on the same device does not
 * see it again. That keeps the flag independent of auth state (it can be read
 * before a profile exists) and is acceptable for a short replayable intro;
 * the "Replay intro" action on the Profile screen covers anyone who wants to
 * see it again.
 */
const SEEN_KEY = 'streaksync.onboarding_seen';

export async function hasSeenOnboarding(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(SEEN_KEY)) !== null;
  } catch {
    // Fail closed: if storage is broken, marking "seen" would fail too, so
    // reporting false would replay the intro on every launch. Skipping the
    // intro once is the cheaper mistake.
    return true;
  }
}

export async function markOnboardingSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(SEEN_KEY, 'true');
  } catch {
    // Best effort — a failed write means the intro may show once more, which
    // is not worth surfacing an error to the user for.
  }
}
