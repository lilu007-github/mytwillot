/**
 * Corpus statistics and topic trends over time — the "what have I been
 * reading about, and what's rising" view. Term counts are document
 * frequencies (how many tweets mention a term), so one long thread can't
 * dominate a period.
 */
import type { AgentTweet } from 'utils/agent-mirror'

import { applyFilters, dedupe, type Filters } from './query'

export type Period = 'week' | 'month' | 'quarter' | 'year'

export interface Count {
  key: string
  count: number
}

// prettier-ignore
const STOPWORDS = new Set([
  // English
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'had',
  'her', 'was', 'one', 'our', 'out', 'has', 'have', 'his', 'how', 'its', 'let',
  'may', 'new', 'now', 'old', 'see', 'two', 'way', 'who', 'did', 'get', 'got',
  'him', 'she', 'too', 'use', 'that', 'with', 'this', 'from', 'they', 'will',
  'would', 'there', 'their', 'what', 'about', 'which', 'when', 'make', 'like',
  'time', 'just', 'know', 'take', 'into', 'year', 'your', 'good', 'some',
  'could', 'them', 'than', 'then', 'look', 'only', 'come', 'over', 'think',
  'also', 'back', 'after', 'work', 'first', 'well', 'even', 'want', 'because',
  'these', 'give', 'most', 'been', 'were', 'said', 'each', 'does', 'more',
  'here', 'very', 'much', 'many', 'such', 'where', 'why', 'should', 'being',
  'other', 'those', 'while', 'still', 'really', 'every', 'thing', 'things',
  'going', 'doing', 'made', 'need', 'via', 'yes', 'yet', 'own', 'off', 'per',
  'lot', 'today', 'people', 'don', 'doesn', 'didn', 'isn', 'aren', 'wasn',
  'can’t', 'don’t', 'it’s', 'i’m', 'you’re', 'amp',
  'https', 'http', 'www', 'com',
  // 中文
  '的', '了', '是', '在', '我', '你', '他', '她', '它', '们', '这', '那', '就',
  '都', '也', '和', '与', '及', '或', '而', '但', '把', '被', '让', '给', '对',
  '从', '到', '向', '为', '以', '于', '之', '其', '个', '一个', '我们', '你们',
  '他们', '她们', '它们', '自己', '这个', '那个', '这些', '那些', '这样', '那样',
  '什么', '怎么', '如何', '为什么', '因为', '所以', '如果', '但是', '而且', '可以',
  '可能', '没有', '不是', '就是', '还是', '已经', '现在', '时候', '一些', '一下',
  '非常', '真的', '觉得', '知道', '需要', '应该', '还有', '然后', '其实', '只是',
  '这里', '那里', '大家', '今天', '一样', '特别', '比较', '东西', '事情', '感觉',
  '一直', '的话', '起来', '出来', '不会', '不能', '不要', '也是', '都是', '有点',
])

const segmenter = new Intl.Segmenter('zh', { granularity: 'word' })
const HAN = /\p{Script=Han}/u

