// Thin client for Expo's public push API. The acting user's own device
// posts here directly for its group peers (device-to-device sends — see
// migration 0006 for why no server-side function is involved). Callers are
// expected to treat every failure as best-effort: a push that doesn't go
// out must never fail the habit mutation it rode along with.

export const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

/** Expo caps one send request at 100 messages; larger batches are chunked. */
export const MAX_MESSAGES_PER_REQUEST = 100;

export interface ExpoPushMessage {
  /** Recipient's Expo push token (ExponentPushToken[...]). */
  to: string;
  title: string;
  body: string;
  /** Arbitrary payload delivered to the receiving app. */
  data?: Record<string, unknown>;
}

/** Per-message ticket in the response, index-aligned with the request. */
export interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

export interface ExpoPushSendResult {
  tickets: ExpoPushTicket[];
  /**
   * Tokens Expo reported as DeviceNotRegistered (app uninstalled or token
   * rotated). Routine cleanup for the caller — delete them from
   * push_tokens so future sends stop paying for dead addresses.
   */
  invalidTokens: string[];
}

/**
 * Sends push messages in as few HTTP requests as possible: Expo batches
 * multiple recipients per request natively, so N messages cost
 * ceil(N / 100) requests, never N.
 */
export async function sendExpoPushMessages(
  messages: ExpoPushMessage[],
): Promise<ExpoPushSendResult> {
  const tickets: ExpoPushTicket[] = [];
  const invalidTokens: string[] = [];

  for (let start = 0; start < messages.length; start += MAX_MESSAGES_PER_REQUEST) {
    const chunk = messages.slice(start, start + MAX_MESSAGES_PER_REQUEST);
    const response = await fetch(EXPO_PUSH_ENDPOINT, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(chunk),
    });
    if (!response.ok) {
      throw new Error(`Expo push request failed with status ${response.status}`);
    }
    const payload = (await response.json()) as { data?: ExpoPushTicket[] };
    const chunkTickets = payload.data ?? [];
    chunkTickets.forEach((ticket, index) => {
      if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
        invalidTokens.push(chunk[index].to);
      }
    });
    tickets.push(...chunkTickets);
  }

  return { tickets, invalidTokens };
}
