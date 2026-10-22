/**
 * Builds a real mirror folder on disk with the same code the extension uses,
 * so CLI tests exercise the actual file format.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  AGENT_INDEX_FILE,
  buildAccountSnapshot,
  mergeAgentIndex,
} from 'utils/agent-mirror'

let seq = 0

export function storedTweet(extra: Record<string, unknown> = {}): any {
  seq++
  return {
    id: `me_${seq}`,
    owner_id: 'me',
    tweet_id: String(1000 + seq),
    user_id: 'u',
    username: 'Ada',
    screen_name: 'ada',
    full_text: 'hello world',
    lang: 'en',
    created_at: Date.UTC(2026, 0, 15) / 1000,
    conversations: [],
    views_count: 0,
    favorite_count: 0,
    retweet_count: 0,
    reply_count: 0,
    quote_count: 0,
    bookmark_count: 0,
    ...extra,
  }
}

export const at = (iso: string) => Date.parse(iso) / 1000

export function writeMirror(
  accounts: {
    ownerId: string
    screenName: string
    tweets: any[]
    folders?: any[]
    folderCounts?: Record<string, number>
    tags?: any[]
    tagCounts?: Record<string, number>
    now?: Date
  }[],
): string {
  const dir = mkdtempSync(join(tmpdir(), 'twillot-mirror-'))
  let index: unknown = null
  for (const a of accounts) {
    const { meta, files } = buildAccountSnapshot({
      folders: [],
      folderCounts: {},
      tags: [],
      tagCounts: {},
      ...a,
    })
    for (const f of files) {
      mkdirSync(dirname(join(dir, f.path)), { recursive: true })
      writeFileSync(join(dir, f.path), f.content)
    }
    index = mergeAgentIndex(index, meta)
  }
  writeFileSync(join(dir, AGENT_INDEX_FILE), JSON.stringify(index))
  return dir
}

export function folder(name: string, parent: string | null = null, sort = 0) {
  return {
    id: `me_bookmark_${name}`,
    owner_id: 'me',
    name,
    scope: 'bookmark',
    sort_order: sort,
    created_at: 0,
    parent_id: parent,
  }
}
