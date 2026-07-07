import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { CompositeScreenProps } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, useColorScheme, View } from 'react-native';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Button } from '../components/Button';
import { OfflineBanner } from '../components/OfflineBanner';
import { Screen } from '../components/Screen';
import { useHabitStreak } from '../hooks/useHabitStreak';
import { becameCompleted, streakIncreased } from '../lib/animationTriggers';
import { todayLocalISO } from '../lib/streaks';
import { ACCENT, getInlineColors } from '../lib/theme';
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
  /** True while the habit has mutations queued for sync. */
  pendingSync: boolean;
  onToggle: (habitId: string) => void;
  onPress: (habitId: string) => void;
}

function HabitRow({ habit, completed, pendingSync, onToggle, onPress }: HabitRowProps) {
  const streak = useHabitStreak(habit.id);
  const inlineColors = getInlineColors(useColorScheme());
  const color = habit.color ?? DEFAULT_COLOR;
  const streakLabel =
    habit.frequency === 'weekly' ? `${streak.current} wk streak` : `${streak.current} day streak`;

  // Both animations react to the already-applied optimistic state — the
  // toggle itself is never gated on them. The previous values live in refs
  // and the pure predicates in lib/animationTriggers decide whether anything
  // actually changed, so unrelated re-renders (and first mount) stay still.
  const checkScale = useSharedValue(1);
  const flameScale = useSharedValue(1);
  const prevCompleted = useRef<boolean | undefined>(undefined);
  const prevStreak = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (becameCompleted(prevCompleted.current, completed)) {
      checkScale.value = withSequence(
        withSpring(1.2, { damping: 14, stiffness: 400 }),
        withSpring(1, { damping: 16, stiffness: 300 }),
      );
    }
    prevCompleted.current = completed;
  }, [completed, checkScale]);

  useEffect(() => {
    if (streakIncreased(prevStreak.current, streak.current)) {
      flameScale.value = withSequence(
        withTiming(1.25, { duration: 140 }),
        withTiming(1, { duration: 180 }),
      );
    }
    prevStreak.current = streak.current;
  }, [streak, flameScale]);

  const checkAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkScale.value }],
  }));
  const flameAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: flameScale.value }],
  }));

  return (
    <Pressable
      testID={`habit-row-${habit.id}`}
      accessibilityRole="button"
      accessibilityLabel={habit.name}
      className="mb-3 flex-row items-center rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900"
      onPress={() => onPress(habit.id)}
    >
      <View
        className="h-11 w-11 items-center justify-center rounded-xl"
        style={{ backgroundColor: `${color}22` }}
      >
        <Text className="text-xl">{habit.icon ?? '✅'}</Text>
      </View>
      <View className="ml-3 flex-1">
        <Text
          className="text-base font-semibold text-slate-900 dark:text-slate-50"
          numberOfLines={1}
        >
          {habit.name}
        </Text>
        <Animated.View style={[{ alignSelf: 'flex-start' }, flameAnimatedStyle]}>
          <Text className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            🔥 {streakLabel}
            {pendingSync ? (
              <Text
                testID={`pending-sync-${habit.id}`}
                className="text-xs text-slate-400 dark:text-slate-500"
              >
                {'  '}⏳
              </Text>
            ) : null}
          </Text>
        </Animated.View>
      </View>
      <Animated.View style={checkAnimatedStyle}>
        <Pressable
          testID={`toggle-${habit.id}`}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: completed }}
          accessibilityLabel={`Mark ${habit.name} ${completed ? 'not done' : 'done'} today`}
          onPress={() => onToggle(habit.id)}
          // Generous hit area: this is the primary daily interaction.
          hitSlop={8}
          className="h-10 w-10 items-center justify-center rounded-full border-2"
          style={
            completed
              ? { backgroundColor: color, borderColor: color }
              : { borderColor: inlineColors.uncheckedToggleBorder }
          }
        >
          {completed ? <Text className="text-base font-bold text-white">✓</Text> : null}
        </Pressable>
      </Animated.View>
    </Pressable>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <View testID="empty-state" className="flex-1 items-center justify-center py-16">
      <Text className="text-5xl">🌱</Text>
      <Text className="mt-4 text-xl font-semibold text-slate-900 dark:text-slate-50">
        No habits yet
      </Text>
      <Text className="mt-1 px-8 text-center text-base text-slate-500 dark:text-slate-400">
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
  const isSyncing = useHabitsStore((state) => state.isSyncing);
  const loadError = useHabitsStore((state) => state.error);
  const pendingSyncHabitIds = useHabitsStore((state) => state.pendingSyncHabitIds);
  const hasSyncFailures = useHabitsStore((state) => state.hasSyncFailures);
  const load = useHabitsStore((state) => state.load);
  const refresh = useHabitsStore((state) => state.refresh);
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
          <Text className="text-3xl font-bold text-slate-900 dark:text-slate-50">Today</Text>
          <Text className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{subtitle}</Text>
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

      <OfflineBanner />

      {hasSyncFailures ? (
        <View
          testID="sync-issue-banner"
          className="mx-6 mb-3 rounded-xl bg-amber-50 px-4 py-2 dark:bg-amber-950"
        >
          <Text className="text-xs font-medium text-amber-800 dark:text-amber-200">
            Some changes couldn&apos;t sync. They&apos;re saved on this device.
          </Text>
        </View>
      ) : null}

      {error ? (
        <View
          testID="today-error"
          className="mx-6 mb-3 rounded-xl bg-red-50 px-4 py-3 dark:bg-red-950"
        >
          <Text className="text-sm text-red-700 dark:text-red-300">{error}</Text>
        </View>
      ) : null}

      <FlatList
        data={habits}
        keyExtractor={(habit) => habit.id}
        renderItem={({ item }) => (
          // Reanimated's entering animation on the row wrapper is the least
          // complex way to fade rows in as they mount: no per-item state, and
          // it composes with FlatList recycling for free. Short and subtle by
          // design — the list must never feel like it's waiting on it.
          <Animated.View entering={FadeInDown.duration(220)}>
            <HabitRow
              habit={item}
              completed={(completions[item.id] ?? []).includes(today)}
              pendingSync={pendingSyncHabitIds.includes(item.id)}
              onToggle={(habitId) => void handleToggle(habitId)}
              onPress={(habitId) => navigation.navigate('HabitDetail', { habitId })}
            />
          </Animated.View>
        )}
        contentContainerClassName="flex-grow px-6 pb-6"
        refreshControl={
          <RefreshControl
            refreshing={isSyncing}
            onRefresh={() => void refresh()}
            tintColor={ACCENT}
          />
        }
        ListEmptyComponent={
          isLoading ? null : <EmptyState onCreate={() => navigation.navigate('HabitForm')} />
        }
      />
    </Screen>
  );
}
