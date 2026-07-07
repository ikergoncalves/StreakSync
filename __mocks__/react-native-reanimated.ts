/**
 * Jest auto-mock for react-native-reanimated (picked up from this root
 * __mocks__ folder for all tests). The official `react-native-reanimated/
 * mock` can't be used here: it imports the real `src/index`, whose worklets
 * initialization crashes under Jest. This lean mock mirrors the same ideas —
 * Animated.View/Text render as plain RN components, shared values are plain
 * objects, `with*` resolve to their target value synchronously — for just
 * the API surface this app uses. Animated output is deliberately not
 * assertable; only the pure trigger logic in src/lib/animationTriggers.ts
 * is unit tested.
 */
import { Text, View } from 'react-native';

type AnimatableValue = number | string;

/** Chainable stand-in for entering/exiting builders like FadeInDown. */
class AnimationBuilderMock {
  duration() {
    return this;
  }

  delay() {
    return this;
  }

  springify() {
    return this;
  }

  damping() {
    return this;
  }

  stiffness() {
    return this;
  }

  easing() {
    return this;
  }

  build() {
    return () => ({ initialValues: {}, animations: {} });
  }
}

export default {
  View,
  Text,
  createAnimatedComponent: <T>(component: T) => component,
};

export const useSharedValue = <Value>(initial: Value) => ({ value: initial });
export const useAnimatedStyle = <Style>(factory: () => Style) => factory();
export const withSpring = (toValue: AnimatableValue) => toValue;
export const withTiming = (toValue: AnimatableValue) => toValue;
export const withSequence = (...animations: AnimatableValue[]) =>
  animations[animations.length - 1];
export const withDelay = (_delayMs: number, animation: AnimatableValue) => animation;
export const cancelAnimation = () => {};
export const runOnJS = <T>(fn: T) => fn;

export const FadeIn = new AnimationBuilderMock();
export const FadeInDown = new AnimationBuilderMock();
export const FadeInUp = new AnimationBuilderMock();
export const FadeOut = new AnimationBuilderMock();
