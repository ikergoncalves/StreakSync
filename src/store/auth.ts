import { Session, User } from '@supabase/supabase-js';
import { create } from 'zustand';

// Circular at module level with habits/groups (they read useAuthStore), but
// every cross-store access on both sides happens inside actions at call time,
// never during module evaluation, so the cycle is harmless.
import { useGroupsStore } from './groups';
import { resetPublishedActivityEvents, useHabitsStore } from './habits';
import { deleteOwnAccount, SoleOwnerDeletionError } from '../lib/accountDeletion';
import { getAuthErrorMessage } from '../lib/authErrors';
import { reconcileHabitReminders } from '../lib/habitReminders';
import { deleteLocalDb } from '../lib/localDb';
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
  /** Deletes the account server-side, then wipes every local trace of it. */
  deleteAccount: () => Promise<AuthResult>;
}

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
  if (error) {
    return null;
  }
  return data as Profile;
}

export const useAuthStore = create<AuthState>((set, get) => ({
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

  deleteAccount: async () => {
    if (!get().user) {
      return { error: 'You need to be signed in to do that.' };
    }
    // Server first: if the RPC refuses (sole owner of a shared group) or
    // fails (offline slipped past the UI check, unexpected error), nothing
    // local has been touched and the account is fully intact.
    try {
      await deleteOwnAccount();
    } catch (error) {
      if (error instanceof SoleOwnerDeletionError) {
        return { error: error.message };
      }
      return { error: getAuthErrorMessage(error) };
    }

    // The auth.users row is gone; from here every step is local cleanup and
    // must complete BEFORE the session is torn down — some steps still read
    // this store's user id. Order: OS notification schedule, SQLite file,
    // in-memory store state, then the persisted session.
    //
    // 1. Cancel every scheduled habit reminder (empty habit list = reconcile
    //    cancels all of ours). Best-effort: a reminder for a deleted account
    //    is stale UX, not a data leak, and must not strand the flow.
    try {
      await reconcileHabitReminders([], {});
    } catch {
      // Notification APIs can fail on simulators/denied permissions; ignore.
    }
    // 2. Delete the SQLite FILE — a future sign-up on this device must never
    //    see this account's leftover habits (fresh empty schema on next open).
    deleteLocalDb();
    // 3. Clear in-memory store state (and the session-scoped activity-event
    //    dedup registry) so nothing survives until the next sign-in.
    resetPublishedActivityEvents();
    useHabitsStore.setState({
      habits: [],
      completions: {},
      isLoading: false,
      isSyncing: false,
      error: null,
      pendingSyncHabitIds: [],
      hasSyncFailures: false,
    });
    useGroupsStore.setState({
      myGroups: [],
      activeGroupId: null,
      membersByGroup: {},
      memberHabitsByGroup: {},
      memberCompletionsByGroup: {},
      eventsByGroup: {},
      isLoading: false,
      isRefreshing: false,
      error: null,
    });
    // 4. Drop the persisted session. Local scope only: the server session
    //    died with the auth.users row, so a network round-trip could only
    //    fail — and a sign-out "failure" must not be reported as a deletion
    //    failure when the account is already gone.
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch {
      // The store reset below still signs the UI out.
    }
    set({ session: null, user: null, profile: null });
    return { error: null };
  },
}));
