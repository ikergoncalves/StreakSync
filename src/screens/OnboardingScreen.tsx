import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useRef, useState } from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { Button } from '../components/Button';
import { Screen } from '../components/Screen';
import { markOnboardingSeen } from '../lib/onboarding';
import { AppStackParamList } from '../navigation/types';

export const ONBOARDING_SLIDES = [
  {
    key: 'welcome',
    emoji: '🔥',
    title: 'Welcome to StreakSync',
    body: 'The habit tracker that keeps your streaks alive, together — online or offline.',
  },
  {
    key: 'habits',
    emoji: '✅',
    title: 'Build habits, grow streaks',
    body: 'Create daily or weekly habits and check them off from the Today tab. Every day you show up, your streak grows.',
  },
  {
    key: 'groups',
    emoji: '👥',
    title: 'Better together',
    body: 'Join groups with friends, watch their check-ins land in real time, and climb the leaderboard. Accountability works.',
  },
  {
    key: 'start',
    emoji: '🚀',
    title: 'Ready to start?',
    body: "Create your first habit and keep the flame burning — we'll remind you in the evening if you haven't checked in.",
  },
] as const;

interface OnboardingPagerProps {
  /** Called when the user skips or finishes the intro. */
  onDone: () => void;
}

/**
 * The intro itself: a paged horizontal ScrollView (no pager dependency —
 * `pagingEnabled` plus fixed-width slides is all this needs). Purely
 * presentational: what dismissing means (marking the seen flag or just
 * going back) is the caller's decision via `onDone`.
 */
function OnboardingPager({ onDone }: OnboardingPagerProps) {
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const isLast = index === ONBOARDING_SLIDES.length - 1;

  // Keeps the dots in sync when the user swipes instead of tapping Next.
  const handleMomentumEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setIndex(Math.round(event.nativeEvent.contentOffset.x / width));
  };

  const goToNext = () => {
    const next = Math.min(index + 1, ONBOARDING_SLIDES.length - 1);
    setIndex(next);
    scrollRef.current?.scrollTo({ x: next * width, animated: true });
  };

  return (
    <Screen>
      <View className="h-12 flex-row items-center justify-end px-6">
        {isLast ? null : (
          <Pressable
            testID="onboarding-skip-button"
            accessibilityRole="button"
            accessibilityLabel="Skip intro"
            hitSlop={8}
            onPress={onDone}
          >
            <Text className="text-sm font-medium text-slate-500 dark:text-slate-400">Skip</Text>
          </Pressable>
        )}
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleMomentumEnd}
        className="flex-1"
      >
        {ONBOARDING_SLIDES.map((slide) => (
          <View
            key={slide.key}
            testID={`onboarding-slide-${slide.key}`}
            style={{ width }}
            className="items-center justify-center px-10"
          >
            <Text className="text-7xl">{slide.emoji}</Text>
            <Text className="mt-6 text-center text-2xl font-bold text-slate-900 dark:text-slate-50">
              {slide.title}
            </Text>
            <Text className="mt-3 text-center text-base leading-6 text-slate-500 dark:text-slate-400">
              {slide.body}
            </Text>
          </View>
        ))}
      </ScrollView>

      <View className="mb-4 flex-row items-center justify-center gap-2">
        {ONBOARDING_SLIDES.map((slide, dotIndex) => (
          <View
            key={slide.key}
            className={`h-2 rounded-full ${
              dotIndex === index ? 'w-5 bg-emerald-600' : 'w-2 bg-slate-300 dark:bg-slate-700'
            }`}
          />
        ))}
      </View>

      <View className="px-6 pb-4">
        {isLast ? (
          <Button title="Get started" onPress={onDone} testID="onboarding-get-started-button" />
        ) : (
          <Button title="Next" onPress={goToNext} testID="onboarding-next-button" />
        )}
      </View>
    </Screen>
  );
}

interface FirstRunOnboardingProps {
  /** Invoked after the seen flag is set, so the caller can mount the app. */
  onComplete: () => void;
}

/**
 * The automatic first-run intro, rendered by RootNavigator instead of the
 * app stack while the device hasn't seen it. Any dismissal — skipping on
 * slide 1 or finishing the last slide — marks it seen; it never auto-shows
 * again after that.
 */
export function FirstRunOnboarding({ onComplete }: FirstRunOnboardingProps) {
  const handleDone = () => {
    // Fire-and-forget: entering the app must not wait on a storage write.
    void markOnboardingSeen();
    onComplete();
  };

  return <OnboardingPager onDone={handleDone} />;
}

type Props = NativeStackScreenProps<AppStackParamList, 'Onboarding'>;

/**
 * The "Replay intro" route (Profile screen). A replay is a one-off view: it
 * deliberately never touches the seen flag and simply returns to wherever it
 * was opened from.
 */
export function OnboardingScreen({ navigation }: Props) {
  return <OnboardingPager onDone={() => navigation.goBack()} />;
}
