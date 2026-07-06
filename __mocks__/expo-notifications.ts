// Jest stand-in for expo-notifications: plain jest.fn()s plus the constants
// the app reads. No real OS scheduling and no network ever happens in tests
// — reminder/permission behavior is asserted against these mocks, and tests
// that need specific permission states or scheduled lists override the
// resolved values per test.
//
// Placed in the root __mocks__ directory (adjacent to node_modules), so Jest
// substitutes it automatically wherever 'expo-notifications' is imported.

export const SchedulableTriggerInputTypes = {
  CALENDAR: 'calendar',
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  YEARLY: 'yearly',
  DATE: 'date',
  TIME_INTERVAL: 'timeInterval',
} as const;

export const AndroidImportance = {
  UNKNOWN: 0,
  UNSPECIFIED: 1,
  NONE: 2,
  MIN: 3,
  LOW: 4,
  DEFAULT: 5,
  HIGH: 6,
  MAX: 7,
} as const;

const grantedPermission = { status: 'granted', granted: true, canAskAgain: true };

export const getPermissionsAsync = jest.fn(async () => grantedPermission);
export const requestPermissionsAsync = jest.fn(async () => grantedPermission);
export const getExpoPushTokenAsync = jest.fn(async () => ({
  type: 'expo',
  data: 'ExponentPushToken[jest]',
}));
export const setNotificationHandler = jest.fn();
export const setNotificationChannelAsync = jest.fn(async () => null);
export const scheduleNotificationAsync = jest.fn(
  async (request: { identifier?: string }) => request.identifier ?? 'generated-id',
);
export const cancelScheduledNotificationAsync = jest.fn(async () => undefined);
export const getAllScheduledNotificationsAsync = jest.fn(
  async (): Promise<{ identifier: string }[]> => [],
);
