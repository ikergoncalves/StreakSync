import { becameCompleted, streakIncreased } from '../animationTriggers';

describe('becameCompleted', () => {
  it('fires only on the not-done → done transition', () => {
    expect(becameCompleted(false, true)).toBe(true);
  });

  it('does not fire on first render, even for an already-completed habit', () => {
    // A list mounting with checked habits must not bounce every checkmark.
    expect(becameCompleted(undefined, true)).toBe(false);
    expect(becameCompleted(undefined, false)).toBe(false);
  });

  it('does not fire when nothing changed', () => {
    expect(becameCompleted(true, true)).toBe(false);
    expect(becameCompleted(false, false)).toBe(false);
  });

  it('does not fire on un-completing', () => {
    expect(becameCompleted(true, false)).toBe(false);
  });
});

describe('streakIncreased', () => {
  it('fires when the streak grows, including from zero', () => {
    expect(streakIncreased(0, 1)).toBe(true);
    expect(streakIncreased(3, 4)).toBe(true);
  });

  it('does not fire on first render', () => {
    expect(streakIncreased(undefined, 5)).toBe(false);
  });

  it('does not fire on unrelated re-renders (same value)', () => {
    expect(streakIncreased(3, 3)).toBe(false);
    expect(streakIncreased(0, 0)).toBe(false);
  });

  it('does not fire when a streak resets or shrinks', () => {
    expect(streakIncreased(5, 0)).toBe(false);
    expect(streakIncreased(4, 3)).toBe(false);
  });
});
