/**
 * Agent mirror: a plain-file snapshot of one account's data that tools outside
 * the browser (the `twillot` CLI / MCP server, scripts, any agent with file
 * access) can read. IndexedDB lives inside the Chrome profile and is not
 * readable from outside, so the extension writes this mirror into a folder
 * the user picks.
 *
 * Layout (relative to the chosen folder):
 *
 *   README.md                          what the files are, for humans/agents
 *   index.json                         AgentIndex — every mirrored account
 *   accounts/<owner_id>/meta.json      AgentAccountMeta
 *   accounts/<owner_id>/tweets.jsonl   one AgentTweet per line, newest first
 *   accounts/<owner_id>/folders.json   AgentFolder[]
 *   accounts/<owner_id>/tags.json      AgentTag[]
 *
 * Bump AGENT_MIRROR_SCHEMA on any breaking change to these shapes.
 */
import type { Folder } from './types/folder'
import type { Tag } from './types/tag'
import type { Tweet, TweetCategory } from './types'

export const AGENT_MIRROR_SCHEMA = 1

export interface AgentTweet {
  id: string
  url: string
  /** bookmarks / likes / posts / replies / media */
  category: TweetCategory
  author: { id: string; name: string; screen_name: string }
  /** ISO 8601 */
  created_at: string
  lang: string
  text: string
  /** The rest of the author's thread, in order (empty when not a thread). */
  thread: string[]
  quoted: { id: string; url: string; author: string; text: string } | null
  /** Folder path, nested folders joined with "/"; null when unsorted. */
  folder: string | null
  tags: string[]
  ai_tags: string[]
  ai_summary: string | null
  note: string | null
  media: { type: string; url: string }[]
  metrics: {
    views: number
    likes: number
    retweets: number
    replies: number
    quotes: number
    bookmarks: number
  }
  is_reply: boolean
}

export interface AgentFolder {
  name: string
  /** Full path, e.g. "AI/LLM". */
  path: string
  parent: string | null
  count: number
}

export interface AgentTag {
  name: string
  color: string
  count: number
}

export interface AgentAccountMeta {
  schema: number
  owner_id: string
  screen_name: string
  /** ISO 8601 */
  exported_at: string
  total: number
  counts: Partial<Record<TweetCategory, number>>
}

export interface AgentIndex {
  schema: number
  accounts: AgentAccountMeta[]
}

export const AGENT_INDEX_FILE = 'index.json'
export const AGENT_README_FILE = 'README.md'

export function accountDir(ownerId: string) {
  return `accounts/${ownerId}`
}

function tweetUrl(screenName: string, tweetId: string) {
  return `https://x.com/${screenName || 'i'}/status/${tweetId}`
}

/** Folder name → full path ("Parent/Child"); guards against cycles. */
export function folderPathMap(folders: Folder[]): Map<string, string> {
  const parentOf = new Map(folders.map((f) => [f.name, f.parent_id || null]))
  const paths = new Map<string, string>()
  for (const folder of folders) {
    const parts = [folder.name]
    const seen = new Set(parts)
    let parent = parentOf.get(folder.name)
    while (parent && !seen.has(parent)) {
      parts.unshift(parent)
      seen.add(parent)
      parent = parentOf.get(parent)
    }
    paths.set(folder.name, parts.join('/'))
  }
  return paths
}

function toIso(seconds: number) {
  const ms = (Number(seconds) || 0) * 1000
  return new Date(ms).toISOString()
}

export function toAgentTweet(
  tweet: Tweet,
  folderPaths: Map<string, string> = new Map(),
): AgentTweet {
  const quoted = tweet.quoted_tweet
  return {
    id: tweet.tweet_id,
    url: tweetUrl(tweet.screen_name, tweet.tweet_id),
    category: tweet.category_name || 'bookmarks',
    author: {
      id: tweet.user_id,
      name: tweet.username,
      screen_name: tweet.screen_name,
    },
    created_at: toIso(tweet.created_at),
    lang: tweet.lang || '',
    text: tweet.full_text || '',
    thread: (tweet.conversations || [])
      .map((c) => c?.full_text || '')
      .filter(Boolean),
    quoted: quoted?.tweet_id
      ? {
          id: quoted.tweet_id,
          url: tweetUrl(quoted.screen_name, quoted.tweet_id),
          author: quoted.screen_name,
          text: quoted.full_text || '',
        }
      : null,
    folder: tweet.folder ? folderPaths.get(tweet.folder) || tweet.folder : null,
    tags: tweet.tags || [],
    ai_tags: tweet.ai_tags || [],
    ai_summary: tweet.ai_summary || null,
    note: tweet.note || null,
    media: (tweet.media_items || []).map((m) => ({
      type: m.type,
      url: m.media_url_https,
    })),
    metrics: {
      views: tweet.views_count || 0,
      likes: tweet.favorite_count || 0,
      retweets: tweet.retweet_count || 0,
      replies: tweet.reply_count || 0,
      quotes: tweet.quote_count || 0,
      bookmarks: tweet.bookmark_count || 0,
    },
    is_reply: !!tweet.is_reply,
  }
}

