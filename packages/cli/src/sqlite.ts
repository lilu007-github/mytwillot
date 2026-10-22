/**
 * SQLite index derived from the JSONL mirror: FTS5 full-text search with
 * bm25 ranking, and a read-only SQL surface for agents. It is a cache — the
 * mirror stays the source of truth — rebuilt whenever the mirror changes,
 * and stored outside the mirror folder (~/.cache/twillot by default).
 *
 * Uses Node's built-in node:sqlite (Node 22.13+). When it is unavailable,
 * openIndex returns null and callers fall back to scanning.
 *
 * FTS5's unicode61 tokenizer can't split Chinese, so indexed text and queries
 * are pre-segmented with Intl.Segmenter (the same segmenter trends use) and
 * joined with spaces.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { accountDir } from 'utils/agent-mirror'

import { UsageError, type Dataset } from './data'

/** Bump when the table layout or indexing changes. */
const INDEX_VERSION = 1

export const MAX_SQL_ROWS = 1000

export const SCHEMA_DOC = `Tables (read-only SQLite; one row per saved item):

tweets(rowid, id, category, url, author_id, author_name, author, created_at,
       lang, text, thread, thread_count, quoted_id, quoted_author, quoted_text,
       folder, tags, ai_tags, ai_summary, note, media_count, views, likes,
       retweets, replies, quotes, bookmarks, is_reply)
  - (category, id) is unique; a tweet both bookmarked and liked has 2 rows.
    category: bookmarks | likes | posts | replies | media.
  - author = screen name; created_at = ISO 8601 text, so
    substr(created_at, 1, 7) is the month and comparisons like
    created_at >= '2026-01-01' work.
  - folder = full path ("AI/LLM") or NULL when unsorted; thread = rest of the
    author's thread joined by blank lines; tags / ai_tags = JSON arrays.
tweet_tags(tweet_rowid, tag)       one row per tag, joins tweets.rowid
folders(name, path, parent, count)
tags(name, color, count)
tweets_fts                         FTS5 over text, thread, quoted text,
                                   author, folder, tags, AI summary, note

Full-text search (Chinese and English): wrap the user's words in fts_query():
  SELECT t.id, t.author, t.text FROM tweets_fts
  JOIN tweets t ON t.rowid = tweets_fts.rowid
  WHERE tweets_fts MATCH fts_query('agent 记忆')
  ORDER BY bm25(tweets_fts) LIMIT 20`

const segmenter = new Intl.Segmenter('zh', { granularity: 'word' })

/** Lowercased word-like segments joined by spaces (for FTS indexing). */
export function segmentText(text: string): string {
  const words: string[] = []
  for (const seg of segmenter.segment(text.toLowerCase())) {
    if (seg.isWordLike) words.push(seg.segment)
  }
  return words.join(' ')
}

/**
 * FTS5 expression requiring every term: each term becomes a quoted phrase of
 * its segments, prefix-matched ("rust" also finds "rustacean"). Null when a
 * term has no indexable words (punctuation, emoji) — callers then scan.
 */
export function ftsExpression(terms: string[]): string | null {
  const phrases: string[] = []
  for (const term of terms) {
    const words = segmentText(term)
    if (!words) return null
    phrases.push(`"${words.replace(/"/g, '""')}"*`)
  }
  return phrases.length ? phrases.join(' AND ') : null
}

let sqliteModule: typeof import('node:sqlite') | null | undefined

/** node:sqlite, loaded lazily with its ExperimentalWarning silenced. */
function loadSqlite() {
  if (sqliteModule !== undefined) return sqliteModule
  const emit = process.emitWarning
  process.emitWarning = ((warning: string | Error, ...rest: any[]) => {
    const text = typeof warning === 'string' ? warning : warning.message
    if (/sqlite/i.test(text)) return
    return (emit as any).call(process, warning, ...rest)
  }) as typeof process.emitWarning
  try {
    sqliteModule = createRequire(import.meta.url)('node:sqlite')
  } catch {
    sqliteModule = null
  } finally {
    process.emitWarning = emit
  }
  return sqliteModule
}

export function cacheDir() {
  return (
    process.env.TWILLOT_CACHE_DIR ||
    join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'twillot')
  )
}

export function indexPath(ds: Dataset) {
  const dirKey = createHash('sha1').update(ds.dir).digest('hex').slice(0, 12)
  return join(cacheDir(), dirKey, `${ds.account.owner_id}.sqlite`)
}

