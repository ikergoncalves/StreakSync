import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '../components/Button';
import { Screen } from '../components/Screen';
import { useHabitStreak } from '../hooks/useHabitStreak';
import { addDays, startOfWeek, todayLocalISO } from '../lib/streaks';
import { AppStackParamList } from '../navigation/types';
import { useHabitsStore } from '../store/habits';

type Props = NativeStackScreenProps<AppStackParamList, 'HabitDetail'>;

const DEFAULT_COLOR = '#10b981';
const WEEKS_SHOWN = 8;
const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

interface HistoryGridProps {
  completedDates: string[];
  today: string;
  color: string;
}

/** Monday-based grid of the last WEEKS_SHOWN weeks, oldest week on top. */
function HistoryGrid({ completedDates, today, color }: HistoryGridProps) {
  const completed = new Set(completedDates);
  const currentWeekStart = startOfWeek(today);
  const weeks: string[][] = [];
  for (let weeksAgo = WEEKS_SHOWN - 1; weeksAgo >= 0; weeksAgo -= 1) {
    const weekStart = addDays(currentWeekStart, -7 * weeksAgo);
    weeks.push(Array.from({ length: 7 }, (_, offset) => addDays(weekStart, offset)));
  }

  return (
    <View testID="history-grid">
      <View className="mb-1.5 flex-row gap-1.5">
        {DAY_LABELS.map((label, index) => (
          <Text key={index} className="flex-1 text-center text-xs text-slate-400">
            {label}
          </Text>
        ))}
      </View>
      {weeks.map((week) => (
        <View key={week[0]} className="mb-1.5 flex-row gap-1.5">
          {week.map((date) => {
            // ISO date strings compare correctly as plain strings.
            const isFuture = date > today;
            const isDone = completed.has(date);
            return (
              <View
                key={date}
                testID={isDone ? `history-done-${date}` : undefined}
                className="aspect-square flex-1 rounded-md"
                style={{
                  backgroundColor: isDone ? color : '#e2e8f0',
                  opacity: isFuture ? 0.3 : 1,
                  borderWidth: date === today ? 2 : 0,
                  borderColor: '#0f172a',
                }}
              />
            );
          })}
        </View>
      ))}
    </View>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 rounded-2xl bg-white p-4 shadow-sm">
      <Text className="text-sm text-slate-500">{label}</Text>
      <Text className="mt-1 text-2xl font-bold text-slate-900">{value}</Text>
    </View>
  );
}

export function HabitDetailScreen({ navigation, route }: Props) {
  const { habitId } = route.params;
  const habit = useHabitsStore((state) =>
    state.habits.find((candidate) => candidate.id === habitId),
  );
  const completedDates = useHabitsStore((state) => state.completions[habitId]);
  const remove = useHabitsStore((state) => state.remove);
  const streak = useHabitStreak(habitId);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  if (!habit) {
    // Just soft-deleted (store updates before goBack lands) or never loaded.
    return (
      <Screen>
        <View />
      </Screen>
    );
  }

  const color = habit.color ?? DEFAULT_COLOR;
  const unit = habit.frequency === 'weekly' ? 'week' : 'day';
  const formatStreak = (count: number) => `${count} ${unit}${count === 1 ? '' : 's'}`;

  const handleDelete = async () => {
    setError(null);
    setDeleting(true);
    const result = await remove(habit.id);
    if (result.error) {
      setDeleting(false);
      setError(result.error);
      return;
    }
    navigation.goBack();
  };

  const confirmDelete = () => {
    Alert.alert(
      'Delete habit',
      `"${habit.name}" and its streak history will disappear from your lists.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => void handleDelete() },
      ],
    );
  };

  return (
    <Screen>
      <View className="flex-row items-center px-4 pb-2 pt-2">
        <Pressable
          testID="back-button"
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => navigation.goBack()}
          hitSlop={8}
          className="h-10 w-10 items-center justify-center rounded-full"
        >
          <Text className="text-3xl leading-9 text-slate-700">‹</Text>
        </Pressable>
        <View className="flex-1" />
        <Pressable
          testID="edit-habit-button"
          accessibilityRole="button"
          onPress={() => navigation.navigate('HabitForm', { habitId: habit.id })}
          className="h-10 items-center justify-center rounded-full bg-slate-200 px-4 active:bg-slate-300"
        >
          <Text className="text-sm font-semibold text-slate-700">Edit</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerClassName="px-6 pb-8">
        <View className="flex-row items-center">
          <View
            className="h-14 w-14 items-center justify-center rounded-2xl"
            style={{ backgroundColor: `${color}22` }}
          >
            <Text className="text-2xl">{habit.icon ?? '✅'}</Text>
          </View>
          <View className="ml-3 flex-1">
            <Text className="text-2xl font-bold text-slate-900">{habit.name}</Text>
            <Text className="mt-0.5 text-sm text-slate-500">
              {habit.frequency === 'weekly'
                ? `Weekly · ${habit.target_days_per_week ?? 1}x per week`
                : 'Daily'}
            </Text>
          </View>
        </View>

        {habit.description ? (
          <Text className="mt-4 text-base text-slate-600">{habit.description}</Text>
        ) : null}

        <View className="mt-6 flex-row gap-3">
          <StatCard label="Current streak" value={`🔥 ${formatStreak(streak.current)}`} />
          <StatCard label="Longest streak" value={`🏆 ${formatStreak(streak.longest)}`} />
        </View>

        <Text className="mb-3 mt-8 text-base font-semibold text-slate-900">
          Last {WEEKS_SHOWN} weeks
        </Text>
        <HistoryGrid completedDates={completedDates ?? []} today={todayLocalISO()} color={color} />

        {error ? (
          <View testID="detail-error" className="mt-6 rounded-xl bg-red-50 px-4 py-3">
            <Text className="text-sm text-red-700">{error}</Text>
          </View>
        ) : null}

        <View className="mt-8">
          <Button
            title="Delete habit"
            variant="danger"
            loading={deleting}
            onPress={confirmDelete}
            testID="delete-habit-button"
          />
        </View>
      </ScrollView>
    </Screen>
  );
}
