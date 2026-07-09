import { createSignal, For, Show } from 'solid-js'

import { TAG_COLORS } from 'utils/types'
import {
  tagState,
  createTag,
  deleteTag,
  setTagColor,
} from '../stores/tags'
import dataStore from '../options/store'
import { IconTag, IconTrash } from './Icons'

interface TagPanelProps {
  isOpen: boolean
  onToggle: () => void
}

/**
 * Sidebar panel: manage colored tags (create / recolor / delete) and click a
 * tag to filter the current tweet view by it.
 */
export default function TagPanel(props: TagPanelProps) {
  const [store, setStore] = dataStore
  const [newName, setNewName] = createSignal('')
  const [newColor, setNewColor] = createSignal(TAG_COLORS[0])
  const [error, setError] = createSignal<string | null>(null)
  const [colorPickerFor, setColorPickerFor] = createSignal<string | null>(null)

  const handleCreate = async (e: Event) => {
    e.preventDefault()
    const name = newName().trim()
    if (!name) return
    try {
      await createTag(name, newColor())
      setNewName('')
      setError(null)
    } catch (err: any) {
      setError(err.message || 'Failed to create tag')
    }
  }

  const toggleFilter = (name: string) => {
    setStore('tag', store.tag === name ? '' : name)
  }

  return (
    <div>
      <button
        class="flex w-full items-center rounded-lg p-2 transition duration-75 hover:bg-gray-100 dark:hover:bg-gray-700"
        onClick={props.onToggle}
      >
        <IconTag />
        <span class="ms-3 flex-1 whitespace-nowrap text-left">Tags</span>
        <svg
          class={`ms-2 h-4 w-4 shrink-0 transition-transform duration-200 ${props.isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <Show when={props.isOpen}>
        <div class="space-y-1 py-1 text-base">
          <ul class="space-y-1">
            <For each={tagState.tags}>
              {(tag) => (
                <li class="group flex items-center rounded-lg p-1 pl-11">
                  <span
                    class="h-3 w-3 shrink-0 cursor-pointer rounded-full"
                    style={{ 'background-color': tag.color }}
                    title="Change color"
                    onClick={(e) => {
                      e.stopPropagation()
                      setColorPickerFor(
                        colorPickerFor() === tag.name ? null : tag.name,
                      )
                    }}
                  />
                  <span
                    class={`ml-2 flex-1 cursor-pointer truncate ${
                      store.tag === tag.name ? 'text-blue-500' : ''
                    }`}
                    onClick={() => toggleFilter(tag.name)}
                  >
                    {tag.name}
                  </span>
                  <span class="mr-1 text-xs opacity-60 group-hover:hidden">
                    {tagState.counts[tag.name] ?? 0}
                  </span>
                  <span
                    class="hidden cursor-pointer group-hover:inline"
                    onClick={() => deleteTag(tag.name)}
                  >
                    <IconTrash />
                  </span>
                </li>
              )}
            </For>
          </ul>

          <Show when={colorPickerFor()}>
            <div class="flex flex-wrap gap-1 px-11 py-1">
              <For each={TAG_COLORS}>
                {(c) => (
                  <span
                    class="h-4 w-4 cursor-pointer rounded-full ring-offset-1 hover:ring-2"
                    style={{ 'background-color': c }}
                    onClick={() => {
                      setTagColor(colorPickerFor()!, c)
                      setColorPickerFor(null)
                    }}
                  />
                )}
              </For>
            </div>
          </Show>

          {/* Create tag form */}
          <form class="flex w-full items-center gap-1 p-1 pl-11" onSubmit={handleCreate}>
            <span
              class="h-4 w-4 shrink-0 cursor-pointer rounded-full"
              style={{ 'background-color': newColor() }}
              onClick={() => {
                const i = TAG_COLORS.indexOf(newColor())
                setNewColor(TAG_COLORS[(i + 1) % TAG_COLORS.length])
              }}
              title="Click to change color"
            />
            <input
              type="text"
              class="w-full rounded border border-gray-300 px-2 py-1 text-sm placeholder-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:placeholder-gray-500"
              placeholder="New tag..."
              value={newName()}
              onInput={(e) => setNewName(e.currentTarget.value)}
            />
          </form>

          <Show when={error()}>
            <div class="px-11 text-xs text-red-500">{error()}</div>
          </Show>
        </div>
      </Show>
    </div>
  )
}
