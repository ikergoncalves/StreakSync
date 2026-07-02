import { AuthError } from '@supabase/supabase-js';

import { getAuthErrorMessage } from '../authErrors';

describe('getAuthErrorMessage', () => {
  it('maps invalid credentials to a friendly message', () => {
    const error = new AuthError('Invalid login credentials', 400, 'invalid_credentials');
    expect(getAuthErrorMessage(error)).toBe('Incorrect email or password.');
  });

  it('maps duplicate email registration to a friendly message', () => {
    const error = new AuthError('User already registered', 422, 'user_already_exists');
    expect(getAuthErrorMessage(error)).toMatch(/already registered/i);
  });

  it('detects network failures', () => {
    expect(getAuthErrorMessage(new Error('Network request failed'))).toMatch(/connection/i);
  });

  it('falls back to the auth error message for unmapped codes', () => {
    const error = new AuthError('Signups not allowed for this instance', 400, 'signup_disabled');
    expect(getAuthErrorMessage(error)).toBe('Signups not allowed for this instance');
  });

  it('falls back to a generic message for unknown values', () => {
    expect(getAuthErrorMessage(undefined)).toBe('Something went wrong. Please try again.');
  });
});
