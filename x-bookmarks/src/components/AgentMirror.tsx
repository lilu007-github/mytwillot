import { createSignal, onMount, Show } from 'solid-js'

import { ensurePermission, isVaultSyncSupported } from '../libs/vault'
import {
  AUTO_MIRROR_INTERVAL_MS,
  forgetMirror,
  getLastMirror,
  getMirrorHandle,
  mirrorNow,
  pickMirrorDirectory,
  type MirrorResult,
} from '../libs/agent-mirror'

const SETUP = `# once, from the repo
pnpm install && pnpm --filter twillot-cli build
node packages/cli/dist/twillot.mjs init "<this folder>"

# terminal
node packages/cli/dist/twillot.mjs search "agents" --since 30d

# Claude Code (MCP)
claude mcp add twillot -- node "$PWD/packages/cli/dist/twillot.mjs" mcp`

/**
 * "Agent access" — mirror the account's data as plain files into a folder so
 * the twillot CLI / MCP server (and any agent with file access) can read it.
 */
export default function AgentMirror() {
  const supported = isVaultSyncSupported()

  const [folderName, setFolderName] = createSignal<string | null>(null)
  const [needsReconnect, setNeedsReconnect] = createSignal(false)
  const [running, setRunning] = createSignal(false)
  const [last, setLast] = createSignal<MirrorResult | null>(null)
  const [error, setError] = createSignal<string | null>(null)

  let handle: any = null

  onMount(async () => {
    if (!supported) return
    try {
      handle = await getMirrorHandle()
      setLast(await getLastMirror())
      if (handle) {
        setFolderName(handle.name)
        setNeedsReconnect((await ensurePermission(handle, false)) !== 'granted')
      }
    } catch {
      // ignore — user can re-pick
    }
  })

  const run = async () => {
    setError(null)
    try {
      const perm = await ensurePermission(handle, true)
      if (perm !== 'granted') {
        setNeedsReconnect(true)
        setError('Permission to write to the folder was denied.')
        return
      }
      setNeedsReconnect(false)
      setRunning(true)
      setLast(await mirrorNow(handle))
    } catch (e: any) {
      setError(e?.message || 'Mirror failed')
    } finally {
      setRunning(false)
    }
  }

  const choose = async () => {
    setError(null)
    try {
      handle = await pickMirrorDirectory()
      setFolderName(handle.name)
      setLast(null)
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        setError(e?.message || 'Failed to choose folder')
      }
      return
    }
    await run()
  }

  const disconnect = async () => {
    await forgetMirror()
    handle = null
    setFolderName(null)
    setNeedsReconnect(false)
    setLast(null)
  }

  return (
    <div class="mb-4 rounded-md border border-gray-200 p-4 dark:border-gray-700">
      <div class="w-full border-b pb-4 pt-2 text-lg font-bold text-gray-900 outline-none dark:border-gray-600 dark:border-b-[#121212] dark:bg-[#121212] dark:text-white">
        Agent access (CLI / MCP)
      </div>

      <div class="p-4 text-sm">
        <Show
          when={supported}
          fallback={
            <p class="text-gray-500">
              This browser doesn't support the File System Access API, which the
              data mirror needs.
            </p>
          }
        >
          <p class="mb-4 text-gray-500">
            Mirror your bookmarks, likes, posts, folders and tags as plain JSON
            files into a local folder, so the <code>twillot</code> CLI, its MCP
            server, or any AI agent can search and summarize them. The mirror
            refreshes when this page opens and every{' '}
            {AUTO_MIRROR_INTERVAL_MS / 60000} minutes while it stays open.
            Nothing leaves your machine.
          </p>

          <div class="mb-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              class="rounded-lg border border-gray-300 px-4 py-2 font-medium hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-700"
              onClick={choose}
              disabled={running()}
            >
              {folderName() ? 'Change folder' : 'Choose mirror folder'}
            </button>

            <Show when={folderName()}>
              <span class="text-gray-600 dark:text-gray-300">
                📁 {folderName()}
              </span>
              <button
                type="button"
                class="text-xs text-gray-400 hover:text-red-500 hover:underline"
                onClick={disconnect}
                disabled={running()}
              >
                disconnect
              </button>
            </Show>
          </div>

          <Show when={folderName()}>
            <Show when={needsReconnect()}>
              <p class="mb-3 text-xs text-amber-600">
                Reconnect needed — click “Mirror now” to re-grant folder access.
                Until then the automatic refresh is paused.
              </p>
            </Show>

            <button
              type="button"
              class="mb-2 rounded-lg bg-blue-700 px-5 py-2.5 font-medium text-white hover:bg-blue-800 focus:outline-none focus:ring-4 focus:ring-blue-300 disabled:opacity-60 dark:bg-blue-600 dark:hover:bg-blue-700"
              onClick={run}
              disabled={running()}
            >
              {running() ? 'Mirroring…' : 'Mirror now'}
            </button>
          </Show>

          <Show when={last()}>
            <p class="mt-2 text-green-600">
              Last mirrored {new Date(last()!.at).toLocaleString()}:{' '}
              {last()!.total} items.
            </p>
          </Show>
          <Show when={error()}>
            <p class="mt-2 text-red-500">{error()}</p>
          </Show>

          <details class="mt-4">
            <summary class="cursor-pointer text-gray-600 dark:text-gray-300">
              Set up the CLI and MCP server
            </summary>
            <pre class="mt-2 overflow-x-auto rounded bg-gray-100 p-3 text-xs dark:bg-gray-800">
              {SETUP}
            </pre>
          </details>
        </Show>
      </div>
    </div>
  )
}
