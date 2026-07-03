import { zodResolver } from '@hookform/resolvers/zod';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '../components/Button';
import { FormTextInput } from '../components/FormTextInput';
import { Screen } from '../components/Screen';
import { HabitInput } from '../lib/habits';
import { HabitFormInput, habitSchema } from '../lib/validation';
import { AppStackParamList } from '../navigation/types';
import { useHabitsStore } from '../store/habits';

type Props = NativeStackScreenProps<AppStackParamList, 'HabitForm'>;

export const HABIT_ICONS = [
  '💪',
  '🏃',
  '📚',
  '💧',
  '🧘',
  '😴',
  '🥗',
  '✍️',
  '🎸',
  '🧹',
  '💊',
  '🚶',
];

export const HABIT_COLORS = [
  '#10b981', // emerald
  '#0ea5e9', // sky
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#ef4444', // red
  '#f97316', // orange
  '#f59e0b', // amber
  '#14b8a6', // teal
];

const TARGET_OPTIONS = [1, 2, 3, 4, 5, 6, 7];

function toHabitInput(values: HabitFormInput): HabitInput {
  const description = values.description.trim();
  return {
    name: values.name.trim(),
    description: description ? description : null,
    icon: values.icon,
    color: values.color,
    frequency: values.frequency,
    target_days_per_week: values.frequency === 'weekly' ? values.targetDaysPerWeek : null,
  };
}

function FieldLabel({ children }: { children: string }) {
  return <Text className="mb-1.5 text-sm font-medium text-slate-700">{children}</Text>;
}

export function HabitFormScreen({ navigation, route }: Props) {
  const habitId = route.params?.habitId;
  const habit = useHabitsStore((state) =>
    state.habits.find((candidate) => candidate.id === habitId),
  );
  const create = useHabitsStore((state) => state.create);
  const update = useHabitsStore((state) => state.update);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<HabitFormInput>({
    resolver: zodResolver(habitSchema),
    defaultValues: habit
      ? {
          name: habit.name,
          description: habit.description ?? '',
          icon: habit.icon ?? HABIT_ICONS[0],
          color: habit.color ?? HABIT_COLORS[0],
          frequency: habit.frequency,
          targetDaysPerWeek: habit.target_days_per_week ?? 3,
        }
      : {
          name: '',
          description: '',
          icon: HABIT_ICONS[0],
          color: HABIT_COLORS[0],
          frequency: 'daily',
          targetDaysPerWeek: 3,
        },
  });

  const frequency = useWatch({ control, name: 'frequency' });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const input = toHabitInput(values);
    const result = habit ? await update(habit.id, input) : await create(input);
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
          <Text className="text-2xl font-bold text-slate-900">
            {habit ? 'Edit habit' : 'New habit'}
          </Text>
          <Pressable
            testID="close-form-button"
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={() => navigation.goBack()}
            className="h-10 w-10 items-center justify-center rounded-full bg-slate-200 active:bg-slate-300"
          >
            <Text className="text-base text-slate-600">✕</Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerClassName="px-6 pb-8 pt-2"
          keyboardShouldPersistTaps="handled"
        >
          {formError ? (
            <View testID="form-error" className="mb-4 rounded-xl bg-red-50 px-4 py-3">
              <Text className="text-sm text-red-700">{formError}</Text>
            </View>
          ) : null}

          <FormTextInput
            control={control}
            name="name"
            label="Name"
            placeholder="Read 10 pages"
            maxLength={100}
            testID="name-input"
          />
          <FormTextInput
            control={control}
            name="description"
            label="Description (optional)"
            placeholder="Why does this habit matter to you?"
            multiline
            numberOfLines={3}
            testID="description-input"
          />

          <Controller
            control={control}
            name="icon"
            render={({ field: { value, onChange } }) => (
              <View className="mb-4">
                <FieldLabel>Icon</FieldLabel>
                <View className="flex-row flex-wrap gap-2">
                  {HABIT_ICONS.map((icon) => (
                    <Pressable
                      key={icon}
                      testID={`icon-option-${icon}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: value === icon }}
                      onPress={() => onChange(icon)}
                      className={`h-11 w-11 items-center justify-center rounded-xl border ${
                        value === icon ? 'border-emerald-600 bg-emerald-50' : 'border-slate-200 bg-white'
                      }`}
                    >
                      <Text className="text-xl">{icon}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}
          />

          <Controller
            control={control}
            name="color"
            render={({ field: { value, onChange } }) => (
              <View className="mb-4">
                <FieldLabel>Color</FieldLabel>
                <View className="flex-row flex-wrap gap-2">
                  {HABIT_COLORS.map((color) => (
                    <Pressable
                      key={color}
                      testID={`color-option-${color}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: value === color }}
                      onPress={() => onChange(color)}
                      className={`h-10 w-10 rounded-full ${
                        value === color ? 'border-2 border-slate-900' : ''
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </View>
              </View>
            )}
          />

          <Controller
            control={control}
            name="frequency"
            render={({ field: { value, onChange } }) => (
              <View className="mb-4">
                <FieldLabel>Frequency</FieldLabel>
                <View className="flex-row rounded-xl bg-slate-200 p-1">
                  {(['daily', 'weekly'] as const).map((option) => (
                    <Pressable
                      key={option}
                      testID={`frequency-${option}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: value === option }}
                      onPress={() => onChange(option)}
                      className={`flex-1 items-center rounded-lg py-2 ${
                        value === option ? 'bg-white' : ''
                      }`}
                    >
                      <Text
                        className={`text-sm font-medium ${
                          value === option ? 'text-slate-900' : 'text-slate-500'
                        }`}
                      >
                        {option === 'daily' ? 'Daily' : 'Weekly'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}
          />

          {frequency === 'weekly' ? (
            <Controller
              control={control}
              name="targetDaysPerWeek"
              render={({ field: { value, onChange }, fieldState: { error } }) => (
                <View className="mb-4">
                  <FieldLabel>Days per week</FieldLabel>
                  <View className="flex-row gap-2">
                    {TARGET_OPTIONS.map((target) => (
                      <Pressable
                        key={target}
                        testID={`target-${target}`}
                        accessibilityRole="button"
                        accessibilityState={{ selected: value === target }}
                        onPress={() => onChange(target)}
                        className={`h-10 flex-1 items-center justify-center rounded-lg border ${
                          value === target
                            ? 'border-emerald-600 bg-emerald-600'
                            : 'border-slate-200 bg-white'
                        }`}
                      >
                        <Text
                          className={
                            value === target ? 'font-semibold text-white' : 'text-slate-700'
                          }
                        >
                          {target}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  {error ? (
                    <Text className="mt-1 text-xs text-red-600">{error.message}</Text>
                  ) : null}
                </View>
              )}
            />
          ) : null}

          <View className="mt-4">
            <Button
              title={habit ? 'Save changes' : 'Create habit'}
              onPress={() => void onSubmit()}
              loading={isSubmitting}
              testID="submit-habit-button"
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
