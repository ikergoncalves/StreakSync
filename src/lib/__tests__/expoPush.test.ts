import {
  EXPO_PUSH_ENDPOINT,
  ExpoPushMessage,
  ExpoPushTicket,
  MAX_MESSAGES_PER_REQUEST,
  sendExpoPushMessages,
} from '../expoPush';

const fetchMock = jest.fn();

beforeAll(() => {
  (globalThis as { fetch: unknown }).fetch = fetchMock;
});

beforeEach(() => {
  jest.clearAllMocks();
});

function makeMessage(overrides: Partial<ExpoPushMessage> = {}): ExpoPushMessage {
  return {
    to: 'ExponentPushToken[peer-1]',
    title: 'Alice is on fire 🔥',
    body: '"Read" just hit a 5-day streak.',
    data: { type: 'streak_continued', habit_id: 'habit-1' },
    ...overrides,
  };
}

function mockPushResponse(tickets: ExpoPushTicket[]): void {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ data: tickets }),
  });
}

describe('sendExpoPushMessages', () => {
  it('batches every recipient into ONE request, not one HTTP call each', async () => {
    const messages = [
      makeMessage(),
      makeMessage({ to: 'ExponentPushToken[peer-2]' }),
      makeMessage({ to: 'ExponentPushToken[peer-3]' }),
    ];
    mockPushResponse(messages.map(() => ({ status: 'ok', id: 'ticket' })));

    const result = await sendExpoPushMessages(messages);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.tickets).toHaveLength(3);
    expect(result.invalidTokens).toEqual([]);
  });

  it('posts the exact Expo message shape as a JSON array', async () => {
    const message = makeMessage();
    mockPushResponse([{ status: 'ok' }]);

    await sendExpoPushMessages([message]);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(EXPO_PUSH_ENDPOINT);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'content-type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual([
      {
        to: 'ExponentPushToken[peer-1]',
        title: 'Alice is on fire 🔥',
        body: '"Read" just hit a 5-day streak.',
        data: { type: 'streak_continued', habit_id: 'habit-1' },
      },
    ]);
  });

  it('splits batches above the Expo per-request cap into multiple requests', async () => {
    const messages = Array.from({ length: MAX_MESSAGES_PER_REQUEST + 50 }, (_, index) =>
      makeMessage({ to: `ExponentPushToken[peer-${index}]` }),
    );
    mockPushResponse(
      Array.from({ length: MAX_MESSAGES_PER_REQUEST }, () => ({ status: 'ok' }) as ExpoPushTicket),
    );
    mockPushResponse(Array.from({ length: 50 }, () => ({ status: 'ok' }) as ExpoPushTicket));

    const result = await sendExpoPushMessages(messages);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    ) as unknown[];
    const secondBody = JSON.parse(
      (fetchMock.mock.calls[1][1] as RequestInit).body as string,
    ) as unknown[];
    expect(firstBody).toHaveLength(MAX_MESSAGES_PER_REQUEST);
    expect(secondBody).toHaveLength(50);
    expect(result.tickets).toHaveLength(MAX_MESSAGES_PER_REQUEST + 50);
  });

  it('maps DeviceNotRegistered tickets back to their tokens (index-aligned), across chunks', async () => {
    const messages = Array.from({ length: MAX_MESSAGES_PER_REQUEST + 2 }, (_, index) =>
      makeMessage({ to: `ExponentPushToken[peer-${index}]` }),
    );
    // Chunk 1: second message's device is gone; chunk 2: its LAST one is.
    mockPushResponse(
      Array.from({ length: MAX_MESSAGES_PER_REQUEST }, (_, index): ExpoPushTicket => {
        if (index === 1) {
          return { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } };
        }
        return { status: 'ok' };
      }),
    );
    mockPushResponse([
      { status: 'ok' },
      { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
    ]);

    const result = await sendExpoPushMessages(messages);

    expect(result.invalidTokens).toEqual([
      'ExponentPushToken[peer-1]',
      `ExponentPushToken[peer-${MAX_MESSAGES_PER_REQUEST + 1}]`,
    ]);
  });

  it('does not flag other ticket errors as invalid tokens', async () => {
    mockPushResponse([
      { status: 'error', message: 'rate limited', details: { error: 'MessageRateExceeded' } },
    ]);

    const result = await sendExpoPushMessages([makeMessage()]);

    expect(result.invalidTokens).toEqual([]);
    expect(result.tickets[0].status).toBe('error');
  });

  it('throws on a non-OK HTTP response', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });

    await expect(sendExpoPushMessages([makeMessage()])).rejects.toThrow('500');
  });

  it('sends no request at all for an empty message list', async () => {
    const result = await sendExpoPushMessages([]);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({ tickets: [], invalidTokens: [] });
  });
});
