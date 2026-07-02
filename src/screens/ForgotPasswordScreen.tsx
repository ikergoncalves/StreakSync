import { zodResolver } from '@hookform/resolvers/zod';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '../components/Button';
import { FormTextInput } from '../components/FormTextInput';
import { Screen } from '../components/Screen';
import { ForgotPasswordInput, forgotPasswordSchema } from '../lib/validation';
import { AuthStackParamList } from '../navigation/types';
import { useAuthStore } from '../store/auth';

type Props = NativeStackScreenProps<AuthStackParamList, 'ForgotPassword'>;

export function ForgotPasswordScreen({ navigation }: Props) {
  const resetPassword = useAuthStore((state) => state.resetPassword);
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = handleSubmit(async ({ email }) => {
    setFormError(null);
    const { error } = await resetPassword(email);
    if (error) {
      setFormError(error);
      return;
    }
    setSent(true);
  });

  if (sent) {
    return (
      <Screen>
        <View className="flex-1 justify-center px-6">
          <Text className="text-3xl font-bold text-slate-900">Email sent</Text>
          <Text className="mb-8 mt-2 text-base text-slate-500">
            If an account exists for that email, you will receive a password reset link shortly.
          </Text>
          <Button title="Back to sign in" onPress={() => navigation.navigate('SignIn')} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <ScrollView
          contentContainerClassName="flex-grow justify-center px-6 py-8"
          keyboardShouldPersistTaps="handled"
        >
          <Text className="text-3xl font-bold text-slate-900">Reset your password</Text>
          <Text className="mb-8 mt-1 text-base text-slate-500">
            Enter your email and we will send you a reset link.
          </Text>

          {formError ? (
            <View testID="form-error" className="mb-4 rounded-xl bg-red-50 px-4 py-3">
              <Text className="text-sm text-red-700">{formError}</Text>
            </View>
          ) : null}

          <FormTextInput
            control={control}
            name="email"
            label="Email"
            placeholder="you@example.com"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            testID="email-input"
          />

          <Button
            title="Send reset link"
            onPress={() => void onSubmit()}
            loading={isSubmitting}
            testID="reset-password-button"
          />

          <Pressable className="mt-4" onPress={() => navigation.goBack()} accessibilityRole="link">
            <Text className="text-center text-sm font-medium text-emerald-700">
              Back to sign in
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
