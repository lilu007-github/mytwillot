import { createSignal, onMount, Show } from 'solid-js'

import { findRecords } from 'utils/db/tweets'
import dataStore from '../options/store'
import {
  isVaultSyncSupported,
  pickVaultDirectory,
  getSavedVaultHandle,
  ensurePermission,
  syncToVault,
  forgetVault,
  type VaultSyncProgress,
} from '../libs/vault'

/**
 * "Sync to Obsidian vault" — pick a folder once (File System Access API),
 * then one-click incremental writes of one Markdown note per bookmark straight
 * into the vault. No zip, no manual unzip.
 */
export default function VaultSync() {
  const [store] = dataStore
  const supported = isVaultSyncSupported()

  const [folderName, setFolderName] = createSignal<string | null>(null)
  const [needsReconnect, setNeedsReconnect] = createSignal(false)
  const [syncing, setSyncing] = createSignal(false)
  const [progress, setProgress] = createSignal<VaultSyncProgress | null>(null)
  const [result, setResult] = createSignal<string | null>(null)
  const [error, setError] = createSignal<string | null>(null)

  let handle: any = null

  onMount(async () => {
    if (!supported) return
    try {
      handle = await getSavedVaultHandle()
      if (handle) {
        setFolderName(handle.name)
        const perm = await ensurePermission(handle, false)
        setNeedsReconnect(perm !== 'granted')
      }
    } catch {
      // ignore — user can re-pick
    }
  })

  const choose = async () => {
    setError(null)
    try {
      handle = await pickVaultDirectory()
      setFolderName(handle.name)
      setNeedsReconnect(false)
      setResult(null)
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        setError(e?.message || 'Failed to choose folder')
      }
    }
  }

  const sync = async () => {
    setError(null)
    setResult(null)
    if (!handle) {
      await choose()
      if (!handle) return
    }
    try {
      const perm = await ensurePermission(handle, true)
      if (perm !== 'granted') {
        setNeedsReconnect(true)
        setError('Permission to write to the vault folder was denied.')
        return
      }
      setNeedsReconnect(false)
      setSyncing(true)
      const max = store.totalCount?.total || 100000
      const records = await findRecords('', '', '', '', max)
      if (records.length === 0) {
        setError('No bookmarks to sync.')
        return
      }
      const res = await syncToVault(handle, records, setProgress)
      setResult(
        `Done: ${res.written} note${res.written === 1 ? '' : 's'} written, ${res.skipped} unchanged (of ${res.total}).`,
      )
    } catch (e: any) {
      setError(e?.message || 'Sync failed')
    } finally {
      setSyncing(false)
      setProgress(null)
    }
  }

  const disconnect = async () => {
    await forgetVault()
    handle = null
    setFolderName(null)
    setNeedsReconnect(false)
    setResult(null)
  }

  return (
    <div class="mb-4 rounded-md border border-gray-200 p-4 dark:border-gray-700">
      <div class="w-full border-b pb-4 pt-2 text-lg font-bold text-gray-900 outline-none dark:border-gray-600 dark:border-b-[#121212] dark:bg-[#121212] dark:text-white">
        Sync to Obsidian vault
      </div>

      <div class="p-4 text-sm">
        <Show
          when={supported}
          fallback={
            <p class="text-gray-500">
              This browser doesn't support the File System Access API. Use the
              “Obsidian vault (.zip)” export above instead.
            </p>
          }
        >
          <p class="mb-4 text-gray-500">
            Pick your vault folder once, then sync bookmarks straight in as
            Markdown notes. Only new or changed notes are written; your edits
            and deleted-in-app notes are left untouched.
          </p>

          <div class="mb-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              class="rounded-lg border border-gray-300 px-4 py-2 font-medium hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-700"
              onClick={choose}
              disabled={syncing()}
            >
              {folderName() ? 'Change folder' : 'Choose vault folder'}
            </button>

            <Show when={folderName()}>
              <span class="text-gray-600 dark:text-gray-300">
                📁 {folderName()}
              </span>
              <button
                type="button"
                class="text-xs text-gray-400 hover:text-red-500 hover:underline"
                onClick={disconnect}
                disabled={syncing()}
              >
                disconnect
              </button>
            </Show>
          </div>

          <Show when={needsReconnect()}>
            <p class="mb-3 text-xs text-amber-600">
              Reconnect needed — click “Sync now” to re-grant folder access.
            </p>
          </Show>

          <button
            type="button"
            class="mb-2 flex items-center gap-2 rounded-lg bg-blue-700 px-5 py-2.5 font-medium text-white hover:bg-blue-800 focus:outline-none focus:ring-4 focus:ring-blue-300 disabled:opacity-60 dark:bg-blue-600 dark:hover:bg-blue-700"
            onClick={sync}
            disabled={syncing()}
          >
            <Show when={syncing()} fallback="Sync now">
              <span>
                Syncing…{' '}
                <Show when={progress()}>
                  {progress()!.done}/{progress()!.total}
                </Show>
              </span>
            </Show>
          </button>

          <Show when={result()}>
            <p class="mt-2 text-green-600">{result()}</p>
          </Show>
          <Show when={error()}>
            <p class="mt-2 text-red-500">{error()}</p>
          </Show>
        </Show>
      </div>
    </div>
  )
}
