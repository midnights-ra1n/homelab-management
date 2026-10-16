/*
 * Data cache for React 19 use(): the pages kept the shape of the Next.js server components
 * (Suspense + data calls); each call returns the same promise until a write invalidates the
 * cache, which re-renders the app in a transition (the old screen stays until data is ready),
 * like revalidatePath("/", "layout") did.
 */
import { startTransition } from "react";

const cache = new Map<string, Promise<unknown>>();
const listeners = new Set<() => void>();

export function resource<T>(key: string, load: () => Promise<T>): Promise<T> {
  let p = cache.get(key) as Promise<T> | undefined;
  if (!p) {
    p = load();
    cache.set(key, p);
    // A failed load is retried on the next render instead of staying cached.
    p.catch(() => cache.get(key) === p && cache.delete(key));
  }
  return p;
}

export function invalidate() {
  cache.clear();
  startTransition(() => listeners.forEach((l) => l()));
}

export function onInvalidate(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** A value already known, usable with use() without suspending. */
export function resolved<T>(value: T): Promise<T> {
  const p = Promise.resolve(value) as Promise<T> & { status: string; value: T };
  p.status = "fulfilled";
  p.value = value;
  return p;
}
