import { createSignal, onMount, Show } from 'solid-js'

import { findRecords } from 'utils/db/tweets'
import {
  getObsidianSettings,
  setObsidianSettings,
  testObsidianRest,
  pushAllToRest,
  resetRestManifest,
  DEFAULT_OBSIDIAN_SETTINGS,
  type ObsidianRestSettings,
  type RestPushProgress,
} from 'utils/obsidian-rest'
import dataStore from '../options/store'

/**
 * "Send to Obsidian (Local REST API)" — configure the plugin host/key/vault,
 * test the connection, and push bookmarks as notes over the local REST server.
 * Incremental: only changed notes are PUT.
 */
export default function ObsidianRest() {
  const [store] = dataStore
  const [settings, setSettings] = createSignal<ObsidianRestSettings>(
    DEFAULT_OBSIDIAN_SETTINGS,
  )
  const [saved, setSaved] = createSignal(false)
  const [testing, setTesting] = createSignal(false)
  const [testMsg, setTestMsg] = createSignal<{ ok: boolean; text: string } | null>(
    null,
  )
  const [pushing, setPushing] = createSignal(false)
  const [progress, setProgress] = createSignal<RestPushProgress | null>(null)
  const [result, setResult] = createSignal<string | null>(null)
  const [error, setError] = createSignal<string | null>(null)

  onMount(async () => {
    setSettings(await getObsidianSettings())
  })

  const update = (patch: Partial<ObsidianRestSettings>) => {
    setSettings({ ...settings(), ...patch })
    setSaved(false)
    setTestMsg(null)
  }

  const save = async () => {
    await setObsidianSettings(settings())
    setSaved(true)
  }

  const test = async () => {
    setTesting(true)
    setTestMsg(null)
    try {
      await setObsidianSettings(settings())
      const res = await testObsidianRest(settings())
      setTestMsg({ ok: res.ok, text: res.message })
    } finally {
      setTesting(false)
    }
  }

  const push = async () => {
    setError(null)
    setResult(null)
    if (!settings().apiKey) {
      setError('Enter your Local REST API key first.')
      return
    }
    try {
      await setObsidianSettings(settings())
      setPushing(true)
      const max = store.totalCount?.total || 100000
      const records = await findRecords('', '', '', '', max)
      if (records.length === 0) {
        setError('No bookmarks to send.')
        return
      }
      const res = await pushAllToRest(records, settings(), setProgress)
      setResult(
        `Done: ${res.written} note${res.written === 1 ? '' : 's'} sent, ${res.skipped} unchanged (of ${res.total}).`,
      )
    } catch (e: any) {
      setError(
        `${e?.message || 'Push failed'} — check the host, key, and that the plugin's HTTP server is enabled.`,
      )
    } finally {
      setPushing(false)
      setProgress(null)
    }
  }

  const inputCls =
    'w-full rounded border border-gray-300 px-2 py-1.5 dark:border-gray-600 dark:bg-gray-800'

  return (
    <div class="mb-4 rounded-md border border-gray-200 p-4 dark:border-gray-700">
      <div class="w-full border-b pb-4 pt-2 text-lg font-bold text-gray-900 outline-none dark:border-gray-600 dark:border-b-[#121212] dark:bg-[#121212] dark:text-white">
        Send to Obsidian (Local REST API)
      </div>

      <div class="p-4 text-sm">
        <p class="mb-4 text-gray-500">
          Requires the{' '}
          <a
            href="https://github.com/coddingtonbear/obsidian-local-rest-api"
            target="_blank"
            class="text-blue-500 hover:underline"
          >
            Local REST API
          </a>{' '}
          Obsidian plugin. Default host uses the plugin's non-encrypted HTTP
          server — enable it in the plugin settings (or point host at the HTTPS
          port if you've trusted its certificate).
        </p>

        <div class="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-[6rem_1fr] sm:items-center">
          <label class="font-medium">Host</label>
          <input
            class={inputCls}
            value={settings().host}
            placeholder="http://127.0.0.1:27123"
            onInput={(e) => update({ host: e.currentTarget.value })}
          />
          <label class="font-medium">API key</label>
          <input
            class={inputCls}
            type="password"
            value={settings().apiKey}
            placeholder="Bearer token from the plugin"
            onInput={(e) => update({ apiKey: e.currentTarget.value })}
          />
          <label class="font-medium">Vault name</label>
          <input
            class={inputCls}
            value={settings().vault}
            placeholder="(optional) for the per-tweet Obsidian button"
            onInput={(e) => update({ vault: e.currentTarget.value })}
          />
        </div>

        <div class="mb-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            class="rounded-lg border border-gray-300 px-4 py-2 font-medium hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-700"
            onClick={save}
          >
            {saved() ? 'Saved ✓' : 'Save'}
          </button>
          <button
            type="button"
            class="rounded-lg border border-gray-300 px-4 py-2 font-medium hover:bg-gray-100 disabled:opacity-60 dark:border-gray-600 dark:hover:bg-gray-700"
            onClick={test}
            disabled={testing()}
          >
            {testing() ? 'Testing…' : 'Test connection'}
          </button>
          <button
            type="button"
            class="rounded-lg bg-blue-700 px-5 py-2 font-medium text-white hover:bg-blue-800 disabled:opacity-60 dark:bg-blue-600 dark:hover:bg-blue-700"
            onClick={push}
            disabled={pushing()}
          >
            <Show when={pushing()} fallback="Send now">
              <span>
                Sending…{' '}
                <Show when={progress()}>
                  {progress()!.done}/{progress()!.total}
                </Show>
              </span>
            </Show>
          </button>
          <button
            type="button"
            class="text-xs text-gray-400 hover:text-amber-600 hover:underline"
            title="Forget which notes were already sent, so the next push re-sends all"
            onClick={() => resetRestManifest()}
          >
            reset sync state
          </button>
        </div>

        <Show when={testMsg()}>
          <p class={testMsg()!.ok ? 'text-green-600' : 'text-red-500'}>
            {testMsg()!.text}
          </p>
        </Show>
        <Show when={result()}>
          <p class="mt-1 text-green-600">{result()}</p>
        </Show>
        <Show when={error()}>
          <p class="mt-1 text-red-500">{error()}</p>
        </Show>
      </div>
    </div>
  )
}
