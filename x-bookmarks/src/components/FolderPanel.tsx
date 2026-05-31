import { createSignal, For, Show } from 'solid-js'

import { type EntityScope, type Folder } from 'utils/types'
import {
  folderState,
  folderError,
  createFolder,
  deleteFolder,
  renameFolder,
  reorderFolders,
  setActiveFolder,
} from '../stores/folders'
import { IconFolders, IconTrash } from './Icons'
import Spinner from './Spinner'
import dataStore from '../options/store'

interface FolderPanelProps {
  scope: EntityScope
  unsortedCount: number
  isOpen: boolean
  onToggle: () => void
}

export default function FolderPanel(props: FolderPanelProps) {
  const [newFolderName, setNewFolderName] = createSignal('')
  const [editingFolder, setEditingFolder] = createSignal<string | null>(null)
  const [editName, setEditName] = createSignal('')
  const [draggingIndex, setDraggingIndex] = createSignal<number | null>(null)

  const handleCreate = async (e: Event) => {
    e.preventDefault()
    const name = newFolderName().trim()
    if (!name) return
    try {
      await createFolder(name)
      setNewFolderName('')
    } catch {
      // Error surfaced via folderError signal
    }
  }

  const handleDelete = async (name: string, e: Event) => {
    e.stopPropagation()
    try {
      await deleteFolder(name)
    } catch {
      // Error surfaced via folderError signal
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
      // Error surfaced via folderError signal
    }
  }

  const handleFolderClick = (name: string) => {
    if (folderState.activeFolder === name) {
      setActiveFolder(null)
    } else {
      setActiveFolder(name)
    }
  }

  const handleUnsortedClick = () => {
    if (folderState.activeFolder === 'Unsorted') {
      setActiveFolder(null)
    } else {
      setActiveFolder('Unsorted')
    }
  }

  const handleDragStart = (index: number) => {
    setDraggingIndex(index)
  }

  const handleDragOver = (index: number, event: DragEvent) => {
    event.preventDefault()
    const draggingItemIndex = draggingIndex()
    if (draggingItemIndex === null || draggingItemIndex === index) return
  }

  const handleDragEnd = async () => {
    const fromIndex = draggingIndex()
    setDraggingIndex(null)
    if (fromIndex === null) return
    const orderedNames = folderState.folders.map((f) => f.name)
    try {
      await reorderFolders(orderedNames)
    } catch {
      // Error surfaced via folderError signal
    }
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
            onClick={handleUnsortedClick}
          >
            Unsorted
            <span class="mr-1 flex-1 items-center text-right text-xs font-medium opacity-60">
              {props.unsortedCount}
            </span>
          </div>

          {/* Folder list */}
          <ul class="space-y-1">
            <For each={folderState.folders}>
              {(folder, index) => (
                <li
                  draggable
                  onDragStart={() => handleDragStart(index())}
                  onDragOver={(event) => handleDragOver(index(), event)}
                  onDragEnd={handleDragEnd}
                  class="select-none"
                >
                  <Show
                    when={editingFolder() !== folder.name}
                    fallback={
                      <div class="flex w-full items-center p-1 pl-11">
                        <input
                          type="text"
                          class="w-full rounded border border-gray-300 px-1 text-sm dark:border-gray-600 dark:bg-gray-800"
                          value={editName()}
                          onInput={(e) => setEditName(e.currentTarget.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter')
                              handleRenameSubmit(folder.name)
                            if (e.key === 'Escape') setEditingFolder(null)
                          }}
                          onBlur={() => handleRenameSubmit(folder.name)}
                          autofocus
                        />
                      </div>
                    }
                  >
                    <div
                      class={`group flex w-full cursor-pointer items-center rounded-lg p-1 pl-11 transition duration-75 ${
                        folderState.activeFolder === folder.name
                          ? 'bg-blue-50 text-blue-500 dark:bg-blue-900/20'
                          : ''
                      }`}
                      onClick={() => handleFolderClick(folder.name)}
                      onDblClick={(e) => handleRenameStart(folder.name, e)}
                    >
                      {folder.name}
                      <div class="ml-4 hidden flex-1 items-center justify-end gap-2 group-hover:flex">
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
                </li>
              )}
            </For>
          </ul>

          {/* Create folder form */}
          <form
            class="flex w-full items-center p-1 pl-11"
            onSubmit={handleCreate}
          >
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
