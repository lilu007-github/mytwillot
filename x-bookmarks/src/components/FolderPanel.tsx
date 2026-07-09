import { createMemo, createSignal, For, Show } from 'solid-js'

import { type EntityScope, type Folder } from 'utils/types'
import {
  folderState,
  folderError,
  createFolder,
  deleteFolder,
  renameFolder,
  setFolderParent,
  setActiveFolder,
} from '../stores/folders'
import { IconFolders, IconTrash } from './Icons'

interface FolderPanelProps {
  scope: EntityScope
  unsortedCount: number
  isOpen: boolean
  onToggle: () => void
}

interface TreeNode {
  folder: Folder
  depth: number
  children: TreeNode[]
}

export default function FolderPanel(props: FolderPanelProps) {
  const [newFolderName, setNewFolderName] = createSignal('')
  const [editingFolder, setEditingFolder] = createSignal<string | null>(null)
  const [editName, setEditName] = createSignal('')

  // Build a nested tree from the flat parent_id list.
  const tree = createMemo<TreeNode[]>(() => {
    const folders = folderState.folders
    const byParent = new Map<string, Folder[]>()
    for (const f of folders) {
      const key = f.parent_id || '__root__'
      if (!byParent.has(key)) byParent.set(key, [])
      byParent.get(key)!.push(f)
    }
    const build = (parentKey: string, depth: number): TreeNode[] =>
      (byParent.get(parentKey) || [])
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((folder) => ({
          folder,
          depth,
          children: build(folder.name, depth + 1),
        }))
    return build('__root__', 0)
  })

  const handleCreate = async (e: Event) => {
    e.preventDefault()
    const name = newFolderName().trim()
    if (!name) return
    try {
      await createFolder(name)
      setNewFolderName('')
    } catch {
      // surfaced via folderError
    }
  }

  const handleDelete = async (name: string, e: Event) => {
    e.stopPropagation()
    try {
      await deleteFolder(name)
    } catch {
      // surfaced via folderError
    }
  }

  const handleRenameStart = (name: string, e: Event) => {
    e.stopPropagation()
    setEditingFolder(name)
    setEditName(name)
  }

  const handleRenameSubmit = async (oldName: string) => {
    const newName = editName().trim()
    setEditingFolder(null)
    if (!newName || newName === oldName) return
    try {
      await renameFolder(oldName, newName)
    } catch {
      // surfaced via folderError
    }
  }

  const handleFolderClick = (name: string) => {
    setActiveFolder(folderState.activeFolder === name ? null : name)
  }

  const handleReparent = async (name: string, parent: string) => {
    try {
      await setFolderParent(name, parent === '' ? null : parent)
    } catch {
      // surfaced via folderError
    }
  }

  // A node cannot be moved under itself or its own descendants.
  const descendantsOf = (name: string): Set<string> => {
    const out = new Set<string>()
    const walk = (n: string) => {
      for (const f of folderState.folders) {
        if (f.parent_id === n && !out.has(f.name)) {
          out.add(f.name)
          walk(f.name)
        }
      }
    }
    walk(name)
    return out
  }

  const renderNode = (node: TreeNode) => {
    const folder = node.folder
    const forbidden = createMemo(() => {
      const set = descendantsOf(folder.name)
      set.add(folder.name)
      return set
    })
    return (
      <li class="select-none">
        <Show
          when={editingFolder() !== folder.name}
          fallback={
            <div
              class="flex w-full items-center p-1"
              style={{ 'padding-left': `${1.75 + node.depth * 1}rem` }}
            >
              <input
                type="text"
                class="w-full rounded border border-gray-300 px-1 text-sm dark:border-gray-600 dark:bg-gray-800"
                value={editName()}
                onInput={(e) => setEditName(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRenameSubmit(folder.name)
                  if (e.key === 'Escape') setEditingFolder(null)
                }}
                onBlur={() => handleRenameSubmit(folder.name)}
                autofocus
              />
            </div>
          }
        >
          <div
            class={`group flex w-full cursor-pointer items-center rounded-lg p-1 transition duration-75 ${
              folderState.activeFolder === folder.name
                ? 'bg-blue-50 text-blue-500 dark:bg-blue-900/20'
                : ''
            }`}
            style={{ 'padding-left': `${1.75 + node.depth * 1}rem` }}
            onClick={() => handleFolderClick(folder.name)}
            onDblClick={(e) => handleRenameStart(folder.name, e)}
          >
            <span class="truncate">{folder.name}</span>
            <div class="ml-2 hidden flex-1 items-center justify-end gap-2 group-hover:flex">
              <select
                class="max-w-[6rem] rounded border border-gray-300 bg-white text-xs dark:border-gray-600 dark:bg-gray-800"
                title="Move under…"
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  handleReparent(folder.name, e.currentTarget.value)
                }}
              >
                <option value="" selected={!folder.parent_id}>
                  (top level)
                </option>
                <For
                  each={folderState.folders.filter(
                    (f) => !forbidden().has(f.name),
                  )}
                >
                  {(f) => (
                    <option
                      value={f.name}
                      selected={folder.parent_id === f.name}
                    >
                      {f.name}
                    </option>
                  )}
                </For>
              </select>
              <span
                class="cursor-pointer"
                onClick={(e) => handleDelete(folder.name, e)}
              >
                <IconTrash />
              </span>
            </div>
            <span class="mr-1 flex-1 items-center text-right text-xs font-medium opacity-60 group-hover:hidden">
              {folderState.folderCounts[folder.name] ?? 0}
            </span>
          </div>
        </Show>
        <Show when={node.children.length > 0}>
          <ul class="space-y-1">
            <For each={node.children}>{(child) => renderNode(child)}</For>
          </ul>
        </Show>
      </li>
    )
  }

  return (
    <div>
      <button
        class="flex w-full items-center rounded-lg p-2 transition duration-75 hover:bg-gray-100 dark:hover:bg-gray-700"
        onClick={props.onToggle}
      >
        <IconFolders />
        <span class="ms-3 flex-1 whitespace-nowrap text-left">Folders</span>
        <svg
          class={`ms-2 h-4 w-4 shrink-0 transition-transform duration-200 ${props.isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>
      <Show when={props.isOpen}>
        <div class="space-y-1 py-1 text-base">
          {/* Unsorted entry */}
          <div
            class={`flex w-full cursor-pointer items-center rounded-lg p-1 pl-11 transition duration-75 ${
              folderState.activeFolder === 'Unsorted'
                ? 'bg-blue-50 text-blue-500 dark:bg-blue-900/20'
                : ''
            }`}
            onClick={() =>
              setActiveFolder(
                folderState.activeFolder === 'Unsorted' ? null : 'Unsorted',
              )
            }
          >
            Unsorted
            <span class="mr-1 flex-1 items-center text-right text-xs font-medium opacity-60">
              {props.unsortedCount}
            </span>
          </div>

          {/* Folder tree */}
          <ul class="space-y-1">
            <For each={tree()}>{(node) => renderNode(node)}</For>
          </ul>

          {/* Create folder form */}
          <form class="flex w-full items-center p-1 pl-11" onSubmit={handleCreate}>
            <input
              type="text"
              class="w-full rounded border border-gray-300 px-2 py-1 text-sm placeholder-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:placeholder-gray-500"
              placeholder="New folder..."
              value={newFolderName()}
              onInput={(e) => setNewFolderName(e.currentTarget.value)}
            />
          </form>

          {/* Error display */}
          <Show when={folderError()}>
            <div class="px-11 text-xs text-red-500">{folderError()}</div>
          </Show>
        </div>
      </Show>
    </div>
  )
}
