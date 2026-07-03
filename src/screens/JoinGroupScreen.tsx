import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Button } from '../components/Button';
import { Screen } from '../components/Screen';
import { AppStackParamList } from '../navigation/types';
import { useGroupsStore } from '../store/groups';

type Props = NativeStackScreenProps<AppStackParamList, 'JoinGroup'>;

const MONOSPACE = Platform.select({ ios: 'Courier', default: 'monospace' });

/** Invite codes are 8 chars from an uppercase alphabet; normalize as typed. */
function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/\s/g, '');
}

/**
 * Manual code entry, and the deep-link target: streaksync://join/CODE opens
 * this screen with the code pre-filled (see the linking config in App.tsx).
 */
export function JoinGroupScreen({ navigation, route }: Props) {
  const joinByCode = useGroupsStore((state) => state.joinByCode);
  const [code, setCode] = useState(() => normalizeCode(route.params?.code ?? ''));
  const [error, setError] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);

  const handleJoin = async () => {
    setError(null);
    setIsJoining(true);
    const result = await joinByCode(code);
    setIsJoining(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    if (result.alreadyMember) {
      // Not a failure — the code was valid, there is just nothing new to
      // join. Say so instead of silently doing nothing; the native alert
      // stays visible across the navigation below.
      Alert.alert('Already a member', "You're already in this group.");
    }
    // Land on the Groups tab with the joined group already active.
    navigation.navigate('Tabs', { screen: 'Groups' });
  };

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <View className="flex-row items-center justify-between px-6 pb-2 pt-4">
          <Text className="text-2xl font-bold text-slate-900">Join a group</Text>
          <Pressable
            testID="close-join-group-button"
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={() => navigation.goBack()}
            className="h-10 w-10 items-center justify-center rounded-full bg-slate-200 active:bg-slate-300"
          >
            <Text className="text-base text-slate-600">✕</Text>
          </Pressable>
        </View>

        <View className="px-6 pt-2">
          {error ? (
            <View testID="join-group-error" className="mb-4 rounded-xl bg-red-50 px-4 py-3">
              <Text className="text-sm text-red-700">{error}</Text>
            </View>
          ) : null}

          <Text className="mb-1.5 text-sm font-medium text-slate-700">Invite code</Text>
          <TextInput
            testID="invite-code-input"
            className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-lg tracking-widest text-slate-900"
            style={{ fontFamily: MONOSPACE }}
            placeholder="A7K2M9XZ"
            placeholderTextColor="#94a3b8"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={8}
            value={code}
            onChangeText={(text) => setCode(normalizeCode(text))}
          />
          <Text className="mb-6 mt-2 text-sm text-slate-500">
            Ask a friend for their group&apos;s 8-character code, or open their invite link.
          </Text>
          <Button
            title="Join"
            onPress={() => void handleJoin()}
            loading={isJoining}
            disabled={code.length === 0}
            testID="submit-join-button"
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
