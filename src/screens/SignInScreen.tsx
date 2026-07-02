import { zodResolver } from '@hookform/resolvers/zod';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '../components/Button';
import { FormTextInput } from '../components/FormTextInput';
import { Screen } from '../components/Screen';
import { SignInInput, signInSchema } from '../lib/validation';
import { AuthStackParamList } from '../navigation/types';
import { useAuthStore } from '../store/auth';

type Props = NativeStackScreenProps<AuthStackParamList, 'SignIn'>;

export function SignInScreen({ navigation }: Props) {
  const signIn = useAuthStore((state) => state.signIn);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const { error } = await signIn(values);
    if (error) {
      setFormError(error);
    }
    // On success the root navigator switches to the app stack automatically.
  });

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
          <Text className="text-3xl font-bold text-slate-900">StreakSync</Text>
          <Text className="mb-8 mt-1 text-base text-slate-500">
            Keep your streaks alive, together.
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
          <FormTextInput
            control={control}
            name="password"
            label="Password"
            placeholder="Your password"
            secureTextEntry
            autoComplete="password"
            testID="password-input"
          />

          <Button
            title="Sign in"
            onPress={() => void onSubmit()}
            loading={isSubmitting}
            testID="sign-in-button"
          />

          <Pressable
            className="mt-4"
            onPress={() => navigation.navigate('ForgotPassword')}
            accessibilityRole="link"
          >
            <Text className="text-center text-sm font-medium text-emerald-700">
              Forgot your password?
            </Text>
          </Pressable>

          <View className="mt-10 flex-row justify-center">
            <Text className="text-sm text-slate-500">New here? </Text>
            <Pressable onPress={() => navigation.navigate('SignUp')} accessibilityRole="link">
              <Text className="text-sm font-semibold text-emerald-700">Create an account</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
