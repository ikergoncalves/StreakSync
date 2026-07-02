import { Session, User } from '@supabase/supabase-js';
import { create } from 'zustand';

import { getAuthErrorMessage } from '../lib/authErrors';
import { supabase } from '../lib/supabase';
import { Profile } from '../types';

interface AuthResult {
  error: string | null;
}

interface SignUpResult extends AuthResult {
  /** True when Supabase requires the user to confirm their email before signing in. */
  needsEmailConfirmation: boolean;
}

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  /** True until the persisted session has been restored on app launch. */
  isLoading: boolean;
  initialize: () => Promise<void>;
  signUp: (input: { username: string; email: string; password: string }) => Promise<SignUpResult>;
  signIn: (input: { email: string; password: string }) => Promise<AuthResult>;
  signOut: () => Promise<AuthResult>;
  resetPassword: (email: string) => Promise<AuthResult>;
}

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
  if (error) {
    return null;
  }
  return data as Profile;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  user: null,
  profile: null,
  isLoading: true,

  initialize: async () => {
    // Restore the session persisted by the supabase client (if any).
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    set({
      session,
      user: session?.user ?? null,
      profile: session ? await fetchProfile(session.user.id) : null,
      isLoading: false,
    });

    // Keep the store in sync with token refreshes and sign-outs. The callback
    // must stay synchronous (supabase-js warns against awaiting inside it);
    // profile loading happens in the sign-in/sign-up actions instead.
    supabase.auth.onAuthStateChange((_event, nextSession) => {
      set((state) => ({
        session: nextSession,
        user: nextSession?.user ?? null,
        profile: nextSession ? state.profile : null,
      }));
    });
  },

  signUp: async ({ username, email, password }) => {
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        // Consumed by the handle_new_user trigger to create the profile row.
        options: { data: { username } },
      });
      if (error) {
        return { error: getAuthErrorMessage(error), needsEmailConfirmation: false };
      }
      if (data.session && data.user) {
        set({
          session: data.session,
          user: data.user,
          profile: await fetchProfile(data.user.id),
        });
        return { error: null, needsEmailConfirmation: false };
      }
      // No session: the project requires email confirmation before sign-in.
      return { error: null, needsEmailConfirmation: true };
    } catch (error) {
      return { error: getAuthErrorMessage(error), needsEmailConfirmation: false };
    }
  },

  signIn: async ({ email, password }) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        return { error: getAuthErrorMessage(error) };
      }
      set({
        session: data.session,
        user: data.user,
        profile: await fetchProfile(data.user.id),
      });
      return { error: null };
    } catch (error) {
      return { error: getAuthErrorMessage(error) };
    }
  },

  signOut: async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        return { error: getAuthErrorMessage(error) };
      }
      set({ session: null, user: null, profile: null });
      return { error: null };
    } catch (error) {
      return { error: getAuthErrorMessage(error) };
    }
  },

  resetPassword: async (email) => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
      if (error) {
        return { error: getAuthErrorMessage(error) };
      }
      return { error: null };
    } catch (error) {
      return { error: getAuthErrorMessage(error) };
    }
  },
}));
