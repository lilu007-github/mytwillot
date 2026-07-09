/**
 * Circle (圈子) clustering for the people you follow.
 *
 * Pure, dependency-free functions so they can be unit-tested and run in any
 * context (no chrome / IndexedDB imports here). The data-access layer feeds
 * these `CircleMember[]` (StoredUser is structurally assignable) plus, for the
 * graph mode, the follow-edges passively captured into the `users` table.
 */

export interface CircleMember {
  rest_id: string
  name: string
  screen_name: string
  profile_image_url_https: string
  description: string
  location: string
  is_blue_verified: boolean
}

export type CircleKind = 'mutual' | 'topic' | 'location' | 'graph'

export interface Circle {
  /** Stable id, unique within a kind. */
  id: string
  label: string
  kind: CircleKind
  members: CircleMember[]
}

// ---------------------------------------------------------------------------
// Mutuals — people you follow who also follow you back.
// ---------------------------------------------------------------------------

export function mutualCircle(
  following: CircleMember[],
  followerIds: Set<string>,
): Circle {
  const members = following.filter((u) => followerIds.has(u.rest_id))
  return { id: 'mutuals', label: 'Mutuals', kind: 'mutual', members }
}

// ---------------------------------------------------------------------------
// Location — group by normalized, non-empty location string.
// ---------------------------------------------------------------------------

/** Lowercase, trim, collapse whitespace. Keeps it simple + deterministic. */
export function normalizeLocation(raw: string): string {
  return (raw || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

export function clusterByLocation(
  following: CircleMember[],
  minSize = 2,
): Circle[] {
  const groups = new Map<string, { label: string; members: CircleMember[] }>()
  for (const u of following) {
    const key = normalizeLocation(u.location)
    if (!key) continue
    if (!groups.has(key)) {
      // Preserve the first-seen original casing for display.
      groups.set(key, { label: u.location.trim(), members: [] })
    }
    groups.get(key)!.members.push(u)
  }
  return [...groups.entries()]
    .filter(([, g]) => g.members.length >= minSize)
    .sort((a, b) => b[1].members.length - a[1].members.length)
    .map(([key, g]) => ({
      id: `loc:${key}`,
      label: g.label,
      kind: 'location' as const,
      members: g.members,
    }))
}

// ---------------------------------------------------------------------------
// Topic — keyword/hashtag frequency across bios. A user can land in several
// topic circles (topics overlap), which is expected.
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  'the', 'and', 'for', 'you', 'your', 'with', 'that', 'this', 'are', 'was',
  'have', 'has', 'not', 'but', 'all', 'can', 'get', 'out', 'from', 'they',
  'our', 'his', 'her', 'their', 'about', 'into', 'over', 'more', 'most',
  'just', 'like', 'love', 'life', 'here', 'there', 'what', 'who', 'how',
  'why', 'when', 'where', 'https', 'http', 'com', 'www', 'account', 'official',
  'former', 'ceo', 'founder', 'lead', 'head', 'team', 'world', 'people',
  'making', 'building', 'helping', 'working', 'sharing', 'views', 'own',
  'opinions', 'tweets', 'posts', 'follow', 'following', 'dm', 'dms', 'inc',
  'llc', 'org', 'net', 'new', 'now', 'day', 'one', 'two', 'via', 'per',
])