/** Changes whenever the extension rewrites this account's mirror files. */
function mirrorSignature(ds: Dataset) {
  const base = join(ds.dir, accountDir(ds.account.owner_id))
  const parts = ['tweets.jsonl', 'folders.json', 'tags.json'].map((f) => {
    const file = join(base, f)
    if (!existsSync(file)) return `${f}:-`
    const s = statSync(file)
    return `${f}:${s.size}:${s.mtimeMs}`
  })
  return `v${INDEX_VERSION}|${ds.tweets.length}|${parts.join('|')}`
}

const DDL = `
CREATE TABLE tweets (
  rowid INTEGER PRIMARY KEY,
  id TEXT NOT NULL, category TEXT NOT NULL, url TEXT,
  author_id TEXT, author_name TEXT, author TEXT,
  created_at TEXT, lang TEXT, text TEXT,
  thread TEXT, thread_count INTEGER,
  quoted_id TEXT, quoted_author TEXT, quoted_text TEXT,
  folder TEXT, tags TEXT, ai_tags TEXT, ai_summary TEXT, note TEXT,
  media_count INTEGER, views INTEGER, likes INTEGER, retweets INTEGER,
  replies INTEGER, quotes INTEGER, bookmarks INTEGER, is_reply INTEGER,
  UNIQUE (category, id)
);
CREATE INDEX tweets_created ON tweets(created_at);
CREATE INDEX tweets_author ON tweets(author);
CREATE INDEX tweets_folder ON tweets(folder);
CREATE TABLE tweet_tags (tweet_rowid INTEGER NOT NULL, tag TEXT NOT NULL);
CREATE INDEX tweet_tags_tag ON tweet_tags(tag);
CREATE TABLE folders (name TEXT, path TEXT, parent TEXT, count INTEGER);
CREATE TABLE tags (name TEXT, color TEXT, count INTEGER);
CREATE VIRTUAL TABLE tweets_fts USING fts5(body, content='');
CREATE TABLE index_meta (key TEXT PRIMARY KEY, value TEXT);
`