export interface AccountSnapshotInput {
  ownerId: string
  screenName: string
  tweets: Tweet[]
  folders: Folder[]
  folderCounts: Record<string, number>
  tags: Tag[]
  tagCounts: Record<string, number>
  now?: Date
}

/** The files of one account's mirror, paths relative to the mirror root. */
export function buildAccountSnapshot(input: AccountSnapshotInput): {
  meta: AgentAccountMeta
  files: { path: string; content: string }[]
} {
  const paths = folderPathMap(input.folders)
  const own = (counts: Record<string, number>, key: string) =>
    Object.prototype.hasOwnProperty.call(counts, key) ? counts[key] : 0

  const tweets = input.tweets
    .map((t) => toAgentTweet(t, paths))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
  const counts: AgentAccountMeta['counts'] = {}
  for (const t of tweets) {
    counts[t.category] = (counts[t.category] || 0) + 1
  }

  const folders: AgentFolder[] = [...input.folders]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((f) => ({
      name: f.name,
      path: paths.get(f.name) || f.name,
      parent: f.parent_id || null,
      count: own(input.folderCounts, f.name),
    }))
  const tags: AgentTag[] = [...input.tags]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((t) => ({
      name: t.name,
      color: t.color,
      count: own(input.tagCounts, t.name),
    }))

  const meta: AgentAccountMeta = {
    schema: AGENT_MIRROR_SCHEMA,
    owner_id: input.ownerId,
    screen_name: input.screenName,
    exported_at: (input.now || new Date()).toISOString(),
    total: tweets.length,
    counts,
  }
  const dir = accountDir(input.ownerId)
  const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n'
  return {
    meta,
    files: [
      {
        path: `${dir}/tweets.jsonl`,
        content: tweets.map((t) => JSON.stringify(t) + '\n').join(''),
      },
      { path: `${dir}/folders.json`, content: json(folders) },
      { path: `${dir}/tags.json`, content: json(tags) },
      { path: `${dir}/meta.json`, content: json(meta) },
    ],
  }
}

/** Replace this account's entry in the root index, keeping the others. */
export function mergeAgentIndex(
  previous: unknown,
  meta: AgentAccountMeta,
): AgentIndex {
  const accounts = Array.isArray((previous as AgentIndex)?.accounts)
    ? (previous as AgentIndex).accounts.filter(
        (a) => a?.owner_id && a.owner_id !== meta.owner_id,
      )
    : []
  return { schema: AGENT_MIRROR_SCHEMA, accounts: [...accounts, meta] }
}

export const AGENT_README = `# Twillot data mirror

Written by the Twillot Bookmarks extension so tools outside the browser can
read your X bookmarks, likes and posts. Regenerated on every mirror; don't
edit these files by hand.

Query it with the \`twillot\` CLI (\`twillot search\`, \`twillot trends\`, ...)
or its MCP server (\`twillot mcp\`), or read the files directly:

- \`index.json\` lists the mirrored accounts (\`accounts[].owner_id\`,
  \`screen_name\`, \`exported_at\`, per-category \`counts\`).
- \`accounts/<owner_id>/tweets.jsonl\` has one JSON object per line, newest
  first. Fields: id, url, category (bookmarks | likes | posts | replies | media),
  author {id, name, screen_name}, created_at (ISO 8601), lang, text,
  thread[] (rest of the author's thread), quoted {id, url, author, text} | null,
  folder ("Parent/Child" path or null), tags[], ai_tags[], ai_summary, note,
  media [{type, url}], metrics {views, likes, retweets, replies, quotes,
  bookmarks}, is_reply.
- \`accounts/<owner_id>/folders.json\`: [{name, path, parent, count}].
- \`accounts/<owner_id>/tags.json\`: [{name, color, count}].

Schema version: ${AGENT_MIRROR_SCHEMA}.
`
