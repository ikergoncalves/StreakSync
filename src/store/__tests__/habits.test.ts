import * as activityApi from '../../lib/activity';
import { GroupWithMemberCount } from '../../lib/groups';
import * as habitsApi from '../../lib/habits';
import { addDays, todayLocalISO } from '../../lib/streaks';
import { Habit, HabitCompletion } from '../../types';
import { useGroupsStore } from '../groups';
import { selectHabitStreak, selectIsCompleted, useHabitsStore } from '../habits';

jest.mock('../../lib/habits', () => ({
  listHabits: jest.fn(),
  listCompletions: jest.fn(),
  createHabit: jest.fn(),
  updateHabit: jest.fn(),
  softDeleteHabit: jest.fn(),
  toggleCompletion: jest.fn(),
}));

// The activity emitter writes through this; mocked so tests can assert the
// exact events a mutation produced.
jest.mock('../../lib/activity', () => ({
  listActivityEvents: jest.fn(),
  insertActivityEvent: jest.fn(),
}));

// The groups store (read by the emitter for fan-out) is real, but its data
// layer touches the supabase client, so stub that out.
jest.mock('../../lib/groups', () => ({
  listMyGroups: jest.fn(),
  createGroup: jest.fn(),
  joinGroupByInviteCode: jest.fn(),
  listGroupMembers: jest.fn(),
  listMemberHabitData: jest.fn(),
  leaveGroup: jest.fn(),
}));

// The auth store pulls in the supabase client (which needs env config); the
// habits store only reads the signed-in user from it, so stub the module.
jest.mock('../auth', () => ({
  useAuthStore: { getState: () => ({ user: { id: 'user-1' } }) },
}));

const mockedApi = habitsApi as jest.Mocked<typeof habitsApi>;
const mockedActivityApi = activityApi as jest.Mocked<typeof activityApi>;

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
  // No groups by default: the pre-Phase-3 tests run with emission disabled.
  useGroupsStore.setState({ myGroups: [] });
  mockedActivityApi.insertActivityEvent.mockResolvedValue(undefined);
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
    expect(useHabitsStore.getState().completions['habit-1']).toEqual(['2026-06-30', '2026-07-01']);
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

describe('activity events', () => {
  const today = todayLocalISO();
  const daysAgo = (days: number) => addDays(today, -days);

  function makeGroup(id: string, memberCount: number): GroupWithMemberCount {
    return {
      id,
      name: 'Morning crew',
      invite_code: 'A7K2M9XZ',
      owner_id: 'user-1',
      created_at: '2026-07-01T00:00:00Z',
      updated_at: '2026-07-01T00:00:00Z',
      member_count: memberCount,
    };
  }

  it('emits nothing for a user in zero groups', async () => {
    useHabitsStore.setState({ habits: [makeHabit()], completions: {} });
    mockedApi.toggleCompletion.mockResolvedValue(undefined);

    await useHabitsStore.getState().toggle('habit-1');

    expect(mockedActivityApi.insertActivityEvent).not.toHaveBeenCalled();
  });

  it('emits nothing to groups where the user is the only member', async () => {
    useGroupsStore.setState({ myGroups: [makeGroup('group-solo', 1)] });
    useHabitsStore.setState({ habits: [makeHabit()], completions: {} });
    mockedApi.toggleCompletion.mockResolvedValue(undefined);

    await useHabitsStore.getState().toggle('habit-1');

    expect(mockedActivityApi.insertActivityEvent).not.toHaveBeenCalled();
  });

  it('emits streak_continued to every shared group when a toggle extends a streak', async () => {
    useGroupsStore.setState({
      myGroups: [makeGroup('group-1', 2), makeGroup('group-2', 3), makeGroup('group-solo', 1)],
    });
    useHabitsStore.setState({
      habits: [makeHabit()],
      completions: { 'habit-1': [daysAgo(1)] },
    });
    mockedApi.toggleCompletion.mockResolvedValue(undefined);

    await useHabitsStore.getState().toggle('habit-1');

    const expectedEvent = {
      type: 'streak_continued',
      payload: expect.objectContaining({ habit_id: 'habit-1', current_streak: 2 }),
    };
    expect(mockedActivityApi.insertActivityEvent).toHaveBeenCalledTimes(2);
    expect(mockedActivityApi.insertActivityEvent).toHaveBeenCalledWith({
      groupId: 'group-1',
      userId: 'user-1',
      event: expectedEvent,
    });
    expect(mockedActivityApi.insertActivityEvent).toHaveBeenCalledWith({
      groupId: 'group-2',
      userId: 'user-1',
      event: expectedEvent,
    });
  });

  it('emits streak_broken when a check-in observes a missed gap', async () => {
    useGroupsStore.setState({ myGroups: [makeGroup('group-1', 2)] });
    useHabitsStore.setState({
      habits: [makeHabit()],
      // A 3-day run that ended three days ago; yesterday and the day before
      // were missed, so today's check-in is the first to see the break.
      completions: { 'habit-1': [daysAgo(5), daysAgo(4), daysAgo(3)] },
    });
    mockedApi.toggleCompletion.mockResolvedValue(undefined);

    await useHabitsStore.getState().toggle('habit-1');

    expect(mockedActivityApi.insertActivityEvent).toHaveBeenCalledWith({
      groupId: 'group-1',
      userId: 'user-1',
      event: {
        type: 'streak_broken',
        payload: expect.objectContaining({ habit_id: 'habit-1', previous_streak: 3 }),
      },
    });
    expect(mockedActivityApi.insertActivityEvent).toHaveBeenCalledWith({
      groupId: 'group-1',
      userId: 'user-1',
      event: {
        type: 'streak_continued',
        payload: expect.objectContaining({ current_streak: 1 }),
      },
    });
  });

  it('emits nothing when a completion is unchecked', async () => {
    useGroupsStore.setState({ myGroups: [makeGroup('group-1', 2)] });
    useHabitsStore.setState({
      habits: [makeHabit()],
      completions: { 'habit-1': [today] },
    });
    mockedApi.toggleCompletion.mockResolvedValue(undefined);

    await useHabitsStore.getState().toggle('habit-1');

    expect(mockedActivityApi.insertActivityEvent).not.toHaveBeenCalled();
  });

  it('emits habit_created to shared groups when a habit is created', async () => {
    useGroupsStore.setState({ myGroups: [makeGroup('group-1', 2)] });
    const habit = makeHabit();
    mockedApi.createHabit.mockResolvedValue(habit);

    await useHabitsStore.getState().create({
      name: 'Read',
      description: null,
      icon: '📚',
      color: '#10b981',
      frequency: 'daily',
      target_days_per_week: null,
    });

    expect(mockedActivityApi.insertActivityEvent).toHaveBeenCalledWith({
      groupId: 'group-1',
      userId: 'user-1',
      event: {
        type: 'habit_created',
        payload: { habit_id: 'habit-1', habit_name: 'Read', habit_icon: '📚' },
      },
    });
  });
});
