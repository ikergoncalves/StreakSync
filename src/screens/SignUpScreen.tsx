import { zodResolver } from '@hookform/resolvers/zod';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '../components/Button';
import { FormTextInput } from '../components/FormTextInput';
import { Screen } from '../components/Screen';
import { SignUpInput, signUpSchema } from '../lib/validation';
import { AuthStackParamList } from '../navigation/types';
import { useAuthStore } from '../store/auth';

type Props = NativeStackScreenProps<AuthStackParamList, 'SignUp'>;

export function SignUpScreen({ navigation }: Props) {
  const signUp = useAuthStore((state) => state.signUp);
  const [formError, setFormError] = useState<string | null>(null);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<SignUpInput>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { username: '', email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const { error, needsEmailConfirmation } = await signUp(values);
    if (error) {
      setFormError(error);
      return;
    }
    if (needsEmailConfirmation) {
      setAwaitingConfirmation(true);
    }
    // With email confirmation disabled a session is created right away and
    // the root navigator switches to the app stack automatically.
  });

  if (awaitingConfirmation) {
    return (
      <Screen>
        <View className="flex-1 justify-center px-6">
          <Text className="text-3xl font-bold text-slate-900">Check your inbox</Text>
          <Text className="mb-8 mt-2 text-base text-slate-500">
            We sent you a confirmation link. Open it to activate your account, then sign in.
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
          <Text className="text-3xl font-bold text-slate-900">Create your account</Text>
          <Text className="mb-8 mt-1 text-base text-slate-500">
            Track habits and keep each other accountable.
          </Text>

          {formError ? (
            <View testID="form-error" className="mb-4 rounded-xl bg-red-50 px-4 py-3">
              <Text className="text-sm text-red-700">{formError}</Text>
            </View>
          ) : null}

          <FormTextInput
            control={control}
            name="username"
            label="Username"
            placeholder="your_username"
            autoCapitalize="none"
            autoCorrect={false}
            testID="username-input"
          />
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
          <FormTextInput
            control={control}
            name="password"
            label="Password"
            placeholder="At least 8 characters"
            secureTextEntry
            autoComplete="new-password"
            testID="password-input"
          />

          <Button
            title="Create account"
            onPress={() => void onSubmit()}
            loading={isSubmitting}
            testID="sign-up-button"
          />

          <View className="mt-10 flex-row justify-center">
            <Text className="text-sm text-slate-500">Already have an account? </Text>
            <Pressable onPress={() => navigation.navigate('SignIn')} accessibilityRole="link">
              <Text className="text-sm font-semibold text-emerald-700">Sign in</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
