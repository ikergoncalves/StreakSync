import * as habitsApi from '../../lib/habits';
import { Habit, HabitCompletion } from '../../types';
import { selectHabitStreak, selectIsCompleted, useHabitsStore } from '../habits';

jest.mock('../../lib/habits', () => ({
  listHabits: jest.fn(),
  listCompletions: jest.fn(),
  createHabit: jest.fn(),
  updateHabit: jest.fn(),
  softDeleteHabit: jest.fn(),
  toggleCompletion: jest.fn(),
}));

// The auth store pulls in the supabase client (which needs env config); the
// habits store only reads the signed-in user from it, so stub the module.
jest.mock('../auth', () => ({
  useAuthStore: { getState: () => ({ user: { id: 'user-1' } }) },
}));

const mockedApi = habitsApi as jest.Mocked<typeof habitsApi>;

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

function makeCompletion(overrides: Partial<HabitCompletion> = {}): HabitCompletion {
  return {
    id: 'completion-1',
    habit_id: 'habit-1',
    user_id: 'user-1',
    completed_on: '2026-07-02',
    created_at: '2026-07-02T12:00:00Z',
    updated_at: '2026-07-02T12:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  useHabitsStore.setState({ habits: [], completions: {}, isLoading: false, error: null });
});

describe('load', () => {
  it('populates habits and groups completions by habit', async () => {
    const habits = [makeHabit(), makeHabit({ id: 'habit-2', name: 'Run' })];
    mockedApi.listHabits.mockResolvedValue(habits);
    mockedApi.listCompletions.mockResolvedValue([
      makeCompletion({ completed_on: '2026-07-01' }),
      makeCompletion({ id: 'completion-2', completed_on: '2026-07-02' }),
      makeCompletion({ id: 'completion-3', habit_id: 'habit-2', completed_on: '2026-07-02' }),
    ]);

    await useHabitsStore.getState().load();

    const state = useHabitsStore.getState();
    expect(state.habits).toEqual(habits);
    expect(state.completions).toEqual({
      'habit-1': ['2026-07-01', '2026-07-02'],
      'habit-2': ['2026-07-02'],
    });
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('records an error message when loading fails', async () => {
    mockedApi.listHabits.mockRejectedValue(new Error('Network request failed'));
    mockedApi.listCompletions.mockResolvedValue([]);

    await useHabitsStore.getState().load();

    const state = useHabitsStore.getState();
    expect(state.error).toMatch(/connection/i);
    expect(state.isLoading).toBe(false);
  });
});

describe('create', () => {
  it('appends the created habit and passes the signed-in user id', async () => {
    const habit = makeHabit();
    mockedApi.createHabit.mockResolvedValue(habit);
    const input = {
      name: 'Read',
      description: null,
      icon: '📚',
      color: '#10b981',
      frequency: 'daily' as const,
      target_days_per_week: null,
    };

    const result = await useHabitsStore.getState().create(input);

    expect(result.error).toBeNull();
    expect(mockedApi.createHabit).toHaveBeenCalledWith('user-1', input);
    expect(useHabitsStore.getState().habits).toEqual([habit]);
  });

  it('returns an error and leaves state unchanged on failure', async () => {
    mockedApi.createHabit.mockRejectedValue(new Error('Network request failed'));

    const result = await useHabitsStore.getState().create({
      name: 'Read',
      description: null,
      icon: null,
      color: null,
      frequency: 'daily',
      target_days_per_week: null,
    });

    expect(result.error).toMatch(/connection/i);
    expect(useHabitsStore.getState().habits).toEqual([]);
  });
});

describe('update', () => {
  it('replaces the habit in place', async () => {
    useHabitsStore.setState({ habits: [makeHabit(), makeHabit({ id: 'habit-2' })] });
    const renamed = makeHabit({ name: 'Read books' });
    mockedApi.updateHabit.mockResolvedValue(renamed);

    const result = await useHabitsStore.getState().update('habit-1', { name: 'Read books' });

    expect(result.error).toBeNull();
    expect(useHabitsStore.getState().habits[0]).toEqual(renamed);
    expect(useHabitsStore.getState().habits[1].id).toBe('habit-2');
  });
});

describe('remove', () => {
  it('drops the habit and its completions after a soft delete', async () => {
    useHabitsStore.setState({
      habits: [makeHabit(), makeHabit({ id: 'habit-2' })],
      completions: { 'habit-1': ['2026-07-02'], 'habit-2': ['2026-07-01'] },
    });
    mockedApi.softDeleteHabit.mockResolvedValue(undefined);

    const result = await useHabitsStore.getState().remove('habit-1');

    expect(result.error).toBeNull();
    expect(mockedApi.softDeleteHabit).toHaveBeenCalledWith('habit-1');
    const state = useHabitsStore.getState();
    expect(state.habits.map((habit) => habit.id)).toEqual(['habit-2']);
    expect(state.completions).toEqual({ 'habit-2': ['2026-07-01'] });
  });

  it('keeps the habit when the soft delete fails', async () => {
    useHabitsStore.setState({ habits: [makeHabit()] });
    mockedApi.softDeleteHabit.mockRejectedValue(new Error('Network request failed'));

    const result = await useHabitsStore.getState().remove('habit-1');

    expect(result.error).toMatch(/connection/i);
    expect(useHabitsStore.getState().habits).toHaveLength(1);
  });
});

describe('toggle', () => {
  it('applies the completion optimistically before the API resolves', async () => {
    useHabitsStore.setState({ habits: [makeHabit()] });
    let resolveApi: () => void = () => {};
    mockedApi.toggleCompletion.mockImplementation(
      () => new Promise((resolve) => (resolveApi = resolve)),
    );

    const pending = useHabitsStore.getState().toggle('habit-1', '2026-07-03');

    // The store reflects the completion immediately, before the API call ends.
    expect(selectIsCompleted(useHabitsStore.getState(), 'habit-1', '2026-07-03')).toBe(true);

    resolveApi();
    expect((await pending).error).toBeNull();
    expect(mockedApi.toggleCompletion).toHaveBeenCalledWith({
      habitId: 'habit-1',
      userId: 'user-1',
      date: '2026-07-03',
      completed: true,
    });
  });

  it('rolls the completion back when the API call fails', async () => {
    useHabitsStore.setState({
      habits: [makeHabit()],
      completions: { 'habit-1': ['2026-07-02'] },
    });
    mockedApi.toggleCompletion.mockRejectedValue(new Error('Network request failed'));

    const result = await useHabitsStore.getState().toggle('habit-1', '2026-07-03');

    expect(result.error).toMatch(/connection/i);
    expect(useHabitsStore.getState().completions['habit-1']).toEqual(['2026-07-02']);
  });

  it('removes an existing completion and keeps dates sorted when re-adding', async () => {
    useHabitsStore.setState({
      habits: [makeHabit()],
      completions: { 'habit-1': ['2026-07-01', '2026-07-02'] },
    });
    mockedApi.toggleCompletion.mockResolvedValue(undefined);

    await useHabitsStore.getState().toggle('habit-1', '2026-07-02');
    expect(useHabitsStore.getState().completions['habit-1']).toEqual(['2026-07-01']);
    expect(mockedApi.toggleCompletion).toHaveBeenLastCalledWith(
      expect.objectContaining({ completed: false }),
    );

    await useHabitsStore.getState().toggle('habit-1', '2026-06-30');
    expect(useHabitsStore.getState().completions['habit-1']).toEqual([
      '2026-06-30',
      '2026-07-01',
    ]);
  });

  it('fails without touching state when the habit is unknown', async () => {
    const result = await useHabitsStore.getState().toggle('missing', '2026-07-03');

    expect(result.error).toBeTruthy();
    expect(mockedApi.toggleCompletion).not.toHaveBeenCalled();
  });
});

describe('selectHabitStreak', () => {
  it('derives the current and longest streak for a daily habit', () => {
    const state = {
      habits: [makeHabit()],
      completions: { 'habit-1': ['2026-07-01', '2026-07-02', '2026-07-03'] },
    };

    expect(selectHabitStreak(state, 'habit-1', '2026-07-03')).toEqual({
      current: 3,
      longest: 3,
    });
  });

  it('uses the weekly calculation for weekly habits', () => {
    const state = {
      habits: [makeHabit({ frequency: 'weekly', target_days_per_week: 2 })],
      completions: { 'habit-1': ['2026-06-29', '2026-07-01'] },
    };

    expect(selectHabitStreak(state, 'habit-1', '2026-07-03')).toEqual({
      current: 1,
      longest: 1,
    });
  });

  it('returns zeros for an unknown habit', () => {
    expect(selectHabitStreak({ habits: [], completions: {} }, 'missing')).toEqual({
      current: 0,
      longest: 0,
    });
  });
});
