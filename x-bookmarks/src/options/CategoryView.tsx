import { batch, createEffect, on, Show } from 'solid-js'
import { useParams } from '@solidjs/router'

import dataStore from './store'
import { queryByCondition } from './handlers'
import TweetList from '../components/TweetList'
import Filter from '../components/Filter'
import { openPage } from 'utils/dom'
import { IconChevronArrowDown, IconRefresh } from '../components/Icons'
import {
  syncCategory,
  syncState,
  type SyncableCategory,
} from './sync-categories'

const TITLES: Record<SyncableCategory, string> = {
  likes: 'Likes',
  posts: 'Your Posts',
  replies: 'Replies',
  media: 'Media',
}

const VALID: SyncableCategory[] = ['likes', 'posts', 'replies', 'media']

export default function CategoryView() {
  const params = useParams()
  const [store, setStore] = dataStore

  const category = (): SyncableCategory =>
    (VALID.includes(params.type as SyncableCategory)
      ? params.type
      : 'likes') as SyncableCategory

  // Switch the data-type view whenever the route param changes. The Layout's
  // global queryByCondition effect re-runs once these tracked fields change.
  createEffect(
    on(
      () => params.type,
      () => {
        batch(() => {
          setStore('dataType', category())
          setStore('category', '')
          setStore('tag', '')
          setStore('tweets', [])
        })
      },
    ),
  )

  // Re-query as a sync run brings in more records.
  createEffect(
    on(
      () => syncState[category()].done,
      (done, prev) => {
        if (prev !== undefined && done !== prev) {
          queryByCondition(false)
        }
      },
    ),
  )

  const st = () => syncState[category()]

  return (
    <div
      class="mx-auto my-4 w-full flex-1 text-base text-gray-700 lg:w-[48rem] dark:text-white"
      onClick={openPage}
    >
      <div class="mb-4 flex items-center justify-between px-3 lg:px-0">
        <h2 class="text-xl font-semibold">{TITLES[category()]}</h2>
        <button
          class="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-3 py-1.5 text-sm text-white hover:bg-blue-600 disabled:opacity-50"
          disabled={st().status === 'running'}
          onClick={() => syncCategory(category())}
        >
          <IconRefresh />
          <Show
            when={st().status === 'running' || st().status === 'paused'}
            fallback={<span>Sync {TITLES[category()]}</span>}
          >
            <span>
              {st().status === 'paused'
                ? `Rate limited — resuming…`
                : `Syncing… ${st().done}`}
            </span>
          </Show>
        </button>
      </div>

      <Show when={st().status === 'error'}>
        <p class="mb-2 px-3 text-sm text-red-500 lg:px-0">
          Sync failed: {st().error}
        </p>
      </Show>

      <div class="mb-4">
        <Filter />
        <TweetList
          tweets={store.tweets}
          keyword={store.keyword}
          isSidePanel={store.isSidePanel}
        />
        <Show
          when={store.hasMore}
          fallback={
            <p class="my-24 text-center text-gray-400">
              Total records: {store.tweets.length}
            </p>
          }
        >
          <p
            class="my-6 flex justify-center text-blue-500"
            onClick={() => queryByCondition(true)}
          >
            <IconChevronArrowDown />
          </p>
        </Show>
      </div>
    </div>
  )
}
