import { describe, it, expect } from 'vitest'

import { toAgentTweet } from 'utils/agent-mirror'

import { dedupe, getTweets, parseDate, parseQuery, searchTweets } from './query'
import { at, storedTweet } from './fixture.test-helper'

const NOW = Date.UTC(2026, 5, 15, 12)

describe('parseDate', () => {
  it.each([
    ['7d', NOW - 7 * 86_400_000],
    ['2w', NOW - 14 * 86_400_000],
    ['3m', Date.UTC(2026, 2, 15, 12)],
    ['1y', Date.UTC(2025, 5, 15, 12)],
    ['2026-01-02', Date.UTC(2026, 0, 2)],
    ['2026-02', Date.UTC(2026, 1, 1)],
  ])('%s', (value, expected) => {
    expect(parseDate(value, false, NOW)).toBe(expected)
  })

  it('makes absolute until-dates inclusive', () => {
    expect(parseDate('2026-01-02', true)).toBe(Date.UTC(2026, 0, 3) - 1)
    expect(parseDate('2026-02', true)).toBe(Date.UTC(2026, 2, 1) - 1)
  })

  it('rejects garbage with a usage error', () => {
    expect(() => parseDate('last week')).toThrow(/Bad date/)
  })
})

describe('parseQuery', () => {
  it('splits terms, phrases, exclusions and operators', () => {
    expect(
      parseQuery('Rust "async runtime" -tokio from:@Ada since:2026-01-01 -'),
    ).toEqual({
      terms: ['rust', 'async runtime', '-'],
      excluded: ['tokio'],
      from: ['ada'],
      since: '2026-01-01',
    })
  })
})

describe('searchTweets', () => {
  const tweets = [
    storedTweet({
      tweet_id: 'a',
      full_text: 'Rust async runtimes compared',
      created_at: at('2026-03-01T00:00:00Z'),
      folder: 'LLM',
      favorite_count: 5,
    }),
    storedTweet({
      tweet_id: 'b',
      full_text: 'Why tokio is the default async runtime in Rust. Rust rust',
      created_at: at('2026-02-01T00:00:00Z'),
      folder: 'AI',
      tags: ['Read'],
      favorite_count: 50,
    }),
    storedTweet({
      tweet_id: 'c',
      full_text: '大模型 智能体 的趋势',
      screen_name: 'bob',
      created_at: at('2026-01-01T00:00:00Z'),
      conversations: [{ full_text: 'second part mentions rust' }],
    }),
    // Same tweet as "a", also liked: appears once unless filtering likes.
    storedTweet({
      tweet_id: 'a',
      full_text: 'Rust async runtimes compared',
      created_at: at('2026-03-01T00:00:00Z'),
      category_name: 'likes',
    }),
  ].map((t) =>
    toAgentTweet(
      t,
      new Map([
        ['LLM', 'AI/LLM'],
        ['AI', 'AI'],
      ]),
    ),
  )
  const ids = (r: { items: { id: string }[] }) => r.items.map((t) => t.id)

  it('requires every term, searches threads, ranks by matches', () => {
    expect(ids(searchTweets(tweets, { query: 'rust' }))).toEqual([
      'b',
      'a',
      'c',
    ])
    expect(ids(searchTweets(tweets, { query: 'rust tokio' }))).toEqual(['b'])
    expect(ids(searchTweets(tweets, { query: 'rust -tokio' }))).toEqual([
      'a',
      'c',
    ])
    expect(ids(searchTweets(tweets, { query: '"async runtimes"' }))).toEqual([
      'a',
    ])
    expect(ids(searchTweets(tweets, { query: '智能体' }))).toEqual(['c'])
  })

  it('applies operators and filters', () => {
    expect(ids(searchTweets(tweets, { query: 'from:bob' }))).toEqual(['c'])
    expect(ids(searchTweets(tweets, { query: 'since:2026-02-01' }))).toEqual([
      'a',
      'b',
    ])
    expect(ids(searchTweets(tweets, { until: '2026-02' }))).toEqual(['b', 'c'])
    // Folder filter includes subfolders; "AI" must not match "AIX".
    expect(ids(searchTweets(tweets, { folder: 'ai' }))).toEqual(['a', 'b'])
    expect(ids(searchTweets(tweets, { folder: 'AI/LLM' }))).toEqual(['a'])
    expect(ids(searchTweets(tweets, { unsorted: true }))).toEqual(['c'])
    expect(ids(searchTweets(tweets, { tag: 'read' }))).toEqual(['b'])
    expect(ids(searchTweets(tweets, { has: 'thread' }))).toEqual(['c'])
    expect(ids(searchTweets(tweets, { author: '@BOB' }))).toEqual(['c'])
  })

  it('keeps one copy per tweet unless a category is chosen', () => {
    const all = searchTweets(tweets, {})
    expect(all.total).toBe(3)
    expect(all.items.find((t) => t.id === 'a')!.category).toBe('bookmarks')
    expect(ids(searchTweets(tweets, { category: 'likes' }))).toEqual(['a'])
  })

  it('sorts by engagement and pages', () => {
    expect(ids(searchTweets(tweets, { sort: 'engagement' }))).toEqual([
      'b',
      'a',
      'c',
    ])
    const page = searchTweets(tweets, { limit: 1, offset: 1 })
    expect(page).toMatchObject({ total: 3, offset: 1 })
    expect(ids(page)).toEqual(['b'])
  })

  it('looks tweets up by id or status URL', () => {
    expect(
      getTweets(tweets, ['https://x.com/bob/status/c', 'b', 'zzz']).map(
        (t) => t.id,
      ),
    ).toEqual(['b', 'c'])
    expect(dedupe(tweets)).toHaveLength(3)
  })
})