/** Extract candidate topic tokens (words + #hashtags) from a bio. */
export function extractTopicTokens(description: string): string[] {
  if (!description) return []
  const tokens = new Set<string>()
  // Hashtags carry the strongest topic signal.
  for (const m of description.matchAll(/#(\w{2,30})/g)) {
    tokens.add(m[1].toLowerCase())
  }
  // Plain words: ascii letters, length 3..20, not a stopword.
  for (const m of description.matchAll(/[a-zA-Z]{3,20}/g)) {
    const w = m[0].toLowerCase()
    if (!STOPWORDS.has(w)) tokens.add(w)
  }
  return [...tokens]
}

export function clusterByTopic(
  following: CircleMember[],
  opts: { minSize?: number; maxTopics?: number } = {},
): Circle[] {
  const minSize = opts.minSize ?? 3
  const maxTopics = opts.maxTopics ?? 24

  // token -> members that mention it
  const byToken = new Map<string, CircleMember[]>()
  for (const u of following) {
    for (const tok of extractTopicTokens(u.description)) {
      if (!byToken.has(tok)) byToken.set(tok, [])
      byToken.get(tok)!.push(u)
    }
  }

  return [...byToken.entries()]
    .filter(([, members]) => members.length >= minSize)
    .sort((a, b) =>
      b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1),
    )
    .slice(0, maxTopics)
    .map(([token, members]) => ({
      id: `topic:${token}`,
      label: `#${token}`,
      kind: 'topic' as const,
      members,
    }))
}

// ---------------------------------------------------------------------------
// Graph — community detection on passively-captured mutual-follow edges,
// restricted to the induced subgraph over the people you follow.
// ---------------------------------------------------------------------------

/**
 * Deterministic synchronous label propagation. Undirected: each edge [a, b]
 * links both ways. Nodes are processed in sorted order and adopt the most
 * common label among neighbours, tie-broken by smallest label id, so results
 * are reproducible (important for tests and stable UI).
 */
export function detectCommunities(
  nodeIds: string[],
  edges: Array<[string, string]>,
  maxIterations = 20,
): string[][] {
  const nodes = [...new Set(nodeIds)].sort()
  const adj = new Map<string, Set<string>>()
  for (const id of nodes) adj.set(id, new Set())
  for (const [a, b] of edges) {
    if (a === b) continue
    if (adj.has(a) && adj.has(b)) {
      adj.get(a)!.add(b)
      adj.get(b)!.add(a)
    }
  }

  const label = new Map<string, string>()
  for (const id of nodes) label.set(id, id)

  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false
    for (const id of nodes) {
      const neighbours = adj.get(id)!
      if (neighbours.size === 0) continue
      const counts = new Map<string, number>()
      for (const n of neighbours) {
        const l = label.get(n)!
        counts.set(l, (counts.get(l) ?? 0) + 1)
      }
      let best = label.get(id)!
      let bestCount = -1
      for (const [l, c] of counts) {
        if (c > bestCount || (c === bestCount && l < best)) {
          best = l
          bestCount = c
        }
      }
      if (best !== label.get(id)) {
        label.set(id, best)
        changed = true
      }
    }
    if (!changed) break
  }

  const communities = new Map<string, string[]>()
  for (const id of nodes) {
    const l = label.get(id)!
    if (!communities.has(l)) communities.set(l, [])
    communities.get(l)!.push(id)
  }
  return [...communities.values()]
    .map((g) => g.sort())
    .sort((a, b) => b.length - a.length)
}

/**
 * Build graph-based circles from captured internal follow edges. Only members
 * with at least one internal edge participate; isolated follows are dropped
 * (they show up under the other clustering modes instead).
 */
export function graphCircles(
  following: CircleMember[],
  edges: Array<[string, string]>,
  minSize = 3,
): Circle[] {
  const byId = new Map(following.map((u) => [u.rest_id, u]))
  // Keep only edges whose both endpoints are people you follow.
  const internal = edges.filter(([a, b]) => byId.has(a) && byId.has(b))
  const connectedIds = new Set<string>()
  for (const [a, b] of internal) {
    connectedIds.add(a)
    connectedIds.add(b)
  }
  const communities = detectCommunities([...connectedIds], internal)
  return communities
    .filter((g) => g.length >= minSize)
    .map((g, i) => {
      const members = g.map((id) => byId.get(id)!).filter(Boolean)
      // Label the circle after its most-followed / most-notable member.
      const anchor = members
        .slice()
        .sort((x, y) => y.name.length - x.name.length)[0]
      return {
        id: `graph:${i}`,
        label: anchor ? `${anchor.name}'s circle` : `Circle ${i + 1}`,
        kind: 'graph' as const,
        members,
      }
    })
}
