import { AuthError, Session, User } from '@supabase/supabase-js';

import { supabase } from '../../lib/supabase';
import { Profile } from '../../types';
import { useAuthStore } from '../auth';

const mockSingle = jest.fn();

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      onAuthStateChange: jest.fn(() => ({
        data: { subscription: { unsubscribe: jest.fn() } },
      })),
      signUp: jest.fn(),
      signInWithPassword: jest.fn(),
      signOut: jest.fn(),
      resetPasswordForEmail: jest.fn(),
    },
    from: jest.fn(() => ({
      select: () => ({ eq: () => ({ single: mockSingle }) }),
    })),
  },
}));

const fakeUser = { id: 'user-1', email: 'user@example.com' } as User;
const fakeSession = { user: fakeUser, access_token: 'token' } as Session;
const fakeProfile: Profile = {
  id: 'user-1',
  username: 'streak_fan',
  display_name: 'streak_fan',
  avatar_url: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({ session: null, user: null, profile: null, isLoading: true });
});

describe('initialize', () => {
  it('restores a persisted session and loads the profile', async () => {
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({
      data: { session: fakeSession },
      error: null,
    });
    mockSingle.mockResolvedValue({ data: fakeProfile, error: null });

    await useAuthStore.getState().initialize();

    const state = useAuthStore.getState();
    expect(state.session).toBe(fakeSession);
    expect(state.user).toBe(fakeUser);
    expect(state.profile).toEqual(fakeProfile);
    expect(state.isLoading).toBe(false);
  });

  it('finishes without a session when none is persisted', async () => {
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({
      data: { session: null },
      error: null,
    });

    await useAuthStore.getState().initialize();

    const state = useAuthStore.getState();
    expect(state.session).toBeNull();
    expect(state.user).toBeNull();
    expect(state.isLoading).toBe(false);
  });

  it('clears user data when the auth state changes to signed out', async () => {
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({
      data: { session: fakeSession },
      error: null,
    });
    mockSingle.mockResolvedValue({ data: fakeProfile, error: null });
    let listener: ((event: string, session: Session | null) => void) | undefined;
    (supabase.auth.onAuthStateChange as jest.Mock).mockImplementation((callback) => {
      listener = callback;
      return { data: { subscription: { unsubscribe: jest.fn() } } };
    });

    await useAuthStore.getState().initialize();
    expect(useAuthStore.getState().session).toBe(fakeSession);

    listener?.('SIGNED_OUT', null);

    const state = useAuthStore.getState();
    expect(state.session).toBeNull();
    expect(state.user).toBeNull();
    expect(state.profile).toBeNull();
  });
});

describe('signIn', () => {
  it('stores session, user, and profile on success', async () => {
    (supabase.auth.signInWithPassword as jest.Mock).mockResolvedValue({
      data: { session: fakeSession, user: fakeUser },
      error: null,
    });
    mockSingle.mockResolvedValue({ data: fakeProfile, error: null });

    const result = await useAuthStore
      .getState()
      .signIn({ email: ' user@example.com ', password: 'secret123' });

    expect(result.error).toBeNull();
    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'user@example.com',
      password: 'secret123',
    });
    const state = useAuthStore.getState();
    expect(state.session).toBe(fakeSession);
    expect(state.profile).toEqual(fakeProfile);
  });

  it('returns a friendly message for invalid credentials', async () => {
    (supabase.auth.signInWithPassword as jest.Mock).mockResolvedValue({
      data: { session: null, user: null },
      error: new AuthError('Invalid login credentials', 400, 'invalid_credentials'),
    });

    const result = await useAuthStore
      .getState()
      .signIn({ email: 'user@example.com', password: 'wrong-password' });

    expect(result.error).toBe('Incorrect email or password.');
    expect(useAuthStore.getState().session).toBeNull();
  });

  it('returns a network message when the request throws', async () => {
    (supabase.auth.signInWithPassword as jest.Mock).mockRejectedValue(
      new Error('Network request failed'),
    );

    const result = await useAuthStore
      .getState()
      .signIn({ email: 'user@example.com', password: 'secret123' });

    expect(result.error).toMatch(/connection/i);
    expect(useAuthStore.getState().session).toBeNull();
  });
});

describe('signUp', () => {
  it('passes the username along as auth metadata', async () => {
    (supabase.auth.signUp as jest.Mock).mockResolvedValue({
      data: { session: fakeSession, user: fakeUser },
      error: null,
    });
    mockSingle.mockResolvedValue({ data: fakeProfile, error: null });

    const result = await useAuthStore
      .getState()
      .signUp({ username: 'streak_fan', email: 'user@example.com', password: 'secret123' });

    expect(result.error).toBeNull();
    expect(result.needsEmailConfirmation).toBe(false);
    expect(supabase.auth.signUp).toHaveBeenCalledWith({
      email: 'user@example.com',
      password: 'secret123',
      options: { data: { username: 'streak_fan' } },
    });
    expect(useAuthStore.getState().session).toBe(fakeSession);
  });

  it('flags when email confirmation is required', async () => {
    (supabase.auth.signUp as jest.Mock).mockResolvedValue({
      data: { session: null, user: fakeUser },
      error: null,
    });

    const result = await useAuthStore
      .getState()
      .signUp({ username: 'streak_fan', email: 'user@example.com', password: 'secret123' });

    expect(result.error).toBeNull();
    expect(result.needsEmailConfirmation).toBe(true);
    expect(useAuthStore.getState().session).toBeNull();
  });

  it('returns a friendly message when the email is already registered', async () => {
    (supabase.auth.signUp as jest.Mock).mockResolvedValue({
      data: { session: null, user: null },
      error: new AuthError('User already registered', 422, 'user_already_exists'),
    });

    const result = await useAuthStore
      .getState()
      .signUp({ username: 'streak_fan', email: 'user@example.com', password: 'secret123' });

    expect(result.error).toMatch(/already registered/i);
  });
});

describe('signOut', () => {
  it('clears the store on success', async () => {
    useAuthStore.setState({
      session: fakeSession,
      user: fakeUser,
      profile: fakeProfile,
      isLoading: false,
    });
    (supabase.auth.signOut as jest.Mock).mockResolvedValue({ error: null });

    const result = await useAuthStore.getState().signOut();

    expect(result.error).toBeNull();
    const state = useAuthStore.getState();
    expect(state.session).toBeNull();
    expect(state.user).toBeNull();
    expect(state.profile).toBeNull();
  });

  it('keeps the session when supabase returns an error', async () => {
    useAuthStore.setState({
      session: fakeSession,
      user: fakeUser,
      profile: fakeProfile,
      isLoading: false,
    });
    (supabase.auth.signOut as jest.Mock).mockResolvedValue({
      error: new AuthError('Request failed', 0),
    });

    const result = await useAuthStore.getState().signOut();

    expect(result.error).toMatch(/connection/i);
    expect(useAuthStore.getState().session).toBe(fakeSession);
  });
});

describe('resetPassword', () => {
  it('sends the reset email', async () => {
    (supabase.auth.resetPasswordForEmail as jest.Mock).mockResolvedValue({
      data: {},
      error: null,
    });

    const result = await useAuthStore.getState().resetPassword(' user@example.com ');

    expect(result.error).toBeNull();
    expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith('user@example.com');
  });
});
