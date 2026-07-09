import { createSignal, For, onMount, Show } from 'solid-js'

import {
  getTweetsContainsMedia,
  getMediaItemsIncludeQuote,
  type DownloadMediaItem,
  type MediaType,
} from 'utils/api/twitter-media'
import { IconClose } from '../components/Icons'

const FILTERS: { value: MediaType; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'image', label: 'Images' },
  { value: 'video', label: 'Videos' },
  { value: 'gif', label: 'GIFs' },
]

const LOAD_LIMIT = 600

export default function Gallery() {
  const [items, setItems] = createSignal<DownloadMediaItem[]>([])
  const [filter, setFilter] = createSignal<MediaType>('all')
  const [loading, setLoading] = createSignal(true)
  const [lightbox, setLightbox] = createSignal<DownloadMediaItem | null>(null)
  const [downloading, setDownloading] = createSignal(false)

  async function load(type: MediaType) {
    setLoading(true)
    setFilter(type)
    const records = await getTweetsContainsMedia(type, true, LOAD_LIMIT)
    const media: DownloadMediaItem[] = []
    for (const record of records) {
      media.push(...getMediaItemsIncludeQuote(record, type))
    }
    setItems(media)
    setLoading(false)
  }

  onMount(() => load('all'))

  async function downloadAll() {
    setDownloading(true)
    for (const item of items()) {
      const ext = item.media_type === 'image' ? 'jpg' : 'mp4'
      try {
        await chrome.downloads.download({
          url: item.media_url,
          filename: `twillot-media/${item.screen_name}-${item.tweet_id}-${item.key || Math.abs(hash(item.media_url))}.${ext}`,
        })
      } catch (err) {
        console.error('media download failed', err)
      }
    }
    setDownloading(false)
  }

  return (
    <div class="mx-auto my-4 w-full flex-1 px-3 text-gray-700 lg:w-[60rem] dark:text-white">
      <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div class="flex gap-2">
          <For each={FILTERS}>
            {(f) => (
              <button
                class={`rounded-full px-3 py-1 text-sm ${
                  filter() === f.value
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 dark:bg-gray-700'
                }`}
                onClick={() => load(f.value)}
              >
                {f.label}
              </button>
            )}
          </For>
        </div>
        <button
          class="rounded-lg bg-purple-500 px-3 py-1.5 text-sm text-white hover:bg-purple-600 disabled:opacity-50"
          disabled={downloading() || items().length === 0}
          onClick={downloadAll}
        >
          {downloading()
            ? 'Downloading…'
            : `Download all (${items().length})`}
        </button>
      </div>

      <Show
        when={!loading()}
        fallback={<p class="my-24 text-center text-gray-400">Loading media…</p>}
      >
        <Show
          when={items().length > 0}
          fallback={
            <p class="my-24 text-center text-gray-400">
              No media found. Sync bookmarks/likes/media first.
            </p>
          }
        >
          <div class="gap-3 [column-count:2] sm:[column-count:3] lg:[column-count:4]">
            <For each={items()}>
              {(item) => (
                <div
                  class="mb-3 cursor-pointer break-inside-avoid overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800"
                  onClick={() => setLightbox(item)}
                >
                  <Show
                    when={item.media_type === 'image'}
                    fallback={
                      <video
                        class="w-full"
                        src={item.media_url}
                        muted
                        preload="metadata"
                      />
                    }
                  >
                    <img
                      class="w-full"
                      src={item.media_url}
                      alt=""
                      loading="lazy"
                    />
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>

      {/* Lightbox */}
      <Show when={lightbox()}>
        <div
          class="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightbox(null)}
        >
          <button
            class="absolute right-6 top-6 text-white"
            onClick={() => setLightbox(null)}
          >
            <IconClose />
          </button>
          <div
            class="max-h-[90vh] max-w-[90vw]"
            onClick={(e) => e.stopPropagation()}
          >
            <Show
              when={lightbox()!.media_type === 'image'}
              fallback={
                <video
                  class="max-h-[90vh] max-w-[90vw]"
                  src={lightbox()!.media_url}
                  controls
                  autoplay
                />
              }
            >
              <img
                class="max-h-[90vh] max-w-[90vw]"
                src={lightbox()!.media_url}
                alt=""
              />
            </Show>
            <a
              class="mt-2 block text-center text-sm text-blue-300 underline"
              href={lightbox()!.tweet_url}
              target="_blank"
            >
              Open source tweet
            </a>
          </div>
        </div>
      </Show>
    </div>
  )
}

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i)
    h |= 0
  }
  return h
}
