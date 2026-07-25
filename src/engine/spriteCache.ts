/**
 * LRU Sprite Cache (Phase 56)
 * ─────────────────────────────────────────────────────────────────
 * targetGlyphs.ts bakes offscreen canvases (disk sprites, the M42
 * composite) keyed by a quantized (target, radius/blur) signature, so a
 * continuous zoom or defocus animation doesn't re-run an expensive
 * filter/composite pass every frame. The bug this replaces: both caches
 * used to respond to hitting their entry cap with a blanket `.clear()` —
 * wiping every sprite at once, including whatever radius is ON SCREEN
 * RIGHT NOW. The very next frame then re-bakes that hot entry from
 * scratch (a GPU readback/composite stall), and if the zoom is still
 * moving, the next cap hit clears it right back out again — a stutter
 * loop instead of a cache.
 *
 * A true LRU only evicts the single ENTRY nobody has touched in the
 * longest time, so whatever radius is actually being drawn this frame
 * (touched by `get` every time it's blitted) stays resident regardless
 * of how many other radii cycle through during a zoom.
 *
 * Built on `Map`'s guaranteed insertion-order iteration: native
 * `Map.prototype.set` on an EXISTING key updates its value in place
 * WITHOUT moving it — so recency tracking needs an explicit delete+re-set
 * "touch" on both read and write, which is what this class adds. The
 * least-recently-used entry is then always whichever key iterates first.
 */
export class LRUCache<K, V> {
  private readonly map = new Map<K, V>();
  private readonly maxEntries: number;

  constructor(maxEntries: number) {
    this.maxEntries = maxEntries;
  }

  get size(): number {
    return this.map.size;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  /** Reading an entry counts as using it — moves it to the MRU position. */
  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  /**
   * Touches an existing key (moves it to MRU without evicting anything —
   * it's already occupying a slot). For a genuinely new key at capacity,
   * evicts only the single oldest entry — the first key Map iterates —
   * never the whole cache.
   */
  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxEntries) {
      const oldestKey = this.map.keys().next().value as K | undefined;
      if (oldestKey !== undefined) this.map.delete(oldestKey);
    }
    this.map.set(key, value);
  }

  clear(): void {
    this.map.clear();
  }
}
