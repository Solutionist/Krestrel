export interface BackoffOptions {
  baseMs?: number;
  capMs?: number;
  random?: () => number;
}

/**
 * Exponential backoff with full jitter: a uniform delay in [0, min(cap, base * 2^attempt)).
 * Full jitter spreads reconnects so a flapping upstream is not hit in lockstep.
 */
export function backoffDelay(attempt: number, opts: BackoffOptions = {}): number {
  const { baseMs = 1_000, capMs = 60_000, random = Math.random } = opts;
  const ceiling = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.floor(random() * ceiling);
}
