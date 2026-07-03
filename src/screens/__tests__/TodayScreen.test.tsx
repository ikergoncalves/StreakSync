import { fireEvent, render, screen } from '@testing-library/react-native';

import { addDays, todayLocalISO } from '../../lib/streaks';
import { Habit } from '../../types';
import { TodayScreen } from '../TodayScreen';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

interface MockState {
  habits: Habit[];
  completions: Record<string, string[]>;
  isLoading: boolean;
  error: string | null;
  load: jest.Mock;
  toggle: jest.Mock;
}

let mockState: MockState;

// The screen (and the useHabitStreak hook it renders) read everything through
// useHabitsStore selectors, so a plain selector-over-object stub is enough.
jest.mock('../../store/habits', () => ({
  useHabitsStore: (selector: (state: MockState) => unknown) => selector(mockState),
}));

const today = todayLocalISO();
const yesterday = addDays(today, -1);

function makeHabit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'habit-1',
    user_id: 'user-1',
    name: 'Read',
    description: null,
    icon: '📚',
    color: '#10b981',
    frequency: 'daily',
    target_days_per_week: null,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    deleted_at: null,
    ...overrides,
  };
}

type ScreenProps = Parameters<typeof TodayScreen>[0];

const navigation = {
  navigate: jest.fn(),
  goBack: jest.fn(),
} as unknown as ScreenProps['navigation'];

const route = { key: 'Today-1', name: 'Today' } as ScreenProps['route'];

function renderScreen() {
  return render(<TodayScreen navigation={navigation} route={route} />);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockState = {
    habits: [],
    completions: {},
    isLoading: false,
    error: null,
    load: jest.fn().mockResolvedValue(undefined),
    toggle: jest.fn().mockResolvedValue({ error: null }),
  };
});

describe('TodayScreen', () => {
  it('loads habits on mount', async () => {
    await renderScreen();

    expect(mockState.load).toHaveBeenCalledTimes(1);
  });

  it('renders a row per habit with its current streak', async () => {
    mockState.habits = [makeHabit(), makeHabit({ id: 'habit-2', name: 'Run', icon: '🏃' })];
    mockState.completions = { 'habit-1': [yesterday, today] };

    await renderScreen();

    expect(screen.getByText('Read')).toBeTruthy();
    expect(screen.getByText('Run')).toBeTruthy();
    expect(screen.getByText('🔥 2 day streak')).toBeTruthy();
    expect(screen.getByText('🔥 0 day streak')).toBeTruthy();
    expect(screen.queryByTestId('empty-state')).toBeNull();
  });

  it('marks the check button for habits already completed today', async () => {
    mockState.habits = [makeHabit(), makeHabit({ id: 'habit-2', name: 'Run' })];
    mockState.completions = { 'habit-1': [today] };

    await renderScreen();

    expect(screen.getByTestId('toggle-habit-1')).toBeChecked();
    expect(screen.getByTestId('toggle-habit-2')).not.toBeChecked();
  });

  it('toggles a habit through the store action', async () => {
    mockState.habits = [makeHabit()];

    await renderScreen();
    await fireEvent.press(screen.getByTestId('toggle-habit-1'));

    expect(mockState.toggle).toHaveBeenCalledWith('habit-1');
  });

  it('surfaces toggle failures', async () => {
    mockState.habits = [makeHabit()];
    mockState.toggle.mockResolvedValue({ error: 'Network error. Check your connection.' });

    await renderScreen();
    await fireEvent.press(screen.getByTestId('toggle-habit-1'));

    expect(await screen.findByText('Network error. Check your connection.')).toBeTruthy();
  });

  it('shows the empty state with a create CTA when there are no habits', async () => {
    await renderScreen();

    expect(screen.getByTestId('empty-state')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('create-first-habit-button'));
    expect(navigation.navigate).toHaveBeenCalledWith('HabitForm');
  });

  it('navigates to the form from the header add button', async () => {
    mockState.habits = [makeHabit()];

    await renderScreen();
    await fireEvent.press(screen.getByTestId('add-habit-button'));

    expect(navigation.navigate).toHaveBeenCalledWith('HabitForm');
  });

  it('opens the habit detail when a row is pressed', async () => {
    mockState.habits = [makeHabit()];

    await renderScreen();
    await fireEvent.press(screen.getByTestId('habit-row-habit-1'));

    expect(navigation.navigate).toHaveBeenCalledWith('HabitDetail', { habitId: 'habit-1' });
  });
});