function build(
  sqlite: typeof import('node:sqlite'),
  ds: Dataset,
  file: string,
  signature: string,
) {
  mkdirSync(join(file, '..'), { recursive: true })
  // Build beside the target and rename, so readers never see a half index.
  const tmp = `${file}.${process.pid}.tmp`
  rmSync(tmp, { force: true })
  const db = new sqlite.DatabaseSync(tmp)
  try {
    db.exec(DDL)
    const insertTweet = db.prepare(`INSERT INTO tweets VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    const insertTag = db.prepare('INSERT INTO tweet_tags VALUES (?, ?)')
    const insertFts = db.prepare(
      'INSERT INTO tweets_fts(rowid, body) VALUES (?, ?)',
    )
    db.exec('BEGIN')
    let rowid = 0
    const seen = new Set<string>()
    for (const t of ds.tweets) {
      const key = `${t.category}\u0000${t.id}`
      if (seen.has(key)) continue
      seen.add(key)
      rowid++
      const m = t.metrics
      insertTweet.run(
        rowid,
        t.id,
        t.category,
        t.url,
        t.author.id ?? null,
        t.author.name ?? null,
        t.author.screen_name ?? null,
        t.created_at,
        t.lang,
        t.text,
        t.thread.join('\n\n'),
        t.thread.length,
        t.quoted?.id ?? null,
        t.quoted?.author ?? null,
        t.quoted?.text ?? null,
        t.folder,
        JSON.stringify(t.tags),
        JSON.stringify(t.ai_tags),
        t.ai_summary,
        t.note,
        t.media.length,
        m.views,
        m.likes,
        m.retweets,
        m.replies,
        m.quotes,
        m.bookmarks,
        t.is_reply ? 1 : 0,
      )
      for (const tag of t.tags) insertTag.run(rowid, tag)
      insertFts.run(
        rowid,
        segmentText(
          [
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
            .join('\n'),
        ),
      )
    }
    const insertFolder = db.prepare('INSERT INTO folders VALUES (?, ?, ?, ?)')
    for (const f of ds.folders)
      insertFolder.run(f.name, f.path, f.parent, f.count)
    const insertTagRow = db.prepare('INSERT INTO tags VALUES (?, ?, ?)')
    for (const t of ds.tags) insertTagRow.run(t.name, t.color, t.count)
    const meta = db.prepare('INSERT INTO index_meta VALUES (?, ?)')
    meta.run('signature', signature)
    meta.run('built_at', new Date().toISOString())
    meta.run('owner_id', ds.account.owner_id)
    meta.run('exported_at', ds.account.exported_at)
    db.exec('COMMIT')
  } catch (err) {
    db.close()
    rmSync(tmp, { force: true })
    throw err
  }
  db.close()
  renameSync(tmp, file)
}

export interface SqlResult {
  columns: string[]
  rows: Record<string, unknown>[]
  truncated: boolean
}

export interface TwillotIndex {
  path: string
  builtAt: string
  /** Map of `${category}\0${id}` → relevance (higher is better), or null. */
  ftsSearch(terms: string[]): Map<string, number> | null
  sql(query: string, maxRows?: number): SqlResult
  close(): void
}

function readSignature(sqlite: typeof import('node:sqlite'), file: string) {
  try {
    const db = new sqlite.DatabaseSync(file, { readOnly: true })
    try {
      const row = db
        .prepare("SELECT value FROM index_meta WHERE key = 'signature'")
        .get() as { value?: string } | undefined
      return row?.value ?? null
    } finally {
      db.close()
    }
  } catch {
    return null
  }
}

/**
 * Open (building or rebuilding as needed) the index for this dataset.
 * Returns null when node:sqlite is unavailable.
 */
export function openIndex(
  ds: Dataset,
  opts: { rebuild?: boolean } = {},
): TwillotIndex | null {
  const sqlite = loadSqlite()
  if (!sqlite) return null
  const file = indexPath(ds)
  const signature = mirrorSignature(ds)
  if (
    opts.rebuild ||
    !existsSync(file) ||
    readSignature(sqlite, file) !== signature
  ) {
    build(sqlite, ds, file, signature)
  }

  const db: DatabaseSync = new sqlite.DatabaseSync(file, { readOnly: true })
  db.exec('PRAGMA query_only = 1')
  db.function('fts_query', { deterministic: true }, (text: unknown) =>
    ftsExpression(
      String(text ?? '')
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean),
    ),
  )
  const builtAt = String(
    (
      db
        .prepare("SELECT value FROM index_meta WHERE key = 'built_at'")
        .get() as any
    )?.value ?? '',
  )
  const ftsStmt = db.prepare(
    `SELECT t.category AS category, t.id AS id, bm25(tweets_fts) AS rank
     FROM tweets_fts JOIN tweets t ON t.rowid = tweets_fts.rowid
     WHERE tweets_fts MATCH ?`,
  )

  return {
    path: file,
    builtAt,
    ftsSearch(terms) {
      const expr = ftsExpression(terms)
      if (!expr) return null
      const hits = new Map<string, number>()
      for (const row of ftsStmt.all(expr) as any[]) {
        // bm25 is lower-is-better (negative); flip it.
        hits.set(`${row.category}\u0000${row.id}`, -row.rank)
      }
      return hits
    },
    sql(query, maxRows = MAX_SQL_ROWS) {
      let stmt
      try {
        stmt = db.prepare(query)
      } catch (err) {
        throw new UsageError(`SQL error: ${(err as Error).message}`)
      }
      const rows: Record<string, unknown>[] = []
      let truncated = false
      try {
        // @types/node types this with the ES2025 Iterator class; we target
        // ES2023 libs, where it is a plain iterable iterator.
        const it = stmt.iterate() as unknown as IterableIterator<
          Record<string, unknown>
        >
        for (const row of it) {
          if (rows.length >= maxRows) {
            truncated = true
            break
          }
          rows.push({ ...row })
        }
      } catch (err) {
        throw new UsageError(`SQL error: ${(err as Error).message}`)
      }
      return {
        columns: rows.length ? Object.keys(rows[0]) : [],
        rows,
        truncated,
      }
    },
    close() {
      db.close()
    },
  }
}

/** Like openIndex but with a clear error when SQLite isn't available. */
export function requireIndex(
  ds: Dataset,
  opts?: { rebuild?: boolean },
): TwillotIndex {
  const index = openIndex(ds, opts)
  if (!index) {
    throw new UsageError(
      `SQL needs Node's built-in SQLite (Node 22.13 or newer); this is Node ${process.versions.node}.`,
    )
  }
  return index
}
