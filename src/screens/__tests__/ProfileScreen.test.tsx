import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, AlertButton } from 'react-native';

import { listBlockingGroups } from '../../lib/accountDeletion';
import { buildDataExport } from '../../lib/dataExport';
import { GroupWithMemberCount } from '../../lib/groups';
import { Profile } from '../../types';
import { ProfileScreen } from '../ProfileScreen';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// The share sheet and the temp file are OS surfaces; capture what the screen
// hands them instead of exercising them.
const mockShareAsync = jest.fn().mockResolvedValue(undefined);
jest.mock('expo-sharing', () => ({
  shareAsync: (...args: unknown[]) => mockShareAsync(...args),
}));

const mockFileWrite = jest.fn();
const mockFileCreate = jest.fn();
jest.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///cache/' } },
  File: jest.fn().mockImplementation((_dir: unknown, name: string) => ({
    uri: `file:///cache/${name}`,
    create: mockFileCreate,
    write: mockFileWrite,
  })),
}));

// Export building and the blocking-groups query have their own lib suites;
// the screen tests only wire-up and gating.
jest.mock('../../lib/dataExport', () => ({
  buildDataExport: jest.fn(),
}));
jest.mock('../../lib/accountDeletion', () => ({
  listBlockingGroups: jest.fn(),
}));

// Connectivity is faked per test: deletion is refused offline, export is not.
let mockIsOnline = true;
jest.mock('../../lib/network', () => ({
  getIsOnline: () => mockIsOnline,
}));

interface MockAuthState {
  profile: Profile | null;
  user: { id: string; email: string } | null;
  signOut: jest.Mock;
  deleteAccount: jest.Mock;
}

let mockAuthState: MockAuthState;

jest.mock('../../store/auth', () => ({
  useAuthStore: (selector: (state: MockAuthState) => unknown) => selector(mockAuthState),
}));

let mockGroupsState: { myGroups: GroupWithMemberCount[] };

jest.mock('../../store/groups', () => ({
  useGroupsStore: (selector: (state: { myGroups: GroupWithMemberCount[] }) => unknown) =>
    selector(mockGroupsState),
}));

const mockedBuildDataExport = buildDataExport as jest.Mock;
const mockedListBlockingGroups = listBlockingGroups as jest.Mock;

function makeGroup(overrides: Partial<GroupWithMemberCount> = {}): GroupWithMemberCount {
  return {
    id: 'group-1',
    name: 'Morning crew',
    invite_code: 'A7K2M9XZ',
    owner_id: 'user-1',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    member_count: 2,
    ...overrides,
  };
}

type ScreenProps = Parameters<typeof ProfileScreen>[0];

const navigation = {
  navigate: jest.fn(),
  goBack: jest.fn(),
} as unknown as ScreenProps['navigation'];

const route = { key: 'Profile-1', name: 'Profile' } as ScreenProps['route'];

function renderScreen() {
  return render(<ProfileScreen navigation={navigation} route={route} />);
}

/** Presses a button on the most recent Alert (the confirm/cancel dialogs).
 * Async so the state updates the press kicks off settle inside act. */
async function pressAlertButton(alertSpy: jest.SpyInstance, label: string) {
  const call = alertSpy.mock.calls[alertSpy.mock.calls.length - 1];
  const button = ((call[2] ?? []) as AlertButton[]).find((candidate) => candidate.text === label);
  expect(button).toBeTruthy();
  await act(async () => {
    button?.onPress?.();
  });
}

let alertSpy: jest.SpyInstance;

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockIsOnline = true;
  mockAuthState = {
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
    deleteAccount: jest.fn().mockResolvedValue({ error: null }),
  };
  mockGroupsState = { myGroups: [] };
  mockedListBlockingGroups.mockResolvedValue([]);
  mockedBuildDataExport.mockReturnValue({
    exported_at: '2026-07-07T12:00:00.000Z',
    profile: mockAuthState.profile,
    habits: [],
    completions: {},
    groups: [],
  });
});

afterEach(() => {
  alertSpy.mockRestore();
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

    expect(mockAuthState.signOut).toHaveBeenCalledTimes(1);
  });

  it('surfaces sign-out failures', async () => {
    mockAuthState.signOut.mockResolvedValue({ error: 'Network error. Check your connection.' });

    await renderScreen();
    await fireEvent.press(screen.getByTestId('sign-out-button'));

    expect(await screen.findByText('Network error. Check your connection.')).toBeTruthy();
  });
});

