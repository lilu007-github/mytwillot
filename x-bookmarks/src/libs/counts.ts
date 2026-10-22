/**
 * Look up a per-name count. Names are user text, so a plain `counts[name]`
 * would return Object.prototype members for names like "valueOf" or
 * "constructor" (Solid store objects keep a normal prototype).
 */
export function countFor(counts: Record<string, number>, name: string) {
  return Object.hasOwn(counts, name) ? counts[name] : 0
}
