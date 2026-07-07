import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { hasSeenOnboarding } from '../../lib/onboarding';
import { FirstRunOnboarding, ONBOARDING_SLIDES, OnboardingScreen } from '../OnboardingScreen';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

// The real onboarding lib runs against the official AsyncStorage mock, so
// these tests assert on the actual stored flag rather than on stubbed calls.
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

type ScreenProps = Parameters<typeof OnboardingScreen>[0];

const navigation = {
  goBack: jest.fn(),
  navigate: jest.fn(),
} as unknown as ScreenProps['navigation'];

const route = { key: 'Onboarding-1', name: 'Onboarding' } as ScreenProps['route'];

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe('OnboardingScreen pager', () => {
  it('renders every slide with skip available on the first one', async () => {
    await render(<FirstRunOnboarding onComplete={jest.fn()} />);

    for (const slide of ONBOARDING_SLIDES) {
      expect(screen.getByTestId(`onboarding-slide-${slide.key}`)).toBeTruthy();
      expect(screen.getByText(slide.title)).toBeTruthy();
    }
    expect(screen.getByTestId('onboarding-skip-button')).toBeTruthy();
    expect(screen.queryByTestId('onboarding-get-started-button')).toBeNull();
  });

  it('replaces Next and Skip with Get started on the last slide', async () => {
    await render(<FirstRunOnboarding onComplete={jest.fn()} />);

    for (let presses = 0; presses < ONBOARDING_SLIDES.length - 1; presses += 1) {
      await fireEvent.press(screen.getByTestId('onboarding-next-button'));
    }

    expect(screen.getByTestId('onboarding-get-started-button')).toBeTruthy();
    expect(screen.queryByTestId('onboarding-next-button')).toBeNull();
    expect(screen.queryByTestId('onboarding-skip-button')).toBeNull();
  });
});

describe('FirstRunOnboarding', () => {
  it('marks onboarding seen even when skipped on slide 1', async () => {
    const onComplete = jest.fn();
    await render(<FirstRunOnboarding onComplete={onComplete} />);

    await fireEvent.press(screen.getByTestId('onboarding-skip-button'));

    expect(onComplete).toHaveBeenCalledTimes(1);
    await waitFor(async () => {
      expect(await hasSeenOnboarding()).toBe(true);
    });
  });

  it('marks onboarding seen when finished from the last slide', async () => {
    const onComplete = jest.fn();
    await render(<FirstRunOnboarding onComplete={onComplete} />);

    for (let presses = 0; presses < ONBOARDING_SLIDES.length - 1; presses += 1) {
      await fireEvent.press(screen.getByTestId('onboarding-next-button'));
    }
    await fireEvent.press(screen.getByTestId('onboarding-get-started-button'));

    expect(onComplete).toHaveBeenCalledTimes(1);
    await waitFor(async () => {
      expect(await hasSeenOnboarding()).toBe(true);
    });
  });
});

describe('OnboardingScreen (replay route)', () => {
  it('returns to the previous screen without altering the stored seen flag', async () => {
    // Replay happens after a first run, so the flag is already set; the
    // stored value must be byte-identical before and after the replay.
    await AsyncStorage.setItem('streaksync.onboarding_seen', 'true');
    const before = await AsyncStorage.getItem('streaksync.onboarding_seen');

    await render(<OnboardingScreen navigation={navigation} route={route} />);
    await fireEvent.press(screen.getByTestId('onboarding-skip-button'));

    expect(navigation.goBack).toHaveBeenCalledTimes(1);
    expect(await AsyncStorage.getItem('streaksync.onboarding_seen')).toBe(before);
  });

  it('never writes the seen flag, even when finished via Get started', async () => {
    await render(<OnboardingScreen navigation={navigation} route={route} />);

    for (let presses = 0; presses < ONBOARDING_SLIDES.length - 1; presses += 1) {
      await fireEvent.press(screen.getByTestId('onboarding-next-button'));
    }
    await fireEvent.press(screen.getByTestId('onboarding-get-started-button'));

    expect(navigation.goBack).toHaveBeenCalledTimes(1);
    // No first run happened on this "device", and a replay must not fake one.
    expect(await AsyncStorage.getItem('streaksync.onboarding_seen')).toBeNull();
  });
});
