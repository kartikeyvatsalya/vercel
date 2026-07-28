/**
 * ── Rehydration guards (Phase 65) ──────────────────────────────────
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
