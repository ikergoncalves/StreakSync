import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase configuration. Copy .env.example to .env and set ' +
      'EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY, then restart the dev server.',
  );
}

// Sessions are persisted in AsyncStorage rather than expo-secure-store:
// SecureStore caps values at 2048 bytes and a Supabase session payload
// (access token + refresh token + user JSON) regularly exceeds that limit,
// which would truncate and corrupt the stored session. The session holds
// only short-lived tokens (never the password), which is an acceptable
// trade-off here; a chunked/encrypted SecureStore adapter can be swapped in
// later without touching any callers.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// supabase-js only refreshes tokens while it believes the app is active.
// Report foreground/background transitions so sessions survive long suspends.
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
