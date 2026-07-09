/**
 * Fast, non-cryptographic FNV-1a content hash, hex-encoded.
 * Used for incremental-sync manifests (vault direct-write and Obsidian REST)
 * to detect unchanged notes. The two consumers MUST share this exact
 * implementation — diverging hashes silently desync their manifests.
 */
export function fnv1aHex(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}
