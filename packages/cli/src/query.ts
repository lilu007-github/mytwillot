import type { AgentTweet } from 'utils/agent-mirror'

import { UsageError } from './data'

export type SortOrder = 'date' | 'relevance' | 'engagement'

export interface Filters {
  /** bookmarks / likes / posts / replies / media, or "all" (default). */
  category?: string
  /** Folder path; also matches subfolders ("AI" matches "AI/LLM"). */
  folder?: string
  /** Only items without a folder. */
  unsorted?: boolean
  tag?: string
  untagged?: boolean
  /** Screen name, with or without @. */
  author?: string
  /** "7d", "2w", "3m", "1y", "2026-01-01" or "2026-01". */
  since?: string
  until?: string
  has?: 'media' | 'link' | 'thread' | 'quote'
}

export interface SearchOptions extends Filters {
  query?: string
  sort?: SortOrder
  limit?: number
  offset?: number
}

export interface SearchResult {
  total: number
  offset: number
  items: AgentTweet[]
}

const DAY = 86_400_000

/**
 * Parse a relative ("30d", "2w", "6m", "1y") or absolute ("2026-01-01",
 * "2026-01") date. `end` makes an absolute date inclusive of its whole day or
 * month. Returns epoch ms.
 */
export function parseDate(value: string, end = false, now = Date.now()) {
  const rel = /^(\d+)\s*([dwmy])$/i.exec(value.trim())
  if (rel) {
    const n = Number(rel[1])
    const unit = rel[2].toLowerCase()
    const d = new Date(now)
    if (unit === 'd') return now - n * DAY
    if (unit === 'w') return now - n * 7 * DAY
    if (unit === 'm') return d.setUTCMonth(d.getUTCMonth() - n)
    return d.setUTCFullYear(d.getUTCFullYear() - n)
  }
  const abs = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value.trim())
  if (abs) {
    const [, y, m, day] = abs.map(Number)
    if (day) {
      return Date.UTC(y, m - 1, day + (end ? 1 : 0)) - (end ? 1 : 0)
    }
    return Date.UTC(y, m - 1 + (end ? 1 : 0), 1) - (end ? 1 : 0)
  }
  throw new UsageError(
    `Bad date "${value}". Use 7d / 2w / 3m / 1y, YYYY-MM-DD or YYYY-MM.`,
  )
}

interface ParsedQuery {
  terms: string[]
  excluded: string[]
  from: string[]
  since?: string
  until?: string
}

/** Words / "quoted phrases", -excluded, from:user, since:, until:. */
export function parseQuery(query = ''): ParsedQuery {
  const parsed: ParsedQuery = { terms: [], excluded: [], from: [] }
  const tokens = query.match(/-?"[^"]*"|\S+/g) || []
  for (const raw of tokens) {
    const negative = raw.startsWith('-') && raw.length > 1
    const token = (negative ? raw.slice(1) : raw).replace(/^"|"$/g, '')
    const op = /^(from|since|until):(.+)$/i.exec(token)
    if (op && !negative) {
      const key = op[1].toLowerCase()
      if (key === 'from')
        parsed.from.push(op[2].replace(/^@/, '').toLowerCase())
      else parsed[key as 'since' | 'until'] = op[2]
      continue
    }
    if (!token) continue
    ;(negative ? parsed.excluded : parsed.terms).push(token.toLowerCase())
  }
  return parsed
}

