/**
 * Obsidian integration via the Local REST API plugin + the obsidian:// URI.
 *
 * REST push: the `obsidian-local-rest-api` plugin runs a localhost server with
 * a Bearer key. `PUT /vault/{path}` creates/overwrites a note. HTTPS uses a
 * self-signed cert that fetch() can't bypass, so we default to the plugin's
 * opt-in HTTP endpoint (port 27123); the host is configurable.
 *
 * URI open: obsidian://new?vault=…&file=…&content=… opens/creates a single
 * note in the desktop app — length-limited, so best for one tweet at a time.
 */

import { obsidianNote, uniqueNotePath, type DataType } from './exporter'
import { fnv1aHex } from './hash'
import { fetchWithTimeout } from './fetch-timeout'

export interface ObsidianRestSettings {
  /** Base URL of the Local REST API server. */
  host: string
  /** Bearer API key from the plugin settings. */
  apiKey: string
  /** Vault name for obsidian:// URIs (optional; empty targets the last vault). */
  vault: string
}

export const DEFAULT_OBSIDIAN_SETTINGS: ObsidianRestSettings = {
  host: 'http://127.0.0.1:27123',
  apiKey: '',
  vault: '',
}

const SETTINGS_KEY = 'obsidian_settings'
const MANIFEST_KEY = 'obsidian_rest_manifest'

export async function getObsidianSettings(): Promise<ObsidianRestSettings> {
  const got = await chrome.storage.local.get(SETTINGS_KEY)
  return { ...DEFAULT_OBSIDIAN_SETTINGS, ...(got[SETTINGS_KEY] || {}) }
}

export async function setObsidianSettings(
  settings: ObsidianRestSettings,
): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings })
}

type Manifest = Record<string, string>

async function getRestManifest(): Promise<Manifest> {
  const got = await chrome.storage.local.get(MANIFEST_KEY)
  return got[MANIFEST_KEY] || {}
}

async function setRestManifest(manifest: Manifest): Promise<void> {
  await chrome.storage.local.set({ [MANIFEST_KEY]: manifest })
}

/** Clear the incremental push manifest (e.g. after changing host/vault). */
export async function resetRestManifest(): Promise<void> {
  await setRestManifest({})
}

function base(host: string): string {
  return host.replace(/\/+$/, '')
}

function vaultUrl(host: string, path: string): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  return `${base(host)}/vault/${encoded}`
}

async function putNote(
  settings: ObsidianRestSettings,
  path: string,
  content: string,
): Promise<void> {
  const res = await fetchWithTimeout(
    vaultUrl(settings.host, path),
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/markdown',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: content,
    },
    30_000,
  )
  if (!res.ok && res.status !== 204) {
    throw new Error(`REST ${res.status} ${res.statusText}`)
  }
}

export interface RestTestResult {
  ok: boolean
  message: string
}

/** Probe the server root; it reports auth status + version when reachable. */
export async function testObsidianRest(
  settings: ObsidianRestSettings,
): Promise<RestTestResult> {
  if (!settings.apiKey) {
    return { ok: false, message: 'API key is empty' }
  }
  try {
    const res = await fetchWithTimeout(
      `${base(settings.host)}/`,
      { headers: { Authorization: `Bearer ${settings.apiKey}` } },
      10_000,
    )
    if (!res.ok) {
      return { ok: false, message: `HTTP ${res.status}` }
    }
    const data = await res.json().catch(() => null as any)
    if (data && data.authenticated === false) {
      return { ok: false, message: 'Reachable, but the API key was rejected' }
    }
    const version = data?.versions?.self
    return { ok: true, message: version ? `Connected (v${version})` : 'Connected' }
  } catch (e: any) {
    return {
      ok: false,
      message:
        e?.message ||
        'Cannot reach the server (is the plugin running and the HTTP port enabled?)',
    }
  }
}

export interface RestPushProgress {
  done: number
  total: number
  written: number
  skipped: number
}

export interface RestPushResult {
  written: number
  skipped: number
  total: number
}

/**
 * Push each record to the vault via the REST API, skipping notes whose content
 * hasn't changed since the last push (content-hash manifest).
 */
export async function pushAllToRest(
  records: DataType[],
  settings: ObsidianRestSettings,
  onProgress?: (p: RestPushProgress) => void,
): Promise<RestPushResult> {
  const manifest = await getRestManifest()
  const used = new Set<string>()
  let written = 0
  let skipped = 0

  for (let i = 0; i < records.length; i++) {
    const note = obsidianNote(records[i])
    const path = uniqueNotePath(note.path, used)

    const hash = fnv1aHex(note.content)
    if (manifest[path] === hash) {
      skipped++
    } else {
      await putNote(settings, path, note.content)
      manifest[path] = hash
      written++
      if (written % 25 === 0) await setRestManifest(manifest)
    }
    onProgress?.({ done: i + 1, total: records.length, written, skipped })
  }

  await setRestManifest(manifest)
  return { written, skipped, total: records.length }
}

/**
 * Build an obsidian://new URI for a single tweet. Content is capped because
 * the OS/browser limit the length of a protocol URI.
 */
export function buildObsidianUri(
  row: DataType,
  vault: string,
  maxContentLength = 6000,
): string {
  const note = obsidianNote(row)
  const content =
    note.content.length > maxContentLength
      ? note.content.slice(0, maxContentLength) + '\n\n…(truncated)'
      : note.content
  const params = new URLSearchParams()
  if (vault) params.set('vault', vault)
  // obsidian:// appends .md itself.
  params.set('file', note.path.replace(/\.md$/, ''))
  params.set('content', content)
  return `obsidian://new?${params.toString()}`
}

/** Trigger the obsidian:// protocol without navigating the current page. */
export function openInObsidian(row: DataType, vault: string): void {
  const uri = buildObsidianUri(row, vault)
  const a = document.createElement('a')
  a.href = uri
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
}
