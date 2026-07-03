import { zodResolver } from '@hookform/resolvers/zod';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';

import { Button } from '../components/Button';
import { FormTextInput } from '../components/FormTextInput';
import { Screen } from '../components/Screen';
import { GroupFormInput, groupSchema } from '../lib/validation';
import { AppStackParamList } from '../navigation/types';
import { useGroupsStore } from '../store/groups';

type Props = NativeStackScreenProps<AppStackParamList, 'CreateGroup'>;

export function CreateGroupScreen({ navigation }: Props) {
  const create = useGroupsStore((state) => state.create);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<GroupFormInput>({
    resolver: zodResolver(groupSchema),
    defaultValues: { name: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    // The store switches the active group to the new one on success.
    const result = await create(values.name.trim());
    if (result.error) {
      setFormError(result.error);
      return;
    }
    navigation.goBack();
  });

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <View className="flex-row items-center justify-between px-6 pb-2 pt-4">
          <Text className="text-2xl font-bold text-slate-900">New group</Text>
          <Pressable
            testID="close-create-group-button"
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={() => navigation.goBack()}
            className="h-10 w-10 items-center justify-center rounded-full bg-slate-200 active:bg-slate-300"
          >
            <Text className="text-base text-slate-600">✕</Text>
          </Pressable>
        </View>

        <View className="px-6 pt-2">
          {formError ? (
            <View testID="create-group-error" className="mb-4 rounded-xl bg-red-50 px-4 py-3">
              <Text className="text-sm text-red-700">{formError}</Text>
            </View>
          ) : null}

          <FormTextInput
            control={control}
            name="name"
            label="Name"
            placeholder="Morning crew"
            maxLength={50}
            testID="group-name-input"
          />
          <Text className="mb-6 text-sm text-slate-500">
            You&apos;ll get an invite code to share with friends right after.
          </Text>
          <Button
            title="Create group"
            onPress={() => void onSubmit()}
            loading={isSubmitting}
            testID="submit-group-button"
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
