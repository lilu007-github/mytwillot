import { describe, it, expect } from 'vitest'

import { toAgentTweet } from 'utils/agent-mirror'

import { hashtags, periodKey, stats, tokenize, trends } from './trends'
import { at, storedTweet } from './fixture.test-helper'

describe('tokenize', () => {
  it('keeps content words in English and Chinese', () => {
    const words = tokenize(
      'The new Claude agents are amazing! 我们 正在 研究 大模型 智能体 https://t.co/abc @someone #ai 2026',
    )
    expect(words).toEqual(
      expect.arrayContaining(['claude', 'agents', 'amazing', '研究', '模型']),
    )
    for (const dropped of [
      'the',
      'new',
      'are',
      '我们',
      'https',
      'someone',
      'ai',
      '2026',
    ]) {
      expect(words).not.toContain(dropped)
    }
  })

  it('extracts hashtags separately', () => {
    expect(hashtags('#AI and #大模型 rock')).toEqual(['#ai', '#大模型'])
  })
})

describe('periodKey', () => {
  it.each([
    ['2026-01-01T00:00:00Z', 'week', '2026-W01'],
    ['2027-01-01T00:00:00Z', 'week', '2026-W53'],
    ['2026-05-20T00:00:00Z', 'month', '2026-05'],
    ['2026-05-20T00:00:00Z', 'quarter', '2026-Q2'],
    ['2026-05-20T00:00:00Z', 'year', '2026'],
  ] as const)('%s %s → %s', (iso, period, key) => {
    expect(periodKey(iso, period)).toBe(key)
  })
})

describe('trends', () => {
  const tweet = (month: string, text: string, extra = {}) =>
    toAgentTweet(
      storedTweet({
        full_text: text,
        created_at: at(`2026-${month}-10T00:00:00Z`),
        ...extra,
      }),
    )
  const tweets = [
    tweet('01', 'kubernetes operators deep dive'),
    tweet('01', 'kubernetes networking'),
    tweet('02', 'kubernetes again'),
    tweet('03', 'agents agents agents with claude'),
    tweet('03', 'building agents', { screen_name: 'bob' }),
    tweet('03', 'agents memory design #agents'),
    tweet('03', 'kubernetes is still here'),
  ]

  it('buckets by period with document-frequency terms', () => {
    const t = trends(tweets, { period: 'month' })
    expect(t.buckets.map((b) => [b.period, b.count])).toEqual([
      ['2026-01', 2],
      ['2026-02', 1],
      ['2026-03', 4],
    ])
    const march = t.buckets[2]
    // "agents" appears 5 times but in 3 tweets.
    expect(march.top_terms[0]).toEqual({ key: 'agents', count: 3 })
    expect(march.top_hashtags).toEqual([{ key: '#agents', count: 1 }])
    expect(march.top_authors[0]).toEqual({ key: 'ada', count: 3 })
  })

  it('flags terms rising in the latest period, not steady ones', () => {
    const { rising } = trends(tweets, { period: 'month' })
    expect(rising.map((r) => r.term)).toEqual(['agents'])
    expect(rising[0]).toMatchObject({ recent: 3, baseline: 0, growth: 4 })
  })

  it('has no rising terms with a single period', () => {
    expect(trends(tweets, { period: 'year' }).rising).toEqual([])
  })
})

describe('stats', () => {
  it('summarizes counts, range and tops', () => {
    const tweets = [
      storedTweet({
        created_at: at('2026-01-05T00:00:00Z'),
        folder: 'AI',
        tags: ['x'],
      }),
      storedTweet({
        created_at: at('2026-03-05T00:00:00Z'),
        category_name: 'likes',
      }),
    ].map((t) => toAgentTweet(t))
    expect(stats(tweets)).toEqual({
      total: 2,
      range: {
        first: '2026-01-05T00:00:00.000Z',
        last: '2026-03-05T00:00:00.000Z',
      },
      by_category: { bookmarks: 1, likes: 1 },
      by_month: [
        { key: '2026-01', count: 1 },
        { key: '2026-03', count: 1 },
      ],
      top_authors: [{ key: 'ada', count: 2 }],
      top_folders: [
        { key: '(unsorted)', count: 1 },
        { key: 'AI', count: 1 },
      ],
      top_tags: [{ key: 'x', count: 1 }],
    })
  })
})
