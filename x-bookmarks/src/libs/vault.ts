/**
 * Direct-to-vault sync via the File System Access API.
 *
 * The user grants access to their Obsidian vault folder once; the directory
 * handle is persisted in IndexedDB (handles are structured-cloneable, unlike
 * chrome.storage which is JSON-only). "Sync" then writes one Markdown note per
 * tweet straight into the folder, incrementally — a content-hash manifest lets
 * us skip notes that haven't changed since the last sync.
 *
 * FileSystem* handle types aren't in this project's TS lib, so we treat handles
 * as `any` — the build uses esbuild (no type check) and this keeps tsc quiet.
 */

import { obsidianNote, type DataType } from 'utils/exporter'

const VAULT_DB = 'twillot_vault'
const META_STORE = 'meta'
const HANDLE_KEY = 'handle'
const MANIFEST_KEY = 'manifest'

type Manifest = Record<string, string>

function openVaultDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(VAULT_DB, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function metaGet<T>(key: string): Promise<T | undefined> {
  const db = await openVaultDb()
  return new Promise((resolve, reject) => {
    const req = db
      .transaction(META_STORE, 'readonly')
      .objectStore(META_STORE)
      .get(key)
    req.onsuccess = () => resolve(req.result as T | undefined)
    req.onerror = () => reject(req.error)
  })
}

async function metaSet(key: string, value: unknown): Promise<void> {
  const db = await openVaultDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readwrite')
    tx.objectStore(META_STORE).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export function isVaultSyncSupported(): boolean {
  return typeof (globalThis as any).showDirectoryPicker === 'function'
}

/** Prompt for a vault folder; persist the handle and reset incremental state. */
export async function pickVaultDirectory(): Promise<any> {
  const picker = (globalThis as any).showDirectoryPicker
  if (!picker) {
    throw new Error('File System Access API is not supported in this browser.')
  }
  const handle = await picker({ mode: 'readwrite' })
  await metaSet(HANDLE_KEY, handle)
  // Fresh folder → start incremental tracking from scratch.
  await metaSet(MANIFEST_KEY, {})
  return handle
}

export async function getSavedVaultHandle(): Promise<any | null> {
  return (await metaGet<any>(HANDLE_KEY)) ?? null
}

export async function forgetVault(): Promise<void> {
  await metaSet(HANDLE_KEY, undefined)
  await metaSet(MANIFEST_KEY, {})
}

/**
 * Query (and optionally request) readwrite permission on a stored handle.
 * Requesting must happen inside a user gesture, so callers pass request=true
 * only from a click handler.
 */
export async function ensurePermission(
  handle: any,
  request = false,
): Promise<'granted' | 'prompt' | 'denied'> {
  const opts = { mode: 'readwrite' as const }
  let perm: string = await handle.queryPermission(opts)
  if (perm !== 'granted' && request) {
    perm = await handle.requestPermission(opts)
  }
  return perm as 'granted' | 'prompt' | 'denied'
}

/** Fast, non-cryptographic content hash (FNV-1a) for change detection. */
function hashContent(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

async function writeNote(
  root: any,
  path: string,
  content: string,
  dirCache: Map<string, any>,
): Promise<void> {
  const parts = path.split('/')
  const fileName = parts.pop()!
  let dir = root
  let acc = ''
  for (const p of parts) {
    acc += p + '/'
    const cached = dirCache.get(acc)
    if (cached) {
      dir = cached
      continue
    }
    dir = await dir.getDirectoryHandle(p, { create: true })
    dirCache.set(acc, dir)
  }
  const fileHandle = await dir.getFileHandle(fileName, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(content)
  await writable.close()
}

export interface VaultSyncProgress {
  done: number
  total: number
  written: number
  skipped: number
}

export interface VaultSyncResult {
  written: number
  skipped: number
  total: number
}

/**
 * Write each record as a Markdown note into the vault, skipping notes whose
 * content is unchanged since the last sync. Deletions are intentionally not
 * mirrored — we never remove files the user may have edited.
 */
export async function syncToVault(
  handle: any,
  records: DataType[],
  onProgress?: (p: VaultSyncProgress) => void,
): Promise<VaultSyncResult> {
  const manifest = (await metaGet<Manifest>(MANIFEST_KEY)) || {}
  const usedPaths = new Set<string>()
  const dirCache = new Map<string, any>()
  let written = 0
  let skipped = 0

  for (let i = 0; i < records.length; i++) {
    const note = obsidianNote(records[i])
    // De-dup identical paths within this run (same handle+id collisions).
    let path = note.path
    let n = 0
    while (usedPaths.has(path)) {
      n++
      path = note.path.replace(/\.md$/, `-${n}.md`)
    }
    usedPaths.add(path)

    const hash = hashContent(note.content)
    if (manifest[path] === hash) {
      skipped++
    } else {
      await writeNote(handle, path, note.content, dirCache)
      manifest[path] = hash
      written++
      // Persist periodically so a mid-run failure doesn't lose all progress.
      if (written % 25 === 0) await metaSet(MANIFEST_KEY, manifest)
    }
    onProgress?.({ done: i + 1, total: records.length, written, skipped })
  }

  await metaSet(MANIFEST_KEY, manifest)
  return { written, skipped, total: records.length }
}
