import { parseArgs } from 'node:util'

import {
  loadDataset,
  loadIndex,
  resolveDataDir,
  saveDataDir,
  UsageError,
} from './data'
import {
  countsTable,
  json,
  tweetsMarkdown,
  tweetsText,
  type Format,
} from './format'
import { getTweets, searchTweets, type SortOrder } from './query'
import { stats, trends, type Period } from './trends'
import { runMcpServer } from './mcp'

export const VERSION = '0.1.0'

const HELP = `twillot — query your Twillot bookmarks mirror

Usage: twillot <command> [options]

Commands:
  init <dir>            Remember the mirror folder chosen in the extension
  accounts              Mirrored accounts and when they were last refreshed
  search [query]        Search saved tweets (terms, "phrases", -exclude,
                        from:user, since:/until:)
  show <id|url>...      Full tweets with threads
  folders               Folders with counts
  tags                  Tags with counts
  stats                 Totals, months, top authors / folders / tags
  trends                Topics per period and rising terms
  mcp                   Run the MCP server on stdio (for Claude Code etc.)

Filters (search, stats, trends):
  --category <c>        all | bookmarks | likes | posts | replies | media
  --folder <path>       Folder (includes subfolders)   --unsorted
  --tag <name>          Tag                            --untagged
  --author <name>       Author screen name
  --since <when>        7d, 2w, 3m, 1y, 2026-01-01, 2026-01
  --until <when>
  --has <what>          media | link | thread | quote

search:   --sort relevance|date|engagement  --limit <n> (20)  --offset <n>
          --full (whole text and threads)
trends:   --period week|month|quarter|year (month)  --top <n> (10)
Output:   --format text|md|json  (--json = --format json)
Global:   --data <dir> (or $TWILLOT_DATA)  --account <screen_name|id>
          -h, --help  -v, --version`

