import { For, Show, createMemo, createSignal } from 'solid-js'

import { IconTag } from './Icons'
import { tagState, toggleTweetTag } from '../stores/tags'
import { mutateStore } from '../options/store'
import type { Tweet } from 'utils/types'

/**
 * Per-tweet tag picker: renders assigned colored tag chips and a dropdown to
 * toggle any defined tag on/off. Persists to IndexedDB and syncs the store.
 */
export default function TagSelect(props: { tweet: Tweet | (() => Tweet) }) {
  const [open, setOpen] = createSignal(false)
  const tweet = createMemo(() =>
    typeof props.tweet === 'function'
      ? (props.tweet as () => Tweet)()
      : props.tweet,
  )
  const assigned = createMemo(() => tweet().tags || [])

  async function toggle(name: string) {
    const t = tweet()
    const next = await toggleTweetTag(t.id, t.tags, name)
    mutateStore((s) => {
      const rec = s.tweets.find((x) => x.id === t.id)
      if (rec) rec.tags = next
    })
  }

  return (
    <span class="relative inline-flex items-center gap-1">
      <For each={assigned()}>
        {(name) => (
          <span
            class="rounded px-1.5 py-0.5 text-xs font-medium text-white"
            style={{
              'background-color':
                tagState.tags.find((t) => t.name === name)?.color || '#64748b',
            }}
            onClick={(e) => {
              e.stopPropagation()
              toggle(name)
            }}
            title="Click to remove"
          >
            {name}
          </span>
        )}
      </For>

      <Show when={tagState.tags.length > 0}>
        <span
          onClick={(e) => {
            e.stopPropagation()
            setOpen(!open())
          }}
        >
          <IconTag />
        </span>
      </Show>

      <Show when={open()}>
        <div
          class="absolute right-0 top-6 z-20 max-h-64 w-44 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
          onClick={(e) => e.stopPropagation()}
        >
          <For each={tagState.tags}>
            {(t) => (
              <div
                class="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                onClick={() => toggle(t.name)}
              >
                <span
                  class="h-3 w-3 rounded-full"
                  style={{ 'background-color': t.color }}
                />
                <span class="flex-1 text-gray-700 dark:text-gray-200">
                  {t.name}
                </span>
                <Show when={assigned().includes(t.name)}>
                  <span class="text-blue-500">✓</span>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </span>
  )
}
