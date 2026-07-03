import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { CompositeScreenProps } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';

import { Button } from '../components/Button';
import { Screen } from '../components/Screen';
import { useHabitStreak } from '../hooks/useHabitStreak';
import { todayLocalISO } from '../lib/streaks';
import { AppStackParamList, AppTabParamList } from '../navigation/types';
import { useHabitsStore } from '../store/habits';
import { Habit } from '../types';

type Props = CompositeScreenProps<
  BottomTabScreenProps<AppTabParamList, 'Today'>,
  NativeStackScreenProps<AppStackParamList>
>;

const DEFAULT_COLOR = '#10b981';

interface HabitRowProps {
  habit: Habit;
  completed: boolean;
  onToggle: (habitId: string) => void;
  onPress: (habitId: string) => void;
}

function HabitRow({ habit, completed, onToggle, onPress }: HabitRowProps) {
  const streak = useHabitStreak(habit.id);
  const color = habit.color ?? DEFAULT_COLOR;
  const streakLabel =
    habit.frequency === 'weekly' ? `${streak.current} wk streak` : `${streak.current} day streak`;

  return (
    <Pressable
      testID={`habit-row-${habit.id}`}
      accessibilityRole="button"
      accessibilityLabel={habit.name}
      className="mb-3 flex-row items-center rounded-2xl bg-white p-4 shadow-sm"
      onPress={() => onPress(habit.id)}
    >
      <View
        className="h-11 w-11 items-center justify-center rounded-xl"
        style={{ backgroundColor: `${color}22` }}
      >
        <Text className="text-xl">{habit.icon ?? '✅'}</Text>
      </View>
      <View className="ml-3 flex-1">
        <Text className="text-base font-semibold text-slate-900" numberOfLines={1}>
          {habit.name}
        </Text>
        <Text className="mt-0.5 text-sm text-slate-500">🔥 {streakLabel}</Text>
      </View>
      <Pressable
        testID={`toggle-${habit.id}`}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: completed }}
        accessibilityLabel={`Mark ${habit.name} ${completed ? 'not done' : 'done'} today`}
        onPress={() => onToggle(habit.id)}
        // Generous hit area: this is the primary daily interaction.
        hitSlop={8}
        className="h-10 w-10 items-center justify-center rounded-full border-2"
        style={completed ? { backgroundColor: color, borderColor: color } : { borderColor: '#cbd5e1' }}
      >
        {completed ? <Text className="text-base font-bold text-white">✓</Text> : null}
      </Pressable>
    </Pressable>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <View testID="empty-state" className="flex-1 items-center justify-center py-16">
      <Text className="text-5xl">🌱</Text>
      <Text className="mt-4 text-xl font-semibold text-slate-900">No habits yet</Text>
      <Text className="mt-1 px-8 text-center text-base text-slate-500">
        Create your first habit and start building your streak.
      </Text>
      <View className="mt-8 w-full px-6">
        <Button
          title="Create your first habit"
          onPress={onCreate}
          testID="create-first-habit-button"
        />
      </View>
    </View>
  );
}

export function TodayScreen({ navigation }: Props) {
  const habits = useHabitsStore((state) => state.habits);
  const completions = useHabitsStore((state) => state.completions);
  const isLoading = useHabitsStore((state) => state.isLoading);
  const loadError = useHabitsStore((state) => state.error);
  const load = useHabitsStore((state) => state.load);
  const toggle = useHabitsStore((state) => state.toggle);
  const [toggleError, setToggleError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  const handleToggle = useCallback(
    async (habitId: string) => {
      setToggleError(null);
      const result = await toggle(habitId);
      if (result.error) {
        setToggleError(result.error);
      }
    },
    [toggle],
  );

  const today = todayLocalISO();
  const subtitle = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const error = toggleError ?? loadError;

  return (
    <Screen edges={['top']}>
      <View className="flex-row items-center justify-between px-6 pb-4 pt-2">
        <View>
          <Text className="text-3xl font-bold text-slate-900">Today</Text>
          <Text className="mt-0.5 text-sm text-slate-500">{subtitle}</Text>
        </View>
        <Pressable
          testID="add-habit-button"
          accessibilityRole="button"
          accessibilityLabel="Create habit"
          onPress={() => navigation.navigate('HabitForm')}
          className="h-11 w-11 items-center justify-center rounded-full bg-emerald-600 active:bg-emerald-700"
        >
          <Text className="text-2xl leading-7 text-white">+</Text>
        </Pressable>
      </View>

      {error ? (
        <View testID="today-error" className="mx-6 mb-3 rounded-xl bg-red-50 px-4 py-3">
          <Text className="text-sm text-red-700">{error}</Text>
        </View>
      ) : null}

      <FlatList
        data={habits}
        keyExtractor={(habit) => habit.id}
        renderItem={({ item }) => (
          <HabitRow
            habit={item}
            completed={(completions[item.id] ?? []).includes(today)}
            onToggle={(habitId) => void handleToggle(habitId)}
            onPress={(habitId) => navigation.navigate('HabitDetail', { habitId })}
          />
        )}
        contentContainerClassName="flex-grow px-6 pb-6"
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={() => void load()}
            tintColor="#059669"
          />
        }
        ListEmptyComponent={
          isLoading ? null : <EmptyState onCreate={() => navigation.navigate('HabitForm')} />
        }
      />
    </Screen>
  );
}
