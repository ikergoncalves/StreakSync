import { insertActivityEvent } from '../activity';
import { supabase } from '../supabase';
import { ActivityEventData } from '../../types';

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'uuid-1'),
}));

jest.mock('../supabase', () => ({
  supabase: { from: jest.fn() },
}));

const mockedFrom = supabase.from as jest.Mock;

const event: ActivityEventData = {
  type: 'streak_continued',
  payload: {
    habit_id: 'habit-1',
    habit_name: 'Read',
    habit_icon: '📚',
    frequency: 'daily',
    current_streak: 2,
    event_date: '2026-07-04',
  },
};

function mockInsert(result: { error: unknown }): jest.Mock {
  const insert = jest.fn().mockResolvedValue(result);
  mockedFrom.mockReturnValue({ insert });
  return insert;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('insertActivityEvent', () => {
  it('inserts the event row with a client-generated id', async () => {
    const insert = mockInsert({ error: null });

    await insertActivityEvent({ groupId: 'group-1', userId: 'user-1', event });

    expect(mockedFrom).toHaveBeenCalledWith('activity_events');
    expect(insert).toHaveBeenCalledWith({
      id: 'uuid-1',
      group_id: 'group-1',
      user_id: 'user-1',
      type: 'streak_continued',
      payload: event.payload,
    });
  });

  it('treats a unique violation as an already-recorded event, not an error', async () => {
    // Migration 0005's partial unique indexes reject duplicates of the same
    // logical event; the wrapper must swallow that, mirroring
    // toggleCompletion's idiom.
    mockInsert({ error: { code: '23505', message: 'duplicate key value' } });

    await expect(
      insertActivityEvent({ groupId: 'group-1', userId: 'user-1', event }),
    ).resolves.toBeUndefined();
  });

  it('still throws every other error', async () => {
    mockInsert({ error: { code: '42501', message: 'permission denied' } });

    await expect(
      insertActivityEvent({ groupId: 'group-1', userId: 'user-1', event }),
    ).rejects.toEqual(expect.objectContaining({ code: '42501' }));
  });
});
