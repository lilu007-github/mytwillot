import { createMemo, createSignal, For, onMount, Show } from 'solid-js'
import { useNavigate } from '@solidjs/router'

import dataStore from './store'
import {
  folderState,
  folderError,
  initFolders,
  createFolder,
  refreshFolderCounts,
  setActiveFolder,
} from '../stores/folders'
import {
  buildFolderTree,
  rolledCount as rollCount,
  type FolderTreeNode as TreeNode,
} from '../libs/folder-tree'
import { IconBookmark, IconFolder, IconFolders } from '../components/Icons'

/**
 * Collections landing page: a card grid of every bookmark folder (collection)
 * with its item count and nested sub-collections. Clicking a collection routes
 * to the bookmarks Home filtered by that folder (via ?folder=…, applied in
 * Layout). Complements the compact FolderPanel in the sidebar.
 */
export default function Collections() {
  const navigate = useNavigate()
  const [store] = dataStore
  const [newName, setNewName] = createSignal('')

  onMount(() => {
    // Ensure folders + counts are fresh even on a direct /collections landing.
    initFolders('bookmark')
    refreshFolderCounts()
  })

  // Roll a folder's own count up with all of its descendants' counts so a
  // parent collection reflects everything filed under it.
  const rolledCount = (name: string): number =>
    rollCount(name, folderState.folders, folderState.folderCounts)

  const tree = createMemo<TreeNode[]>(() => buildFolderTree(folderState.folders))

  const openFolder = (name: string) => {
    // Pre-set so the filter applies instantly; Layout also reads ?folder=.
    setActiveFolder(name)
    navigate(`/?folder=${encodeURIComponent(name)}`)
  }

  const handleCreate = async (e: Event) => {
    e.preventDefault()
    const name = newName().trim()
    if (!name) return
    try {
      await createFolder(name)
      setNewName('')
    } catch {
      // surfaced via folderError
    }
  }

  const renderChildren = (nodes: TreeNode[]) => (
    <ul class="mt-2 space-y-1 border-t border-gray-100 pt-2 dark:border-gray-700">
      <For each={nodes}>
        {(node) => (
          <li>
            <div
              class="flex cursor-pointer items-center rounded px-2 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
              onClick={(e) => {
                e.stopPropagation()
                openFolder(node.folder.name)
              }}
            >
              <IconFolder class="h-4 w-4 opacity-60" />
              <span class="ms-2 flex-1 truncate">{node.folder.name}</span>
              <span class="text-xs opacity-60">
                {rolledCount(node.folder.name)}
              </span>
            </div>
            <Show when={node.children.length > 0}>
              <div class="ms-3">{renderChildren(node.children)}</div>
            </Show>
          </li>
        )}
      </For>
    </ul>
  )

  return (
    <div class="mx-auto my-4 w-full flex-1 px-3 text-base text-gray-700 lg:w-[48rem] lg:px-0 dark:text-white">
      <div class="mb-4 flex items-center gap-2">
        <IconFolders cls="h-6 w-6" />
        <h2 class="text-xl font-semibold">Collections</h2>
        <span class="text-sm opacity-60">
          {folderState.folders.length} folders
        </span>
      </div>

      {/* Create new collection */}
      <form class="mb-5 flex gap-2" onSubmit={handleCreate}>
        <input
          type="text"
          class="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:placeholder-gray-500"
          placeholder="New collection name…"
          value={newName()}
          onInput={(e) => setNewName(e.currentTarget.value)}
        />
        <button
          type="submit"
          class="rounded-lg bg-blue-500 px-4 py-2 text-sm text-white hover:bg-blue-600 disabled:opacity-50"
          disabled={!newName().trim()}
        >
          Create
        </button>
      </form>

      <Show when={folderError()}>
        <div class="mb-3 text-sm text-red-500">{folderError()}</div>
      </Show>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* All bookmarks */}
        <div
          class="cursor-pointer rounded-xl border border-gray-200 p-4 transition hover:border-blue-400 hover:shadow-sm dark:border-gray-700"
          onClick={() => {
            setActiveFolder(null)
            navigate('/')
          }}
        >
          <div class="flex items-center">
            <IconBookmark cls="h-5 w-5 text-blue-500" />
            <span class="ms-2 flex-1 font-medium">All Bookmarks</span>
            <span class="text-sm opacity-60">
              <Show when={store.totalCount}>{store.totalCount!.total}</Show>
            </span>
          </div>
        </div>

        {/* Unsorted */}
        <div
          class="cursor-pointer rounded-xl border border-gray-200 p-4 transition hover:border-blue-400 hover:shadow-sm dark:border-gray-700"
          onClick={() => openFolder('Unsorted')}
        >
          <div class="flex items-center">
            <IconFolder class="h-5 w-5 opacity-60" />
            <span class="ms-2 flex-1 font-medium">Unsorted</span>
            <span class="text-sm opacity-60">
              <Show when={store.totalCount}>{store.totalCount!.unsorted}</Show>
            </span>
          </div>
        </div>

        {/* Top-level collections */}
        <For each={tree()}>
          {(node) => (
            <div
              class="cursor-pointer rounded-xl border border-gray-200 p-4 transition hover:border-blue-400 hover:shadow-sm dark:border-gray-700"
              onClick={() => openFolder(node.folder.name)}
            >
              <div class="flex items-center">
                <IconFolder class="h-5 w-5 text-blue-500" />
                <span class="ms-2 flex-1 truncate font-medium">
                  {node.folder.name}
                </span>
                <span class="text-sm opacity-60">
                  {rolledCount(node.folder.name)}
                </span>
              </div>
              <Show when={node.children.length > 0}>
                {renderChildren(node.children)}
              </Show>
            </div>
          )}
        </For>
      </div>

      <Show when={tree().length === 0}>
        <p class="my-16 text-center text-gray-400">
          No collections yet. Create one above, or file bookmarks into a folder
          from any tweet card.
        </p>
      </Show>
    </div>
  )
}