export function haystack(t: AgentTweet) {
  return [
    t.text,
    ...t.thread,
    t.quoted?.text,
    t.quoted?.author,
    t.author.name,
    t.author.screen_name,
    t.folder,
    ...t.tags,
    ...t.ai_tags,
    t.ai_summary,
    t.note,
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase()
}

function count(hay: string, term: string) {
  let n = 0
  for (let i = hay.indexOf(term); i !== -1; i = hay.indexOf(term, i + 1)) n++
  return n
}

export function engagement(t: AgentTweet) {
  const m = t.metrics
  return m.likes + 2 * m.retweets + 2 * m.quotes + m.replies + m.bookmarks
}

export function applyFilters(tweets: AgentTweet[], f: Filters): AgentTweet[] {
  const category = f.category && f.category !== 'all' ? f.category : null
  const folder = f.folder?.toLowerCase().replace(/\/+$/, '')
  const tag = f.tag?.toLowerCase()
  const author = f.author?.replace(/^@/, '').toLowerCase()
  const since = f.since ? parseDate(f.since) : -Infinity
  const until = f.until ? parseDate(f.until, true) : Infinity

  return tweets.filter((t) => {
    if (category && t.category !== category) return false
    if (f.unsorted && t.folder) return false
    if (folder) {
      const path = t.folder?.toLowerCase()
      if (!path || (path !== folder && !path.startsWith(folder + '/'))) {
        return false
      }
    }
    if (f.untagged && t.tags.length) return false
    if (tag && !t.tags.some((x) => x.toLowerCase() === tag)) return false
    if (author && t.author.screen_name.toLowerCase() !== author) return false
    const at = Date.parse(t.created_at)
    if (at < since || at > until) return false
    if (f.has === 'media' && !t.media.length) return false
    if (f.has === 'thread' && !t.thread.length) return false
    if (f.has === 'quote' && !t.quoted) return false
    if (f.has === 'link' && !/https?:\/\//.test(t.text)) return false
    return true
  })
}

const CATEGORY_RANK: Record<string, number> = { bookmarks: 0, likes: 1 }

/**
 * One entry per tweet: a tweet can be both bookmarked and liked. Keeps the
 * bookmark copy (it carries folder/tags), else the first seen; order kept.
 */
export function dedupe(tweets: AgentTweet[]): AgentTweet[] {
  const best = new Map<string, AgentTweet>()
  for (const t of tweets) {
    const prev = best.get(t.id)
    const rank = (x: AgentTweet) => CATEGORY_RANK[x.category] ?? 2
    if (!prev || rank(t) < rank(prev)) best.set(t.id, t)
  }
  return tweets.filter((t) => best.get(t.id) === t)
}

/**
 * Full-text matcher (the SQLite FTS5 index): `${category}\0${id}` →
 * relevance, higher is better; null when the terms can't be indexed.
 */
export type FtsSearch = (terms: string[]) => Map<string, number> | null

export function searchTweets(
  tweets: AgentTweet[],
  opts: SearchOptions,
  fts?: FtsSearch | null,
): SearchResult {
  const q = parseQuery(opts.query)
  const hits = q.terms.length && fts ? fts(q.terms) : null
  // A category filter already yields one entry per tweet; deduping first
  // would drop e.g. a liked tweet whose bookmark copy was kept instead.
  const pool =
    opts.category && opts.category !== 'all' ? tweets : dedupe(tweets)
  const filtered = applyFilters(pool, {
    ...opts,
    since: opts.since || q.since,
    until: opts.until || q.until,
  })

  const scored: { t: AgentTweet; score: number }[] = []
  for (const t of filtered) {
    if (q.from.length && !q.from.includes(t.author.screen_name.toLowerCase())) {
      continue
    }
    if (!q.terms.length && !q.excluded.length) {
      scored.push({ t, score: 0 })
      continue
    }
    const hay = haystack(t)
    if (q.excluded.some((term) => hay.includes(term))) continue
    let score = 0
    let all = true
    for (const term of q.terms) {
      const n = count(hay, term)
      if (!n) {
        all = false
        break
      }
      score += n
    }
    // Full-text hits rank by bm25 first. Substring-only matches (e.g. part
    // of a longer Chinese word) still count, ranked after them.
    const ftsScore = hits?.get(`${t.category}\u0000${t.id}`)
    if (ftsScore !== undefined) {
      scored.push({ t, score: 1e6 + ftsScore * 1000 + score })
    } else if (all) {
      scored.push({ t, score })
    }
  }

  const sort = opts.sort || (q.terms.length ? 'relevance' : 'date')
  const byDate = (a: AgentTweet, b: AgentTweet) =>
    b.created_at.localeCompare(a.created_at)
  scored.sort((a, b) => {
    if (sort === 'relevance') return b.score - a.score || byDate(a.t, b.t)
    if (sort === 'engagement') {
      return engagement(b.t) - engagement(a.t) || byDate(a.t, b.t)
    }
    return byDate(a.t, b.t)
  })

  const offset = Math.max(0, opts.offset || 0)
  const limit = Math.max(1, opts.limit || 20)
  return {
    total: scored.length,
    offset,
    items: scored.slice(offset, offset + limit).map((s) => s.t),
  }
}

export function getTweets(tweets: AgentTweet[], ids: string[]) {
  const wanted = new Set(
    ids.map((id) => /status\/([^/?#]+)/.exec(id)?.[1] || id.trim()),
  )
  return dedupe(tweets).filter((t) => wanted.has(t.id))
}