/** Content words of a text: no URLs, mentions, numbers or stopwords. */
export function tokenize(text: string): string[] {
  const cleaned = text
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[@#][\p{L}\p{N}_]+/gu, ' ')
  const words: string[] = []
  for (const seg of segmenter.segment(cleaned)) {
    if (!seg.isWordLike) continue
    const w = seg.segment.toLowerCase().replace(/^'+|'+$/g, '')
    if (STOPWORDS.has(w) || /^[\p{N}_]+$/u.test(w)) continue
    if (HAN.test(w) ? w.length < 2 : w.length < 3) continue
    words.push(w)
  }
  return words
}

export function hashtags(text: string): string[] {
  return (text.match(/#[\p{L}\p{N}_]+/gu) || []).map((h) => h.toLowerCase())
}

export function periodKey(iso: string, period: Period): string {
  const d = new Date(iso)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  if (period === 'year') return String(y)
  if (period === 'quarter') return `${y}-Q${Math.floor(m / 3) + 1}`
  if (period === 'month') return `${y}-${String(m + 1).padStart(2, '0')}`
  // ISO week (Monday start)
  const day = new Date(Date.UTC(y, m, d.getUTCDate()))
  const dow = day.getUTCDay() || 7
  day.setUTCDate(day.getUTCDate() + 4 - dow)
  const weekYear = day.getUTCFullYear()
  const week = Math.ceil(
    ((day.getTime() - Date.UTC(weekYear, 0, 1)) / 86_400_000 + 1) / 7,
  )
  return `${weekYear}-W${String(week).padStart(2, '0')}`
}

function top(counts: Map<string, number>, n: number): Count[] {
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([key, count]) => ({ key, count }))
}

function bump(map: Map<string, number>, key: string | null | undefined) {
  if (key) map.set(key, (map.get(key) || 0) + 1)
}

function tweetText(t: AgentTweet) {
  return [t.text, ...t.thread].join('\n')
}

export function stats(tweets: AgentTweet[], filters: Filters = {}, n = 10) {
  const all = applyFilters(
    filters.category && filters.category !== 'all' ? tweets : dedupe(tweets),
    filters,
  )
  const byCategory = new Map<string, number>()
  const byMonth = new Map<string, number>()
  const authors = new Map<string, number>()
  const folders = new Map<string, number>()
  const tags = new Map<string, number>()
  let first = ''
  let last = ''
  for (const t of all) {
    bump(byCategory, t.category)
    bump(byMonth, periodKey(t.created_at, 'month'))
    bump(authors, t.author.screen_name)
    bump(folders, t.folder || '(unsorted)')
    t.tags.forEach((tag) => bump(tags, tag))
    if (!first || t.created_at < first) first = t.created_at
    if (!last || t.created_at > last) last = t.created_at
  }
  return {
    total: all.length,
    range: { first: first || null, last: last || null },
    by_category: Object.fromEntries(byCategory),
    by_month: [...byMonth]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, count]) => ({ key, count })),
    top_authors: top(authors, n),
    top_folders: top(folders, n),
    top_tags: top(tags, n),
  }
}

export interface TrendOptions extends Filters {
  period?: Period
  top?: number
}

export interface TrendBucket {
  period: string
  count: number
  top_terms: Count[]
  top_hashtags: Count[]
  top_authors: Count[]
}

export interface RisingTerm {
  term: string
  /** Tweets mentioning it in the latest period. */
  recent: number
  /** Average per earlier period. */
  baseline: number
  growth: number
}

export function trends(tweets: AgentTweet[], opts: TrendOptions = {}) {
  const period = opts.period || 'month'
  const n = opts.top || 10
  const all = applyFilters(
    opts.category && opts.category !== 'all' ? tweets : dedupe(tweets),
    opts,
  )

  const buckets = new Map<
    string,
    {
      count: number
      terms: Map<string, number>
      tags: Map<string, number>
      authors: Map<string, number>
    }
  >()
  for (const t of all) {
    const key = periodKey(t.created_at, period)
    let b = buckets.get(key)
    if (!b) {
      b = { count: 0, terms: new Map(), tags: new Map(), authors: new Map() }
      buckets.set(key, b)
    }
    b.count++
    const text = tweetText(t)
    new Set(tokenize(text)).forEach((w) => bump(b!.terms, w))
    new Set(hashtags(text)).forEach((h) => bump(b!.tags, h))
    bump(b.authors, t.author.screen_name)
  }

  const ordered = [...buckets].sort((a, b) => a[0].localeCompare(b[0]))
  const rising: RisingTerm[] = []
  if (ordered.length >= 2) {
    const [, latest] = ordered[ordered.length - 1]
    const earlier = ordered.slice(0, -1)
    for (const [term, recent] of latest.terms) {
      if (recent < 3) continue
      const before = earlier.reduce(
        (s, [, b]) => s + (b.terms.get(term) || 0),
        0,
      )
      const baseline = before / earlier.length
      const growth = (recent + 1) / (baseline + 1)
      if (growth >= 2) {
        rising.push({
          term,
          recent,
          baseline: Math.round(baseline * 100) / 100,
          growth: Math.round(growth * 100) / 100,
        })
      }
    }
    rising.sort((a, b) => b.growth - a.growth || b.recent - a.recent)
  }

  return {
    period,
    total: all.length,
    buckets: ordered.map(
      ([key, b]): TrendBucket => ({
        period: key,
        count: b.count,
        top_terms: top(b.terms, n),
        top_hashtags: top(b.tags, n),
        top_authors: top(b.authors, n),
      }),
    ),
    rising: rising.slice(0, n),
  }
}
