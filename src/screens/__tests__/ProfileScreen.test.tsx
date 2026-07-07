import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { Profile } from '../../types';
import { ProfileScreen } from '../ProfileScreen';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

interface MockState {
  profile: Profile | null;
  user: { id: string; email: string } | null;
  signOut: jest.Mock;
}

let mockState: MockState;

jest.mock('../../store/auth', () => ({
  useAuthStore: (selector: (state: MockState) => unknown) => selector(mockState),
}));

type ScreenProps = Parameters<typeof ProfileScreen>[0];

const navigation = {
  navigate: jest.fn(),
  goBack: jest.fn(),
} as unknown as ScreenProps['navigation'];

const route = { key: 'Profile-1', name: 'Profile' } as ScreenProps['route'];

function renderScreen() {
  return render(<ProfileScreen navigation={navigation} route={route} />);
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockState = {
    profile: {
      id: 'user-1',
      username: 'ada',
      display_name: 'Ada',
      avatar_url: null,
      created_at: '2026-06-01T00:00:00Z',
      updated_at: '2026-06-01T00:00:00Z',
    },
    user: { id: 'user-1', email: 'ada@example.com' },
    signOut: jest.fn().mockResolvedValue({ error: null }),
  };
});

describe('ProfileScreen', () => {
  it('shows the profile identity', async () => {
    await renderScreen();

    expect(screen.getByText('Ada')).toBeTruthy();
    expect(screen.getByText('@ada')).toBeTruthy();
  });

  it('navigates to the onboarding replay from "Replay intro"', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByTestId('replay-intro-button'));

    expect(navigation.navigate).toHaveBeenCalledWith('Onboarding');
  });

  it('leaves the stored onboarding seen flag byte-identical across a replay', async () => {
    await AsyncStorage.setItem('streaksync.onboarding_seen', 'true');
    const before = await AsyncStorage.getItem('streaksync.onboarding_seen');

    await renderScreen();
    await fireEvent.press(screen.getByTestId('replay-intro-button'));

    expect(await AsyncStorage.getItem('streaksync.onboarding_seen')).toBe(before);
  });

  it('signs out through the store action', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByTestId('sign-out-button'));

    expect(mockState.signOut).toHaveBeenCalledTimes(1);
  });

  it('surfaces sign-out failures', async () => {
    mockState.signOut.mockResolvedValue({ error: 'Network error. Check your connection.' });

    await renderScreen();
    await fireEvent.press(screen.getByTestId('sign-out-button'));

    expect(await screen.findByText('Network error. Check your connection.')).toBeTruthy();
  });
});
