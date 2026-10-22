import { describe, it, expect } from 'vitest'

import {
  AGENT_MIRROR_SCHEMA,
  buildAccountSnapshot,
  folderPathMap,
  mergeAgentIndex,
  toAgentTweet,
} from './agent-mirror'
import type { Folder } from './types/folder'

function folder(name: string, parent: string | null, sort = 0): Folder {
  return {
    id: `o_bookmark_${name}`,
    owner_id: 'o',
    name,
    scope: 'bookmark',
    sort_order: sort,
    created_at: 0,
    parent_id: parent,
  }
}

const tweet = (extra: Record<string, unknown> = {}) =>
  ({
    id: 'o_1',
    owner_id: 'o',
    tweet_id: '1',
    user_id: 'u1',
    username: 'Ada',
    screen_name: 'ada',
    full_text: 'hello',
    lang: 'en',
    created_at: 1_700_000_000,
    conversations: [],
    views_count: 10,
    favorite_count: 2,
    retweet_count: 1,
    reply_count: 0,
    quote_count: 0,
    bookmark_count: 3,
    ...extra,
  }) as any

describe('folderPathMap', () => {
  it('joins nested folders and survives cycles', () => {
    const paths = folderPathMap([
      folder('AI', null),
      folder('LLM', 'AI'),
      folder('Agents', 'LLM'),
      folder('A', 'B'),
      folder('B', 'A'),
    ])
    expect(paths.get('Agents')).toBe('AI/LLM/Agents')
    expect(paths.get('AI')).toBe('AI')
    expect(paths.get('A')).toBe('B/A')
  })
})

describe('toAgentTweet', () => {
  it('flattens a stored record into the agent shape', () => {
    const t = toAgentTweet(
      tweet({
        folder: 'LLM',
        tags: ['read'],
        ai_summary: 'sum',
        conversations: [{ full_text: 'part 2' }, { full_text: '' }],
        quoted_tweet: {
          tweet_id: '9',
          screen_name: 'bob',
          full_text: 'quoted',
        },
        media_items: [{ type: 'photo', media_url_https: 'https://img/1.jpg' }],
        category_name: 'likes',
        is_reply: true,
      }),
      new Map([['LLM', 'AI/LLM']]),
    )
    expect(t).toEqual({
      id: '1',
      url: 'https://x.com/ada/status/1',
      category: 'likes',
      author: { id: 'u1', name: 'Ada', screen_name: 'ada' },
      created_at: '2023-11-14T22:13:20.000Z',
      lang: 'en',
      text: 'hello',
      thread: ['part 2'],
      quoted: {
        id: '9',
        url: 'https://x.com/bob/status/9',
        author: 'bob',
        text: 'quoted',
      },
      folder: 'AI/LLM',
      tags: ['read'],
      ai_tags: [],
      ai_summary: 'sum',
      note: null,
      media: [{ type: 'photo', url: 'https://img/1.jpg' }],
      metrics: {
        views: 10,
        likes: 2,
        retweets: 1,
        replies: 0,
        quotes: 0,
        bookmarks: 3,
      },
      is_reply: true,
    })
  })

  it('defaults old records to bookmarks and tolerates missing fields', () => {
    const t = toAgentTweet(
      tweet({ conversations: undefined, media_items: null }),
    )
    expect(t.category).toBe('bookmarks')
    expect(t.thread).toEqual([])
    expect(t.media).toEqual([])
    expect(t.quoted).toBeNull()
    expect(t.folder).toBeNull()
  })
})

describe('buildAccountSnapshot', () => {
  it('writes newest-first JSONL plus folders, tags and meta', () => {
    const { meta, files } = buildAccountSnapshot({
      ownerId: 'o',
      screenName: 'me',
      tweets: [
        tweet({ tweet_id: 'old', created_at: 1 }),
        tweet({ tweet_id: 'new', created_at: 2, category_name: 'likes' }),
      ],
      folders: [folder('B', null, 1), folder('A', null, 0)],
      folderCounts: { A: 4 },
      tags: [{ name: 'toString', color: '#fff', sort_order: 0 } as any],
      tagCounts: {},
      now: new Date('2026-01-01T00:00:00Z'),
    })

    expect(meta).toEqual({
      schema: AGENT_MIRROR_SCHEMA,
      owner_id: 'o',
      screen_name: 'me',
      exported_at: '2026-01-01T00:00:00.000Z',
      total: 2,
      counts: { bookmarks: 1, likes: 1 },
    })
    const byPath = Object.fromEntries(files.map((f) => [f.path, f.content]))
    const lines = byPath['accounts/o/tweets.jsonl'].trim().split('\n')
    expect(lines.map((l) => JSON.parse(l).id)).toEqual(['new', 'old'])
    expect(JSON.parse(byPath['accounts/o/folders.json'])).toEqual([
      { name: 'A', path: 'A', parent: null, count: 4 },
      { name: 'B', path: 'B', parent: null, count: 0 },
    ])
    // Prototype names must not pick up Object.prototype members as counts.
    expect(JSON.parse(byPath['accounts/o/tags.json'])).toEqual([
      { name: 'toString', color: '#fff', count: 0 },
    ])
    expect(JSON.parse(byPath['accounts/o/meta.json'])).toEqual(meta)
  })

  it('writes an empty JSONL file for an account with no data', () => {
    const { files } = buildAccountSnapshot({
      ownerId: 'o',
      screenName: '',
      tweets: [],
      folders: [],
      folderCounts: {},
      tags: [],
      tagCounts: {},
    })
    expect(files.find((f) => f.path.endsWith('.jsonl'))!.content).toBe('')
  })
})

describe('mergeAgentIndex', () => {
  const meta = (owner_id: string, total: number) => ({ owner_id, total }) as any

  it('replaces the same account and keeps others', () => {
    const index = mergeAgentIndex(
      { schema: 1, accounts: [meta('a', 1), meta('b', 1)] },
      meta('a', 5),
    )
    expect(index.accounts.map((a) => [a.owner_id, a.total])).toEqual([
      ['b', 1],
      ['a', 5],
    ])
  })

  it('starts fresh from a missing or corrupt index', () => {
    for (const prev of [null, undefined, 'junk', { accounts: 'x' }]) {
      expect(mergeAgentIndex(prev, meta('a', 1)).accounts).toHaveLength(1)
    }
  })
})
