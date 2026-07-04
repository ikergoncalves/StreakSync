import { listCompletions, listHabits } from '../habits';
import { supabase } from '../supabase';

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'uuid-1'),
}));

jest.mock('../supabase', () => ({
  supabase: { from: jest.fn() },
}));

const mockedFrom = supabase.from as jest.Mock;

interface QueryResult {
  data: unknown;
  error: unknown;
}

interface QueryMock extends PromiseLike<QueryResult> {
  select: jest.Mock;
  eq: jest.Mock;
  is: jest.Mock;
  gte: jest.Mock;
  lte: jest.Mock;
  order: jest.Mock;
}

/** Chainable, awaitable stand-in for a postgrest query builder. */
function makeQuery(result: QueryResult): QueryMock {
  const query = {
    then: (onfulfilled?: (value: QueryResult) => unknown) =>
      Promise.resolve(result).then(onfulfilled),
  } as unknown as QueryMock;
  query.select = jest.fn(() => query);
  query.eq = jest.fn(() => query);
  query.is = jest.fn(() => query);
  query.gte = jest.fn(() => query);
  query.lte = jest.fn(() => query);
  query.order = jest.fn(() => query);
  return query;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('listHabits', () => {
  // The user_id filter is the fix for the Today-screen leak: habits RLS
  // deliberately exposes group peers' rows, so the query must scope itself.
  it('filters by the given user id explicitly, not via RLS alone', async () => {
    const rows = [{ id: 'habit-1', user_id: 'user-1' }];
    const query = makeQuery({ data: rows, error: null });
    mockedFrom.mockReturnValue(query);

    const habits = await listHabits('user-1');

    expect(mockedFrom).toHaveBeenCalledWith('habits');
    expect(query.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(query.is).toHaveBeenCalledWith('deleted_at', null);
    expect(habits).toEqual(rows);
  });

  it('throws the query error', async () => {
    mockedFrom.mockReturnValue(makeQuery({ data: null, error: new Error('boom') }));

    await expect(listHabits('user-1')).rejects.toThrow('boom');
  });
});

describe('listCompletions', () => {
  it('filters by the given user id explicitly, not via RLS alone', async () => {
    const rows = [{ id: 'completion-1', user_id: 'user-1' }];
    const query = makeQuery({ data: rows, error: null });
    mockedFrom.mockReturnValue(query);

    const completions = await listCompletions('user-1');

    expect(mockedFrom).toHaveBeenCalledWith('habit_completions');
    expect(query.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(completions).toEqual(rows);
  });

  it('applies the optional date bounds on top of the user filter', async () => {
    const query = makeQuery({ data: [], error: null });
    mockedFrom.mockReturnValue(query);

    await listCompletions('user-1', { from: '2026-06-01', to: '2026-06-30' });

    expect(query.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(query.gte).toHaveBeenCalledWith('completed_on', '2026-06-01');
    expect(query.lte).toHaveBeenCalledWith('completed_on', '2026-06-30');
  });
});
