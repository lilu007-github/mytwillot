import { For, Show, createSignal, onCleanup, onMount } from 'solid-js'

import type { ColumnDef } from './types'

interface ColumnConfigProps {
  columns: ColumnDef[]
  visibility: Record<string, boolean>
  onToggle: (columnKey: string) => void
}

export default function ColumnConfig(props: ColumnConfigProps) {
  const [open, setOpen] = createSignal(false)
  let containerRef: HTMLDivElement | undefined

  const visibleCount = () =>
    Object.values(props.visibility).filter(Boolean).length

  const handleClickOutside = (e: MouseEvent) => {
    if (containerRef && !containerRef.contains(e.target as Node)) {
      setOpen(false)
    }
  }

  onMount(() => {
    document.addEventListener('mousedown', handleClickOutside)
  })

  onCleanup(() => {
    document.removeEventListener('mousedown', handleClickOutside)
  })

  return (
    <div class="relative" ref={containerRef}>
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:hover:bg-gray-700"
        onClick={() => setOpen(!open())}
      >
        <svg
          class="h-4 w-4"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="1.5"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75"
          />
        </svg>
        Columns
      </button>
      <Show when={open()}>
        <div class="absolute right-0 z-50 mt-1 w-56 rounded-lg border border-gray-200 bg-white p-3 shadow-lg dark:border-gray-700 dark:bg-gray-800">
          <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Toggle columns
          </div>
          <div class="flex flex-col gap-1">
            <For each={props.columns}>
              {(col) => {
                const isVisible = () => props.visibility[col.key] ?? true
                const isDisabled = () => isVisible() && visibleCount() <= 1

                return (
                  <label
                    class={`flex items-center justify-between rounded px-2 py-1.5 ${
                      isDisabled()
                        ? 'cursor-not-allowed opacity-50'
                        : 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}
                  >
                    <span class="text-sm text-gray-700 dark:text-gray-200">
                      {col.label}
                    </span>
                    <input
                      type="checkbox"
                      class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      checked={isVisible()}
                      disabled={isDisabled()}
                      onChange={() => props.onToggle(col.key)}
                    />
                  </label>
                )
              }}
            </For>
          </div>
        </div>
      </Show>
    </div>
  )
}
