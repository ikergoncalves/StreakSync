// Tiny observable holding the device's connectivity, deliberately free of
// native imports: NetInfo events are piped in by useNetworkStatusMonitor
// (hooks/useIsOnline.ts), and everything else — the habits store's drain
// gating, the useIsOnline hook, the reconnect sync trigger — reads or
// subscribes here. Tests drive it directly with setOnlineStatus.

type OnlineListener = (isOnline: boolean) => void;

// Optimistic default: before the first NetInfo event arrives the app behaves
// as online, and the first real network failure is handled gracefully anyway
// (network errors are transient to the sync engine).
let online = true;
const listeners = new Set<OnlineListener>();

export function getIsOnline(): boolean {
  return online;
}

/** Notifies subscribers only on actual transitions. */
export function setOnlineStatus(next: boolean): void {
  if (next === online) {
    return;
  }
  online = next;
  for (const listener of [...listeners]) {
    listener(next);
  }
}

export function subscribeOnlineStatus(listener: OnlineListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
