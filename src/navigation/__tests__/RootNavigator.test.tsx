import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Session } from '@supabase/supabase-js';

import { RootNavigator } from '../RootNavigator';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// The navigators are heavyweight (they pull in every screen); markers are
// enough to assert which branch of the gate rendered. The first-run intro
// stays real — that's the flow under test.
jest.mock('../AppNavigator', () => {
  const { Text } = jest.requireActual('react-native');
  return { AppNavigator: () => <Text testID="app-navigator" /> };
});
jest.mock('../AuthNavigator', () => {
  const { Text } = jest.requireActual('react-native');
  return { AuthNavigator: () => <Text testID="auth-navigator" /> };
});

interface MockAuthState {
  session: Session | null;
  isLoading: boolean;
}

let mockAuthState: MockAuthState;

jest.mock('../../store/auth', () => ({
  useAuthStore: (selector: (state: MockAuthState) => unknown) => selector(mockAuthState),
}));

function makeSession(userId: string): Session {
  return { user: { id: userId } } as Session;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockAuthState = { session: null, isLoading: false };
});

describe('RootNavigator onboarding gate', () => {
  it('shows the auth stack while signed out', async () => {
    await render(<RootNavigator />);

    expect(screen.getByTestId('auth-navigator')).toBeTruthy();
    expect(screen.queryByTestId('app-navigator')).toBeNull();
  });

  it('shows the intro before the app stack on a first-run session', async () => {
    mockAuthState.session = makeSession('user-1');

    await render(<RootNavigator />);

    expect(await screen.findByTestId('onboarding-skip-button')).toBeTruthy();
    expect(screen.queryByTestId('app-navigator')).toBeNull();
  });

  it('enters the app and persists the seen flag when the intro is dismissed', async () => {
    mockAuthState.session = makeSession('user-1');

    await render(<RootNavigator />);
    await fireEvent.press(await screen.findByTestId('onboarding-skip-button'));

    expect(await screen.findByTestId('app-navigator')).toBeTruthy();
    await waitFor(async () => {
      expect(await AsyncStorage.getItem('streaksync.onboarding_seen')).toBe('true');
    });
  });

  it('never auto-shows the intro once the device flag is set', async () => {
    await AsyncStorage.setItem('streaksync.onboarding_seen', 'true');
    mockAuthState.session = makeSession('user-1');

    await render(<RootNavigator />);

    expect(await screen.findByTestId('app-navigator')).toBeTruthy();
    expect(screen.queryByTestId('onboarding-skip-button')).toBeNull();
  });

  it('skips the intro for a second sign-up on the same device (device-scoped by design)', async () => {
    // First account's run marked the device as seen.
    await AsyncStorage.setItem('streaksync.onboarding_seen', 'true');
    mockAuthState.session = makeSession('user-1');
    const { rerender } = await render(<RootNavigator />);
    expect(await screen.findByTestId('app-navigator')).toBeTruthy();

    // Sign out…
    mockAuthState.session = null;
    await rerender(<RootNavigator />);
    expect(screen.getByTestId('auth-navigator')).toBeTruthy();

    // …and sign up a brand-new account on the same device: no intro.
    mockAuthState.session = makeSession('user-2');
    await rerender(<RootNavigator />);
    expect(await screen.findByTestId('app-navigator')).toBeTruthy();
    expect(screen.queryByTestId('onboarding-skip-button')).toBeNull();
  });
});
