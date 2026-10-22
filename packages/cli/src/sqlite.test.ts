import { describe, it, expect } from 'vitest'
import { appendFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { loadDataset } from './data'
import { searchTweets } from './query'
import { ftsExpression, openIndex, segmentText } from './sqlite'
import { at, folder, storedTweet, writeMirror } from './fixture.test-helper'

function mirror() {
  return writeMirror([
    {
      ownerId: 'me',
      screenName: 'Me',
      tweets: [
        storedTweet({
          tweet_id: '1',
          full_text: '我们正在研究大模型和智能体的记忆机制',
          created_at: at('2026-03-01T00:00:00Z'),
          tags: ['AI'],
          folder: 'LLM',
        }),
        storedTweet({
          tweet_id: '2',
          full_text: 'Rustaceans love async rust. Rust rust rust.',
          created_at: at('2026-02-01T00:00:00Z'),
        }),
        storedTweet({
          tweet_id: '3',
          full_text: 'A short note mentioning rust once',
          created_at: at('2026-01-01T00:00:00Z'),
          favorite_count: 99,
        }),
        // Same tweet as 2, also liked: its own row in SQL.
        storedTweet({
          tweet_id: '2',
          full_text: 'Rustaceans love async rust. Rust rust rust.',
          category_name: 'likes',
        }),
      ],
      folders: [folder('AI'), folder('LLM', 'AI', 1)],
      folderCounts: { LLM: 1 },
    },
  ])
}

describe('segmentText / ftsExpression', () => {
  it('splits Chinese into words and lowercases', () => {
    expect(segmentText('大模型 Agent!')).toBe('大 模型 agent')
  })

  it('builds an AND of prefix phrases, null for unindexable terms', () => {
    expect(ftsExpression(['rust', '智能体'])).toBe('"rust"* AND "智能 体"*')
    expect(ftsExpression(['🔥'])).toBeNull()
    expect(ftsExpression([])).toBeNull()
  })
})

describe('openIndex', () => {
  it('builds once and rebuilds only when the mirror changes', () => {
    const dir = mirror()
    const signature = (index: ReturnType<typeof openIndex>) =>
      index!.sql("SELECT value FROM index_meta WHERE key = 'signature'").rows[0]
        .value

    const first = openIndex(loadDataset(dir))!
    expect(existsSync(first.path)).toBe(true)
    const before = signature(first)
    const builtAt = first.builtAt
    first.close()

    const again = openIndex(loadDataset(dir))!
    expect(again.builtAt).toBe(builtAt)
    again.close()

    appendFileSync(join(dir, 'accounts/me/tags.json'), ' ')
    const rebuilt = openIndex(loadDataset(dir))!
    expect(signature(rebuilt)).not.toBe(before)
    rebuilt.close()

    // --rebuild forces it even when nothing changed.
    const forced = openIndex(loadDataset(dir), { rebuild: true })!
    expect(forced.builtAt >= builtAt).toBe(true)
    expect(signature(forced)).toBe(signature(openIndex(loadDataset(dir))))
    forced.close()
  })

  it('finds Chinese and English words, prefix-matched, ranked by bm25', () => {
    const index = openIndex(loadDataset(mirror()))!
    const keys = (terms: string[]) => [
      ...(index.ftsSearch(terms) || new Map()).keys(),
    ]

    expect(keys(['智能体'])).toEqual(['bookmarks\u00001'])
    expect(keys(['模型', '记忆'])).toEqual(['bookmarks\u00001'])
    // "rust" prefix-matches "rustaceans"; tweet 2 (many mentions) ranks first.
    const hits = index.ftsSearch(['rust'])!
    expect([...hits.keys()].sort()).toEqual([
      'bookmarks\u00002',
      'bookmarks\u00003',
      'likes\u00002',
    ])
    expect(hits.get('bookmarks\u00002')!).toBeGreaterThan(
      hits.get('bookmarks\u00003')!,
    )
    expect(index.ftsSearch(['🔥'])).toBeNull()
    index.close()
  })

  it('answers read-only SQL, including fts_query and tag joins', () => {
    const index = openIndex(loadDataset(mirror()))!

    expect(
      index.sql(
        'SELECT category, count(*) AS n FROM tweets GROUP BY 1 ORDER BY 1',
      ).rows,
    ).toEqual([
      { category: 'bookmarks', n: 3 },
      { category: 'likes', n: 1 },
    ])
    expect(
      index.sql(
        `SELECT t.id FROM tweets_fts JOIN tweets t ON t.rowid = tweets_fts.rowid
         WHERE tweets_fts MATCH fts_query('智能体 记忆')`,
      ).rows,
    ).toEqual([{ id: '1' }])
    expect(
      index.sql(
        "SELECT t.id, t.folder FROM tweet_tags g JOIN tweets t ON t.rowid = g.tweet_rowid WHERE g.tag = 'AI'",
      ).rows,
    ).toEqual([{ id: '1', folder: 'AI/LLM' }])
    expect(index.sql('SELECT path FROM folders ORDER BY path').rows).toEqual([
      { path: 'AI' },
      { path: 'AI/LLM' },
    ])

    const capped = index.sql('SELECT id FROM tweets', 2)
    expect(capped).toMatchObject({ columns: ['id'], truncated: true })
    expect(capped.rows).toHaveLength(2)

    for (const write of [
      'DELETE FROM tweets',
      'DROP TABLE tweets',
      "INSERT INTO tags VALUES ('x', '#fff', 0)",
    ]) {
      expect(() => index.sql(write)).toThrow(/SQL error/)
    }
    expect(index.sql('SELECT count(*) AS n FROM tweets').rows[0].n).toBe(4)
    expect(() => index.sql('SELEC nonsense')).toThrow(/SQL error/)
    index.close()
  })
})

describe('searchTweets with the index', () => {
  it('ranks full-text hits by bm25 and keeps substring-only matches after', () => {
    const ds = loadDataset(mirror())
    const index = openIndex(ds)!
    const ids = (query: string) =>
      searchTweets(ds.tweets, { query }, index.ftsSearch).items.map((t) => t.id)

    expect(ids('rust')).toEqual(['2', '3'])
    // "型和" spans a word boundary: no FTS hit, but substring still finds it.
    expect(ids('型和')).toEqual(['1'])
    expect(ids('rust -async')).toEqual(['3'])
    index.close()
  })
})
