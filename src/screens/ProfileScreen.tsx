import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { CompositeScreenProps } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';

import { Button } from '../components/Button';
import { Screen } from '../components/Screen';
import { listBlockingGroups } from '../lib/accountDeletion';
import { buildDataExport } from '../lib/dataExport';
import { getIsOnline } from '../lib/network';
import { todayLocalISO } from '../lib/streaks';
import { AppStackParamList, AppTabParamList } from '../navigation/types';
import { useAuthStore } from '../store/auth';
import { useGroupsStore } from '../store/groups';

type Props = CompositeScreenProps<
  BottomTabScreenProps<AppTabParamList, 'Profile'>,
  NativeStackScreenProps<AppStackParamList>
>;

export function ProfileScreen({ navigation }: Props) {
  const profile = useAuthStore((state) => state.profile);
  const user = useAuthStore((state) => state.user);
  const signOut = useAuthStore((state) => state.signOut);
  const deleteAccount = useAuthStore((state) => state.deleteAccount);
  const myGroups = useGroupsStore((state) => state.myGroups);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleSignOut = async () => {
    setError(null);
    setSigningOut(true);
    const result = await signOut();
    setSigningOut(false);
    if (result.error) {
      setError(result.error);
    }
  };

  // Fully offline: the export reads the local SQLite mirror and cached group
  // metadata, lands in a temp file in the cache directory, and goes out
  // through the OS share sheet — never emailed or uploaded anywhere by us.
  const handleExport = async () => {
    if (!user) {
      return;
    }
    setError(null);
    setExporting(true);
    try {
      const data = buildDataExport(user.id, { profile, groups: myGroups });
      const file = new File(Paths.cache, `streaksync-export-${todayLocalISO()}.json`);
      file.create({ overwrite: true });
      file.write(JSON.stringify(data, null, 2));
      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/json',
        dialogTitle: 'Export my StreakSync data',
        UTI: 'public.json',
      });
    } catch {
      setError('Could not build the export. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const runDeletion = async () => {
    setError(null);
    setDeleting(true);
    const result = await deleteAccount();
    setDeleting(false);
    if (result.error) {
      setError(result.error);
    }
    // On success the cleared session lands the app back on the auth stack.
  };

  const handleDeleteAccount = async () => {
    if (!user) {
      return;
    }
    setError(null);
    // Deletion is a server operation; never attempt (or half-attempt) it
    // offline. The RPC would fail anyway — this is the clear message instead.
    if (!getIsOnline()) {
      Alert.alert(
        "You're offline",
        'Deleting your account needs a connection. Connect to the internet and try again.',
      );
      return;
    }
    setDeleting(true);
    try {
      // Friendlier than the raw RPC exception: list exactly which groups
      // block the deletion. The RPC re-checks server-side regardless.
      const blocking = await listBlockingGroups(user.id);
      if (blocking.length > 0) {
        const names = blocking.map((group) => `"${group.name}"`).join(', ');
        Alert.alert(
          'Resolve your groups first',
          `You are the only owner of ${names}, and other members still depend on ${
            blocking.length === 1 ? 'it' : 'them'
          }. Delete ${blocking.length === 1 ? 'that group' : 'those groups'} before deleting your account.`,
        );
        return;
      }
    } catch {
      setError('Could not check your groups. Check your connection and try again.');
      return;
    } finally {
      setDeleting(false);
    }

    // Same two-step destructive confirmation as habit and group deletion.
    Alert.alert(
      'Delete account',
      'Your profile, habits, streak history, and group memberships will be permanently deleted everywhere. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => void runDeletion() },
      ],
    );
  };

  const displayName = profile?.display_name ?? user?.email ?? 'there';

  return (
    <Screen edges={['top']}>
      <ScrollView contentContainerClassName="pb-8">
        <View className="px-6 pb-4 pt-2">
          <Text className="text-3xl font-bold text-slate-900 dark:text-slate-50">Profile</Text>
        </View>

        <View className="items-center px-6 pt-6">
          <Text className="text-5xl">🔥</Text>
          <Text className="mt-4 text-2xl font-bold text-slate-900 dark:text-slate-50">
            {displayName}
          </Text>
          {profile ? (
            <Text className="mt-1 text-base text-slate-500 dark:text-slate-400">
              @{profile.username}
            </Text>
          ) : null}
          <Text className="mt-2 text-center text-base text-slate-500 dark:text-slate-400">
            Keep your streaks alive, together.
          </Text>

          {error ? (
            <Text className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</Text>
          ) : null}

          <View className="mt-10 w-full gap-3">
            <Button
              title="Replay intro"
              variant="secondary"
              onPress={() => navigation.navigate('Onboarding')}
              testID="replay-intro-button"
            />
            <Button
              title="Sign out"
              variant="secondary"
              loading={signingOut}
              onPress={() => void handleSignOut()}
              testID="sign-out-button"
            />
          </View>

          <View className="mt-10 w-full rounded-2xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
            <Text className="text-base font-semibold text-red-700 dark:text-red-300">
              Danger zone
            </Text>
            <Text className="mt-1 text-sm text-red-600/80 dark:text-red-300/70">
              Take your data with you, or delete your account and everything in it.
            </Text>
            <View className="mt-4 gap-3">
              <Button
                title="Export my data"
                variant="secondary"
                loading={exporting}
                onPress={() => void handleExport()}
                testID="export-data-button"
              />
              <Button
                title="Delete my account"
                variant="danger"
                loading={deleting}
                onPress={() => void handleDeleteAccount()}
                testID="delete-account-button"
              />
            </View>
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}
