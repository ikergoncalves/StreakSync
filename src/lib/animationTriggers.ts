/**
 * Pure "should this animation fire?" predicates for the Phase 6
 * micro-interactions. Kept free of Reanimated so the trigger logic is unit
 * testable: components track the previous value in a ref and consult these
 * on change, which guarantees an animation only plays when the underlying
 * value actually moved — never on unrelated re-renders or on first mount.
 *
 * `previous === undefined` means "first render": nothing changed from the
 * user's point of view, so nothing animates (e.g. a list mounting with
 * already-completed habits must not bounce every checkmark).
 */

/** True when a habit just went from not-done to done. */
export function becameCompleted(previous: boolean | undefined, current: boolean): boolean {
  return previous === false && current;
}

/** True when a streak counter increased. Resets/decreases never pulse. */
export function streakIncreased(previous: number | undefined, current: number): boolean {
  return previous !== undefined && current > previous;
}
