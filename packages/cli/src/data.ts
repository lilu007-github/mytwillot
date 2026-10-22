/**
 * Locate and load the agent mirror written by the x-bookmarks extension
 * (format: packages/utils/agent-mirror.ts).
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import {
  AGENT_INDEX_FILE,
  AGENT_MIRROR_SCHEMA,
  accountDir,
  type AgentAccountMeta,
  type AgentFolder,
  type AgentIndex,
  type AgentTag,
  type AgentTweet,
} from 'utils/agent-mirror'

export interface Dataset {
  dir: string
  account: AgentAccountMeta
  tweets: AgentTweet[]
  folders: AgentFolder[]
  tags: AgentTag[]
}

export class UsageError extends Error {
  name = 'UsageError'
}

export function configPath() {
  const base =
    process.env.TWILLOT_CONFIG_DIR || join(homedir(), '.config', 'twillot')
  return join(base, 'config.json')
}

function readConfig(): { data?: string } {
  try {
    return JSON.parse(readFileSync(configPath(), 'utf8'))
  } catch {
    return {}
  }
}

/** --data flag, then $TWILLOT_DATA, then the folder saved by `twillot init`. */
export function resolveDataDir(flag?: string): string {
  const dir = flag || process.env.TWILLOT_DATA || readConfig().data
  if (!dir) {
    throw new UsageError(
      'No data folder configured. In the extension, open Export → "Agent access" ' +
        'and choose a mirror folder, then run: twillot init <that folder>',
    )
  }
  return resolve(dir)
}

export function saveDataDir(dir: string): string {
  const abs = resolve(dir)
  const file = configPath()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ ...readConfig(), data: abs }, null, 2))
  return abs
}

export function loadIndex(dir: string): AgentIndex {
  const file = join(dir, AGENT_INDEX_FILE)
  if (!existsSync(file)) {
    throw new UsageError(
      `No Twillot mirror in ${dir} (missing ${AGENT_INDEX_FILE}). ` +
        'Click "Mirror now" in the extension\'s Export page first.',
    )
  }
  const index = JSON.parse(readFileSync(file, 'utf8')) as AgentIndex
  if (index.schema > AGENT_MIRROR_SCHEMA) {
    throw new UsageError(
      `Mirror schema ${index.schema} is newer than this CLI supports ` +
        `(${AGENT_MIRROR_SCHEMA}). Rebuild the CLI from the same repo version.`,
    )
  }
  return index
}

/** By owner id or screen name (with or without @); default: most recent. */
export function pickAccount(
  index: AgentIndex,
  wanted?: string,
): AgentAccountMeta {
  const accounts = index.accounts || []
  if (accounts.length === 0) {
    throw new UsageError('The mirror has no accounts yet.')
  }
  if (!wanted) {
    return [...accounts].sort((a, b) =>
      b.exported_at.localeCompare(a.exported_at),
    )[0]
  }
  const key = wanted.replace(/^@/, '').toLowerCase()
  const found = accounts.find(
    (a) => a.owner_id === key || a.screen_name.toLowerCase() === key,
  )
  if (!found) {
    const names = accounts.map((a) => a.screen_name || a.owner_id).join(', ')
    throw new UsageError(
      `No account "${wanted}" in the mirror (have: ${names})`,
    )
  }
  return found
}

function readJson<T>(file: string, fallback: T): T {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback
}

export function loadDataset(dir: string, wanted?: string): Dataset {
  const account = pickAccount(loadIndex(dir), wanted)
  const base = join(dir, accountDir(account.owner_id))
  const jsonl = join(base, 'tweets.jsonl')
  const tweets = existsSync(jsonl)
    ? readFileSync(jsonl, 'utf8')
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as AgentTweet)
    : []
  return {
    dir,
    account,
    tweets,
    folders: readJson(join(base, 'folders.json'), []),
    tags: readJson(join(base, 'tags.json'), []),
  }
}

/**
 * A loader for long-running processes (the MCP server): re-reads the mirror
 * only when the extension has rewritten it.
 */
export function createDatasetLoader(dir: string, wanted?: string) {
  let cached: Dataset | null = null
  let stamp = ''
  return (): Dataset => {
    const file = join(dir, AGENT_INDEX_FILE)
    const now = existsSync(file) ? String(statSync(file).mtimeMs) : ''
    if (!cached || now !== stamp) {
      cached = loadDataset(dir, wanted)
      stamp = now
    }
    return cached
  }
}
