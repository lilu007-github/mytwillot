/**
 * Mirror the current account's data into a user-chosen folder as plain files
 * (see utils/agent-mirror for the format) so the `twillot` CLI / MCP server
 * and other agents can read it outside the browser.
 *
 * Shares the File System Access plumbing with the Obsidian vault sync but
 * keeps its own handle, so the two can point at different folders.
 */
import { iterate } from 'utils/db/tweets'
import { getFolderCounts, getFoldersByScope } from 'utils/db/folders'
import { getTagCounts, getTags } from 'utils/db/tags'
import { getCurrentUserId } from 'utils/storage'
import { getAccountRegistry } from 'utils/account-manager'
import {
  AGENT_INDEX_FILE,
  AGENT_README,
  AGENT_README_FILE,
  buildAccountSnapshot,
  mergeAgentIndex,
} from 'utils/agent-mirror'
import { fnv1aHex } from 'utils/hash'

import {
  ensurePermission,
  metaGet,
  metaSet,
  readTextFile,
  writeTextFile,
} from './vault'

const HANDLE_KEY = 'agent_mirror_handle'
/** path → content hash of what we last wrote, to skip unchanged files. */
const HASHES_KEY = 'agent_mirror_hashes'
const LAST_KEY = 'agent_mirror_last'

export const AUTO_MIRROR_INTERVAL_MS = 15 * 60 * 1000

export interface MirrorResult {
  owner_id: string
  total: number
  written: number
  /** Unix ms */
  at: number
}

export async function pickMirrorDirectory(): Promise<any> {
  const picker = (globalThis as any).showDirectoryPicker
  if (!picker) {
    throw new Error('File System Access API is not supported in this browser.')
  }
  const handle = await picker({ id: 'twillot-agent', mode: 'readwrite' })
  await metaSet(HANDLE_KEY, handle)
  await metaSet(HASHES_KEY, {})
  return handle
}

export async function getMirrorHandle(): Promise<any | null> {
  return (await metaGet<any>(HANDLE_KEY)) ?? null
}

export async function forgetMirror(): Promise<void> {
  await metaSet(HANDLE_KEY, undefined)
  await metaSet(HASHES_KEY, {})
  await metaSet(LAST_KEY, undefined)
}

export async function getLastMirror(): Promise<MirrorResult | null> {
  return (await metaGet<MirrorResult>(LAST_KEY)) ?? null
}

let running: Promise<MirrorResult> | null = null

/** Write the current account's snapshot. Callers ensure permission first. */
export function mirrorNow(handle: any): Promise<MirrorResult> {
  // One run at a time: auto and manual triggers share the in-flight run.
  running ??= writeMirror(handle).finally(() => {
    running = null
  })
  return running
}

async function writeMirror(handle: any): Promise<MirrorResult> {
  const ownerId = await getCurrentUserId()
  if (!ownerId) {
    throw new Error('No active X account. Open x.com and log in first.')
  }
  const [tweets, folders, folderCounts, tags, tagCounts, registry] =
    await Promise.all([
      iterate(() => true),
      getFoldersByScope('bookmark'),
      getFolderCounts('bookmark'),
      getTags(),
      getTagCounts(),
      getAccountRegistry(),
    ])
  const { meta, files } = buildAccountSnapshot({
    ownerId,
    screenName: registry.find((a) => a.user_id === ownerId)?.screen_name || '',
    tweets,
    folders,
    folderCounts,
    tags,
    tagCounts,
  })

  const previousIndex = await readTextFile(handle, AGENT_INDEX_FILE)
  let parsedIndex: unknown = null
  try {
    parsedIndex = previousIndex ? JSON.parse(previousIndex) : null
  } catch {
    // Corrupt index: rebuild it from this account.
  }
  files.push(
    {
      path: AGENT_INDEX_FILE,
      content:
        JSON.stringify(mergeAgentIndex(parsedIndex, meta), null, 2) + '\n',
    },
    { path: AGENT_README_FILE, content: AGENT_README },
  )

  const hashes = (await metaGet<Record<string, string>>(HASHES_KEY)) || {}
  const dirCache = new Map<string, any>()
  let written = 0
  for (const file of files) {
    const hash = fnv1aHex(file.content)
    if (hashes[file.path] === hash) {
      continue
    }
    await writeTextFile(handle, file.path, file.content, dirCache)
    hashes[file.path] = hash
    written++
  }
  await metaSet(HASHES_KEY, hashes)

  const result = {
    owner_id: ownerId,
    total: meta.total,
    written,
    at: Date.now(),
  }
  await metaSet(LAST_KEY, result)
  return result
}

/**
 * Mirror without prompting: only when a folder is set and the browser still
 * holds write permission (requesting needs a click). Failures are logged, not
 * thrown — this runs in the background of the options page.
 */
export async function autoMirror(): Promise<MirrorResult | null> {
  try {
    const handle = await getMirrorHandle()
    if (!handle || (await ensurePermission(handle, false)) !== 'granted') {
      return null
    }
    return await mirrorNow(handle)
  } catch (err) {
    console.warn('Agent mirror failed:', err)
    return null
  }
}

/** Mirror now and then periodically while the options page is open. */
export function startAutoMirror(intervalMs = AUTO_MIRROR_INTERVAL_MS) {
  autoMirror()
  const timer = setInterval(autoMirror, intervalMs)
  return () => clearInterval(timer)
}
