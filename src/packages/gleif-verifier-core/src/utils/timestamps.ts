/** current ISO timestamp */
export function isoTimestamp(): string {
  return new Date().toISOString();
}

/**
 * ISO timestamp with microsecond precision for KERI.
 * KERI expects: 2024-01-01T00:00:00.000000+00:00
 */
export function keriTimestamp(): string {
  return new Date().toISOString().replace('Z', '000+00:00');
}

/** format timestamp for display */
export function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}
