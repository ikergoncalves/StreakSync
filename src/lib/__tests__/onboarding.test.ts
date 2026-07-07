import AsyncStorage from '@react-native-async-storage/async-storage';

import { hasSeenOnboarding, markOnboardingSeen } from '../onboarding';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const mockedGetItem = AsyncStorage.getItem as jest.Mock;
const mockedSetItem = AsyncStorage.setItem as jest.Mock;

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe('hasSeenOnboarding', () => {
  it('reports false on a fresh install', async () => {
    await expect(hasSeenOnboarding()).resolves.toBe(false);
  });

  it('reports true after markOnboardingSeen', async () => {
    await markOnboardingSeen();

    await expect(hasSeenOnboarding()).resolves.toBe(true);
  });

  it('stays true across repeated reads — the flag is device-scoped, not per-account', async () => {
    // By design (see the module doc) there is no user id in the key: after
    // any account marks the intro seen on this device, a later sign-out and
    // second sign-up reads the same flag and never re-shows the intro.
    await markOnboardingSeen();

    await expect(hasSeenOnboarding()).resolves.toBe(true);
    await expect(hasSeenOnboarding()).resolves.toBe(true);
    expect(mockedSetItem).toHaveBeenCalledTimes(1);
  });

  it('fails closed (true) when storage reads throw, so the intro never loops', async () => {
    mockedGetItem.mockRejectedValueOnce(new Error('disk full'));

    await expect(hasSeenOnboarding()).resolves.toBe(true);
  });
});

describe('markOnboardingSeen', () => {
  it('is idempotent', async () => {
    await markOnboardingSeen();
    await markOnboardingSeen();

    await expect(hasSeenOnboarding()).resolves.toBe(true);
  });

  it('swallows storage write failures instead of surfacing them', async () => {
    mockedSetItem.mockRejectedValueOnce(new Error('disk full'));

    await expect(markOnboardingSeen()).resolves.toBeUndefined();
  });
});
