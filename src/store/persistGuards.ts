import type { PersistStorage, StorageValue } from 'zustand/middleware';
import { shallow } from 'zustand/vanilla/shallow';

/**
 * ── Rehydration guards (Phase 65; widened Phase 66) ─────────────────
 * Shared by every persisted store's `merge` function. Stale builds, manual
 * localStorage edits, or a field that's since changed shape can all hand
 * back a value the live math engines never expect — and critically, a
 * value that was `NaN` in memory round-trips through `JSON.stringify` as
 * `null` (JSON has no NaN literal), so "corrupted" numeric state is not a
 * hypothetical, it's what a stale snapshot looks like by default. None of
 * the optical/canvas math downstream guards against NaN itself (Math.min/
 * Math.max both propagate it rather than clamping it away), so every
 * persisted numeric or enum field is re-validated here, once, before it
 * ever reaches render code.
 */

/** `value` if it's a finite number within [min, max]; otherwise `fallback`. */
export function sanitizeNumber(
  value: unknown,
  fallback: number,
  min = -Infinity,
  max = Infinity
): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : fallback;
}

/** `value` if it's one of `allowed`; otherwise `fallback`. */
export function sanitizeEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** `value` if it's a real boolean; otherwise `fallback` (a saved "true" string is not a boolean). */
export function sanitizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** A plain object (not null, not an array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** De-duplicated strings from an array, optionally restricted to `allowed`; anything else → []. */
export function sanitizeStringArray(value: unknown, allowed?: readonly string[]): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== 'string' || out.includes(v)) continue;
    if (allowed && !allowed.includes(v)) continue;
    out.push(v);
  }
  return out;
}

/**
 * Copies ONLY the listed keys out of an untrusted persisted snapshot. A blind
 * `{ ...currentState, ...persisted }` lets any saved key — an old field, a
 * hand-edited one, or one named like an action — overwrite live state, up to
 * and including replacing a store action with a string.
 */
export function pickPersisted<T extends object>(persisted: unknown, keys: readonly (keyof T & string)[]): Partial<T> {
  if (!isRecord(persisted)) return {};
  const out: Partial<T> = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(persisted, key)) {
      (out as Record<string, unknown>)[key] = persisted[key];
    }
  }
  return out;
}

// ── Persistence storage (Phase 66) ──────────────────────────────────
// zustand's persist middleware calls storage.setItem after EVERY set() on a
// persisted store — partialize only trims what is written, not whether it is
// written — so a 60 fps pointing write (D-pad slew, 3D tube drag, droop) was
// serializing the whole instrument to localStorage every frame, and a
// throwing setItem (quota, blocked storage) propagated straight into
// whichever caller did the set(): inside a render loop, that stopped the
// loop for good. This adapter:
//   • skips serialization entirely when no persisted field changed
//     (shallow compare of the partialized snapshot — zustand keeps unchanged
//     field references stable, so a pointing-only update compares equal);
//   • skips the write when the JSON is identical to what is already stored;
//   • optionally COALESCES bursts (a slider drag) into one trailing write
//     per `coalesceMs`, flushed early on pagehide / tab-hidden so a normal
//     close or tab switch never loses the latest value. Only an abrupt crash
//     inside that window can lose it — at most `coalesceMs` of changes;
//   • never throws: read/parse/write failures are logged once per key and the
//     app carries on with in-memory state. A failed write is retried on the
//     next change of that store's persisted data, not on every set().

const warned = new Set<string>();
function warnOnce(key: string, message: string, error?: unknown): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[persist] ${message}`, error ?? '');
}

function getLocalStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

const pendingFlushers = new Set<() => void>();
let lifecycleHooked = false;
function hookPageLifecycle(): void {
  if (lifecycleHooked || typeof window === 'undefined') return;
  lifecycleHooked = true;
  const flushAll = () => pendingFlushers.forEach((flush) => flush());
  window.addEventListener('pagehide', flushAll);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAll();
  });
}

export interface PersistStorageOptions {
  /** Trailing-write window for bursty stores; 0 writes each real change immediately. */
  coalesceMs?: number;
}

export function createPersistStorage<S>(options: PersistStorageOptions = {}): PersistStorage<S> {
  const coalesceMs = options.coalesceMs ?? 0;
  const lastState = new Map<string, S>();
  const lastJson = new Map<string, string>();
  const pending = new Map<string, StorageValue<S>>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const write = (name: string, value: StorageValue<S>) => {
    const storage = getLocalStorage();
    if (!storage) {
      warnOnce('unavailable', 'localStorage is unavailable; settings will not be saved this session.');
      return;
    }
    let json: string;
    try {
      json = JSON.stringify(value);
    } catch (error) {
      warnOnce(`stringify:${name}`, `Could not serialize "${name}".`, error);
      return;
    }
    if (lastJson.get(name) === json) return;
    try {
      storage.setItem(name, json);
      lastJson.set(name, json);
    } catch (error) {
      warnOnce(`write:${name}`, `Could not save "${name}" (storage full or blocked); continuing without saving.`, error);
    }
  };

  const flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending.size === 0) return;
    const entries = [...pending];
    pending.clear();
    for (const [name, value] of entries) write(name, value);
  };

  if (coalesceMs > 0) {
    pendingFlushers.add(flush);
    hookPageLifecycle();
  }

  return {
    getItem: (name) => {
      const storage = getLocalStorage();
      if (!storage) return null;
      let raw: string | null;
      try {
        raw = storage.getItem(name);
      } catch {
        return null;
      }
      if (raw === null) return null;
      try {
        const parsed = JSON.parse(raw) as StorageValue<S>;
        lastJson.set(name, raw);
        // Shape is validated by each store's own merge.
        return parsed;
      } catch (error) {
        warnOnce(`parse:${name}`, `Ignoring unreadable saved "${name}".`, error);
        return null;
      }
    },
    setItem: (name, value) => {
      const previous = lastState.get(name);
      if (previous !== undefined && shallow(previous, value.state)) return;
      lastState.set(name, value.state);
      if (coalesceMs <= 0) {
        write(name, value);
        return;
      }
      pending.set(name, value);
      if (timer === null) timer = setTimeout(flush, coalesceMs);
    },
    removeItem: (name) => {
      pending.delete(name);
      lastState.delete(name);
      lastJson.delete(name);
      try {
        getLocalStorage()?.removeItem(name);
      } catch {
        /* blocked storage — nothing to remove */
      }
    },
  };
}