const OPTIONS = {
  data: { type: 'string' },
  account: { type: 'string' },
  category: { type: 'string' },
  folder: { type: 'string' },
  unsorted: { type: 'boolean' },
  tag: { type: 'string' },
  untagged: { type: 'boolean' },
  author: { type: 'string' },
  since: { type: 'string' },
  until: { type: 'string' },
  has: { type: 'string' },
  sort: { type: 'string' },
  limit: { type: 'string' },
  offset: { type: 'string' },
  full: { type: 'boolean' },
  period: { type: 'string' },
  top: { type: 'string' },
  format: { type: 'string', short: 'f' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const

function oneOf<T extends string>(
  name: string,
  value: string | undefined,
  allowed: readonly T[],
): T | undefined {
  if (value === undefined) return undefined
  if (!allowed.includes(value as T)) {
    throw new UsageError(`--${name} must be one of: ${allowed.join(', ')}`)
  }
  return value as T
}

function int(name: string, value: string | undefined) {
  if (value === undefined) return undefined
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0) {
    throw new UsageError(`--${name} must be a non-negative integer`)
  }
  return n
}

/** Runs one command; returns the text to print. */
export async function run(argv: string[]): Promise<string | null> {
  const { values: o, positionals } = parseArgs({
    args: argv,
    options: OPTIONS,
    allowPositionals: true,
    strict: true,
  })
  const [command, ...args] = positionals
  if (o.version) return VERSION
  if (o.help || !command || command === 'help') return HELP

  const format: Format =
    oneOf('format', o.json ? 'json' : o.format, [
      'text',
      'md',
      'json',
    ] as const) || 'text'
  const filters = {
    category: oneOf('category', o.category, [
      'all',
      'bookmarks',
      'likes',
      'posts',
      'replies',
      'media',
    ] as const),
    folder: o.folder,
    unsorted: o.unsorted,
    tag: o.tag,
    untagged: o.untagged,
    author: o.author,
    since: o.since,
    until: o.until,
    has: oneOf('has', o.has, ['media', 'link', 'thread', 'quote'] as const),
  }

  if (command === 'init') {
    if (!args[0]) throw new UsageError('Usage: twillot init <mirror folder>')
    const dir = saveDataDir(args[0])
    let note = ''
    try {
      const n = loadIndex(dir).accounts.length
      note = `Found ${n} mirrored account${n === 1 ? '' : 's'}.`
    } catch (err) {
      note = `Note: ${(err as Error).message}`
    }
    return `Saved mirror folder: ${dir}\n${note}`
  }

  const dir = resolveDataDir(o.data)
  if (command === 'mcp') {
    await runMcpServer(dir, o.account)
    return null
  }
  if (command === 'accounts') {
    const accounts = loadIndex(dir).accounts
    if (format === 'json') return json(accounts)
    return accounts
      .map(
        (a) =>
          `@${a.screen_name || '?'} (${a.owner_id})  ${a.total} items, mirrored ${a.exported_at}`,
      )
      .join('\n')
  }

  const ds = loadDataset(dir, o.account)

  switch (command) {
    case 'search': {
      const res = searchTweets(ds.tweets, {
        ...filters,
        query: args.join(' '),
        sort: oneOf<SortOrder>('sort', o.sort, [
          'relevance',
          'date',
          'engagement',
        ]),
        limit: int('limit', o.limit),
        offset: int('offset', o.offset),
      })
      if (format === 'json') return json(res)
      if (format === 'md') return tweetsMarkdown(res.items)
      if (!res.total) return 'No matches.'
      const shown = `${res.items.length ? res.offset + 1 : 0}-${res.offset + res.items.length}`
      return `${tweetsText(res.items, o.full)}\n\n${shown} of ${res.total}`.trim()
    }
    case 'show': {
      if (!args.length) throw new UsageError('Usage: twillot show <id|url>...')
      const items = getTweets(ds.tweets, args)
      if (format === 'json') return json(items)
      if (format === 'md') return tweetsMarkdown(items)
      return tweetsText(items, true) || 'Not found.'
    }
    case 'folders':
      if (format === 'json') return json(ds.folders)
      return countsTable(
        ds.folders.map((f) => ({ key: f.path, count: f.count })),
      )
    case 'tags':
      if (format === 'json') return json(ds.tags)
      return countsTable(ds.tags.map((t) => ({ key: t.name, count: t.count })))
    case 'stats': {
      const s = stats(ds.tweets, filters, int('top', o.top))
      if (format === 'json') return json(s)
      return [
        `${s.total} items, ${s.range.first?.slice(0, 10) ?? '-'} → ${s.range.last?.slice(0, 10) ?? '-'}`,
        `By category: ${Object.entries(s.by_category)
          .map(([k, v]) => `${k} ${v}`)
          .join(', ')}`,
        `\nBy month:\n${countsTable(s.by_month)}`,
        `\nTop authors:\n${countsTable(s.top_authors.map((a) => ({ ...a, key: '@' + a.key })))}`,
        `\nTop folders:\n${countsTable(s.top_folders)}`,
        `\nTop tags:\n${countsTable(s.top_tags)}`,
      ].join('\n')
    }
    case 'trends': {
      const t = trends(ds.tweets, {
        ...filters,
        period: oneOf<Period>('period', o.period, [
          'week',
          'month',
          'quarter',
          'year',
        ]),
        top: int('top', o.top),
      })
      if (format === 'json') return json(t)
      const keys = (rows: { key: string }[]) =>
        rows.map((r) => r.key).join(', ')
      const lines = t.buckets.map(
        (b) =>
          `${b.period}  (${b.count})\n  terms:    ${keys(b.top_terms)}` +
          (b.top_hashtags.length
            ? `\n  hashtags: ${keys(b.top_hashtags)}`
            : '') +
          `\n  authors:  ${keys(b.top_authors.map((a) => ({ key: '@' + a.key })))}`,
      )
      if (t.rising.length) {
        lines.push(
          `Rising in ${t.buckets[t.buckets.length - 1].period}: ` +
            t.rising
              .map((r) => `${r.term} (${r.recent}, ×${r.growth})`)
              .join(', '),
        )
      }
      return lines.join('\n\n') || 'No items in range.'
    }
    default:
      throw new UsageError(`Unknown command "${command}". Run twillot --help.`)
  }
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const out = await run(argv)
    if (out !== null) process.stdout.write(out + '\n')
  } catch (err) {
    const e = err as Error & { code?: string }
    const usage =
      e instanceof UsageError || e.code?.startsWith('ERR_PARSE_ARGS')
    process.stderr.write(`twillot: ${e.message}\n`)
    process.exitCode = usage ? 2 : 1
  }
}