describe('Export my data', () => {
  it('builds the export from cached data and hands a .json temp file to the share sheet', async () => {
    mockGroupsState = { myGroups: [makeGroup()] };

    await renderScreen();
    await fireEvent.press(screen.getByTestId('export-data-button'));

    await waitFor(() => expect(mockShareAsync).toHaveBeenCalledTimes(1));
    expect(mockedBuildDataExport).toHaveBeenCalledWith('user-1', {
      profile: mockAuthState.profile,
      groups: mockGroupsState.myGroups,
    });
    // The JSON lands in a temp file that is then shared — nothing else.
    expect(mockFileWrite).toHaveBeenCalledTimes(1);
    const written = mockFileWrite.mock.calls[0][0] as string;
    expect(JSON.parse(written)).toEqual(mockedBuildDataExport.mock.results[0].value);
    const [uri, options] = mockShareAsync.mock.calls[0] as [string, { mimeType: string }];
    expect(uri).toMatch(/^file:\/\/\/cache\/streaksync-export-.*\.json$/);
    expect(options.mimeType).toBe('application/json');
  });

  it('works fully offline — no connectivity gate on the export path', async () => {
    mockIsOnline = false;

    await renderScreen();
    await fireEvent.press(screen.getByTestId('export-data-button'));

    await waitFor(() => expect(mockShareAsync).toHaveBeenCalledTimes(1));
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('surfaces an export failure instead of crashing', async () => {
    mockFileWrite.mockImplementationOnce(() => {
      throw new Error('disk full');
    });

    await renderScreen();
    await fireEvent.press(screen.getByTestId('export-data-button'));

    expect(await screen.findByText(/could not build the export/i)).toBeTruthy();
    expect(mockShareAsync).not.toHaveBeenCalled();
  });
});

describe('Delete my account', () => {
  it('refuses offline with a clear message, before any check or RPC', async () => {
    mockIsOnline = false;

    await renderScreen();
    await fireEvent.press(screen.getByTestId('delete-account-button'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy.mock.calls[0][0]).toBe("You're offline");
    expect(mockedListBlockingGroups).not.toHaveBeenCalled();
    expect(mockAuthState.deleteAccount).not.toHaveBeenCalled();
  });

  it('blocks a sole owner of shared groups, naming them, and never proceeds', async () => {
    mockedListBlockingGroups.mockResolvedValue([
      makeGroup({ name: 'Morning crew' }),
      makeGroup({ id: 'group-2', name: 'Book club' }),
    ]);

    await renderScreen();
    await fireEvent.press(screen.getByTestId('delete-account-button'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(mockedListBlockingGroups).toHaveBeenCalledWith('user-1');
    const [title, message] = alertSpy.mock.calls[0] as [string, string];
    expect(title).toBe('Resolve your groups first');
    expect(message).toContain('"Morning crew"');
    expect(message).toContain('"Book club"');
    expect(mockAuthState.deleteAccount).not.toHaveBeenCalled();
  });

  it('asks for an explicit destructive confirmation before deleting', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByTestId('delete-account-button'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    const [title, message] = alertSpy.mock.calls[0] as [string, string];
    expect(title).toBe('Delete account');
    expect(message).toMatch(/cannot be undone/i);
    expect(mockAuthState.deleteAccount).not.toHaveBeenCalled();

    await pressAlertButton(alertSpy, 'Delete');

    expect(mockAuthState.deleteAccount).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the confirmation is cancelled', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByTestId('delete-account-button'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    await pressAlertButton(alertSpy, 'Cancel');

    expect(mockAuthState.deleteAccount).not.toHaveBeenCalled();
  });

  it('surfaces a deletion failure returned by the store', async () => {
    mockAuthState.deleteAccount.mockResolvedValue({
      error: 'Network error. Check your connection and try again.',
    });

    await renderScreen();
    await fireEvent.press(screen.getByTestId('delete-account-button'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    await pressAlertButton(alertSpy, 'Delete');

    expect(
      await screen.findByText('Network error. Check your connection and try again.'),
    ).toBeTruthy();
  });

  it('surfaces a failed blocking-groups check without opening the confirmation', async () => {
    mockedListBlockingGroups.mockRejectedValue(new Error('Network request failed'));

    await renderScreen();
    await fireEvent.press(screen.getByTestId('delete-account-button'));

    expect(await screen.findByText(/could not check your groups/i)).toBeTruthy();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockAuthState.deleteAccount).not.toHaveBeenCalled();
  });
});
