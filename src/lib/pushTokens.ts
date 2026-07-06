import Constants from 'expo-constants';
import { randomUUID } from 'expo-crypto';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

import { supabase } from './supabase';

/**
 * Ensures notification permission, prompting only while the OS still allows
 * prompting. A denial is a normal, supported state: callers get `false` and
 * carry on — habits, sync, and groups all work fully without notifications,
 * and we never nag (once canAskAgain is false the prompt is not re-fired).
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) {
    return true;
  }
  if (!current.canAskAgain) {
    return false;
  }
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

/**
 * Registers this device's Expo push token for the signed-in user, returning
 * the token or null when there is nothing to register (simulator, permission
 * denied). Upserts on the token's unique column so re-registration on every
 * app foreground updates one row instead of accumulating duplicates.
 *
 * KNOWN LIMITATION: if a different account signs in on a device whose token
 * is still registered to the previous account, the upsert hits the other
 * user's row and RLS rejects it — the error propagates to the caller, which
 * treats registration as best-effort. The stale row disappears when the
 * previous account's sends hit DeviceNotRegistered after a reinstall, or can
 * be handled by a sign-out cleanup in a later phase.
 */
export async function registerPushToken(userId: string): Promise<string | null> {
  // Expo push tokens only exist on physical devices; simulators must be a
  // graceful no-op, not a crash.
  if (!Device.isDevice) {
    return null;
  }
  if (!(await ensureNotificationPermission())) {
    return null;
  }

  const projectId =
    (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId ??
    Constants.easConfig?.projectId;
  const { data: token } = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined,
  );

  const { error } = await supabase.from('push_tokens').upsert(
    {
      id: randomUUID(),
      user_id: userId,
      token,
      device_name: Device.deviceName ?? null,
    },
    { onConflict: 'token' },
  );
  if (error) {
    throw error;
  }
  return token;
}

/**
 * Push tokens of the OTHER members of a group — the recipient list for a
 * social push triggered by the signed-in user's own activity. Peers' rows
 * are readable via the shares_group_with SELECT policy (migration 0006).
 */
export async function listGroupPeerTokens(userId: string, groupId: string): Promise<string[]> {
  const membersResult = await supabase
    .from('group_members')
    .select('user_id')
    .eq('group_id', groupId)
    .neq('user_id', userId);
  if (membersResult.error) {
    throw membersResult.error;
  }
  const peerIds = (membersResult.data ?? []).map((row) => row.user_id as string);
  if (peerIds.length === 0) {
    return [];
  }

  const tokensResult = await supabase.from('push_tokens').select('token').in('user_id', peerIds);
  if (tokensResult.error) {
    throw tokensResult.error;
  }
  return (tokensResult.data ?? []).map((row) => row.token as string);
}

/**
 * Deletes tokens Expo reported as DeviceNotRegistered. Routine cleanup after
 * a send (the app behind the token was uninstalled), not an error path — the
 * delete policy in migration 0006 explicitly allows group peers to do this.
 */
export async function deleteInvalidTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) {
    return;
  }
  const { error } = await supabase.from('push_tokens').delete().in('token', tokens);
  if (error) {
    throw error;
  }
}
