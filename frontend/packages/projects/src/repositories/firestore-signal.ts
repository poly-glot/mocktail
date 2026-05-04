import { DestroyRef, Signal, WritableSignal, effect, inject, signal } from '@angular/core';

/**
 * Wrap a Firestore-style `onSnapshot` subscription as a Signal. The supplied
 * `subscribe` factory is called inside an `effect`, so any signals it reads
 * (e.g. a reactive `tid`) trigger a re-subscription with proper cleanup of
 * the prior listener. The signal resets to `initial` on each re-subscribe.
 *
 * Returning `null` from `subscribe` skips subscription for that pass — useful
 * when required ids are still empty. The final unsubscribe runs via
 * `DestroyRef`, so callers don't need manual `OnDestroy` plumbing.
 *
 * Must be called inside an injection context (component/service constructor
 * or factory).
 */
export function firestoreSignal<T>(
  initial: T,
  subscribe: (next: (value: T) => void) => (() => void) | null,
): Signal<T> {
  const sig: WritableSignal<T> = signal(initial);
  let unsub: (() => void) | null = null;
  effect(() => {
    unsub?.();
    sig.set(initial);
    unsub = subscribe((v) => sig.set(v));
  });
  inject(DestroyRef).onDestroy(() => unsub?.());
  return sig.asReadonly();
}
