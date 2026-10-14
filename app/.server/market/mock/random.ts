// Deterministic randomness for the mock provider: same seed → same prices, on any machine.

/** mulberry32: tiny, fast, good-enough PRNG. Returns floats in [0, 1). */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a 32-bit hash of a symbol; stable per symbol. */
export function hashSymbol(symbol: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < symbol.length; i++) {
    hash ^= symbol.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Stateless hash of integers to a float in [0, 1); lets history be computed for any minute directly. */
export function hashToUnit(...values: number[]): number {
  let hash = 0x9e3779b9;
  for (const value of values) {
    hash = Math.imul(hash ^ (value | 0), 0x85ebca6b);
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 0xc2b2ae35);
    hash ^= hash >>> 16;
  }
  return (hash >>> 0) / 4294967296;
}

/** Deterministic per-symbol reference price in [20, 500). */
export function basePrice(symbol: string): number {
  return 20 + (hashSymbol(symbol) % 48_000) / 100;
}
