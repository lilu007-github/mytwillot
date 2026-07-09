import { batch, createEffect, onMount, Show } from 'solid-js'

import dataStore from './store'
import { openPage } from 'utils/dom'
import Contribution from '../components/Contribution'
import { IconChevronArrowDown, IconSparkles } from '../components/Icons'
import TopN from '../components/TopN'
import TweetList from '../components/TweetList'
import { queryByCondition, smartTagging } from './handlers'
import Filter from '../components/Filter'

export const Home = () => {
  let listRef: HTMLDivElement
  const [store, setStore] = dataStore

  // Coming back from a category view leaves dataType != 'bookmarks'; restore it.
  // The Layout's global queryByCondition effect re-runs on these field changes.
  onMount(() => {
    if (store.dataType !== 'bookmarks') {
      batch(() => {
        setStore('dataType', 'bookmarks')
        setStore('category', '')
        setStore('tag', '')
      })
    }
  })

  createEffect(() => {
    if (store.tweets.length > 0) {
      listRef.scrollTo(0, 0)
    }
  })

  return (
    <div
      class="mx-auto my-4 w-full flex-1 text-base text-gray-700 lg:w-[48rem] dark:text-white"
      onClick={openPage}
      ref={listRef!}
    >
      <Show when={!store.isSidePanel}>
        <div class="mb-4 px-3 lg:px-0">
          <Contribution />
        </div>

        <div class="relative mb-6 rounded-md py-4">
          <h3 class="text-lg font-medium">
            Top 10 Authors from your bookmarks
          </h3>

          <div class="flex justify-center">
            <Show
              when={store.topUsers.length > 0}
              fallback={
                <div class="flex h-[480px] w-[480px] items-center justify-center"></div>
              }
            >
              <TopN users={store.topUsers} stageSize={480} />
            </Show>
          </div>
        </div>
      </Show>

      <div class="mb-4">
        <Show when={!store.isSidePanel}>
          <div class="mb-2 flex justify-end px-3 lg:px-0">
            <button
              class="inline-flex items-center gap-2 rounded-lg bg-purple-500 px-3 py-1.5 text-sm text-white hover:bg-purple-600 disabled:opacity-50"
              disabled={store.isTagging}
              onClick={(e) => {
                e.stopPropagation()
                smartTagging()
              }}
            >
              <IconSparkles />
              <span>{store.isTagging ? 'Organizing…' : 'AI Auto-Organize'}</span>
            </button>
          </div>
        </Show>
        <Filter />
        <TweetList
          tweets={store.tweets}
          keyword={store.keyword}
          isSidePanel={store.isSidePanel}
          showBookmarkAction={true}
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

export default Home
