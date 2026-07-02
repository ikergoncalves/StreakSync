import { isAuthError } from '@supabase/supabase-js';

const FRIENDLY_BY_CODE: Record<string, string> = {
  invalid_credentials: 'Incorrect email or password.',
  email_exists: 'This email is already registered. Try signing in instead.',
  user_already_exists: 'This email is already registered. Try signing in instead.',
  email_not_confirmed: 'Confirm your email using the link we sent you, then sign in.',
  weak_password: 'That password is too weak. Use at least 8 characters.',
  over_request_rate_limit: 'Too many attempts. Wait a moment and try again.',
  same_password: 'The new password must be different from your current one.',
};

const NETWORK_MESSAGE = 'Network error. Check your connection and try again.';
const FALLBACK_MESSAGE = 'Something went wrong. Please try again.';

/** Translate any error thrown/returned by Supabase auth into copy fit for the UI. */
export function getAuthErrorMessage(error: unknown): string {
  if (isAuthError(error)) {
    const friendly = error.code ? FRIENDLY_BY_CODE[error.code] : undefined;
    if (friendly) {
      return friendly;
    }
    // status 0 means the request never reached the server (offline, DNS, ...)
    if (error.status === 0 || /fetch|network/i.test(error.message)) {
      return NETWORK_MESSAGE;
    }
    return error.message || FALLBACK_MESSAGE;
  }
  if (error instanceof Error) {
    if (/fetch|network/i.test(error.message)) {
      return NETWORK_MESSAGE;
    }
    return error.message || FALLBACK_MESSAGE;
  }
  return FALLBACK_MESSAGE;
}
