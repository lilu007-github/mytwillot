import { createEffect, createSignal, For, onMount, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import { A, useSearchParams } from '@solidjs/router'
import debounce from 'lodash.debounce'

import { createStyleSheet } from 'utils/dom'
import dataStore from './store'
import Indicator from '../components/Indicator'
import Authenticate from './Authenticate'
import Search from './Search'
import {
  initSync,
  syncBookmarkChanges,
  queryByCondition,
  resetQuery,
  syncThreads,
  smartTagging,
} from './handlers'
import { Alert } from '../components/Alert'
import Notification from '../components/Notification'
import {
  IconBookmark,
  IconCrown,
  IconExport,
  IconFolderMove,
  IconFolders,
  IconLicense,
  IconMessage,
  IconMoon,
  IconSparkles,
  IconSun,
  IconUp,
} from '../components/Icons'
import ZenMode from '../components/ZenMode'
import logo from '../../public/img/logo-128.png'
import { allCategories } from '../constants'
import { initFolders } from '../stores/folders'
import AsideFolder from '../components/AsideFolder'
import { getCurrentUserId, onLocalChanged, StorageKeys } from 'utils/storage'
import { getLicense, isViolatedLicense, LICENSE_KEY } from 'utils/license'
import Spinner from '~/components/Spinner'
import { PRICING_URL } from '~/libs/member'

export const Layout = (props) => {
  const [store, setStore] = dataStore
  const [searchParams] = useSearchParams()
  const isPremium = () => store[LICENSE_KEY] && store[LICENSE_KEY].level > 0
  const [bookmarksOpen, setBookmarksOpen] = createSignal(true)
  const [foldersOpen, setFoldersOpen] = createSignal(true)

  createEffect(() => {
    if (searchParams.q) {
      setStore('keyword', searchParams.q)
    }
  })

  createEffect(() => {
    queryByCondition()
  })

  createEffect(() => {
    const font = store.activeFont
    if (font) {
      createStyleSheet(font.url, 'active-font')
    }
  })

  createEffect(() => {
    const theme = store.theme
    if (theme) {
      document.documentElement.classList.replace(
        theme === 'light' ? 'dark' : 'light',
        theme,
      )
      localStorage.setItem('theme', theme)
    }
  })

  onMount(async () => {
    const license = await getLicense()
    setStore(LICENSE_KEY, license)
    setInterval(async () => {
      const violated = await isViolatedLicense()
      if (violated) {
        alert(
          'Upgrade your license to continue using multiple accounts feature.',
        )
      }
    }, 60 * 1000)

    const handler = debounce((changes) => {
      if (StorageKeys.Tasks in changes) {
        syncBookmarkChanges()
      }
    }, 3000)
    onLocalChanged(handler)

    const user_id = await getCurrentUserId()
    if (!user_id) {
      setStore('isAuthFailed', true)
      return
    }

    /**
     * 优先获取全部书签和文件夹同步，threads 优先级可以降低
     */
    await Promise.all([initSync(), initFolders()])
    await syncThreads()
  })

  return (
    <>
      <nav
        class={`text-gary-700 fixed top-0 z-50 w-full border-b border-gray-200 bg-white text-base text-gray-700 dark:border-gray-700 dark:bg-[#121212] dark:text-white ${store.selectedTweet > -1 ? 'hidden' : ''}`}
      >
        <div class="px-3 py-3 lg:px-5 lg:pl-3">
          <div class="flex items-center justify-between">
            <div class="flex w-full flex-col items-center justify-start space-y-4 lg:w-auto lg:flex-row lg:space-y-0 rtl:justify-end">
              <a
                href="https://twillot.com?utm_source=extension"
                target="_blank"
                class="ms-2 flex w-60"
              >
                <img src={logo} class="me-3 h-8" />
                <span class="flex-1 self-center whitespace-nowrap text-xl font-semibold">
                  Twillot
                </span>
              </a>
              <div class="flex w-full lg:w-[500px]">
                <Search />
              </div>
            </div>
            <div class="fixed right-4 top-4 items-center lg:static lg:flex">
              <div class="ms-3 flex items-center gap-4">
                <button
                  class="cursor-pointer"
                  onClick={() =>
                    setStore(
                      'theme',
                      store.theme === 'light' ? 'dark' : 'light',
                    )
                  }
                >
                  <Show when={store.theme === 'light'} fallback={<IconMoon />}>
                    <IconSun />
                  </Show>
                </button>
                <a
                  href="https://s.twillot.com/chat-with-twillot"
                  target="_blank"
                >
                  <IconMessage />
                </a>
              </div>
            </div>
          </div>
        </div>
      </nav>

      <Show when={!store.isSidePanel}>
        <aside
          class={`fixed left-0 top-0 z-40 hidden h-screen w-64 -translate-x-full border-r border-gray-200 bg-white pt-20 text-lg text-gray-700 transition-transform sm:translate-x-0 lg:block dark:border-gray-700 dark:bg-[#121212] dark:text-white ${store.selectedTweet > -1 ? 'hidden' : ''}`}
        >
          <div class="h-full overflow-y-auto px-3 pb-4 ">
            <ul class="space-y-1 font-medium">
              <li>
                <A
                  href="/"
                  class="flex w-full items-center rounded-lg p-2 transition duration-75 hover:bg-gray-100 dark:hover:bg-gray-700"
                  onClick={() => {
                    resetQuery()
                    setBookmarksOpen(true)
                  }}
                >
                  <IconBookmark />
                  <span class="ms-3 flex-1 whitespace-nowrap text-left rtl:text-right">
                    Bookmarks
                  </span>
                  <span class="ms-1 inline-flex items-center justify-center rounded-full text-xs opacity-60">
                    <Show when={store.totalCount}>
                      {store.totalCount.total}
                    </Show>
                  </span>
                  <svg
                    class={`ms-2 h-4 w-4 shrink-0 transition-transform duration-200 ${bookmarksOpen() ? 'rotate-180' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    stroke-width="2"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setBookmarksOpen(!bookmarksOpen())
                    }}
                  >
                    <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </A>
                <Show when={bookmarksOpen()}>
                  <ul class="space-y-1 py-1 text-base">
                    <For each={allCategories}>
                      {(category) => {
                        return (
                          <li class="cursor-pointer">
                            <A
                              href="/"
                              class={`flex w-full items-center rounded-lg p-1 pl-11 transition duration-75  ${category.value === store.category ? 'text-blue-500' : ''}`}
                              onClick={() => setStore('category', category.value)}
                            >
                              {category.name}
                              <span class="mr-1 flex-1 items-center rounded-full text-right text-xs opacity-60">
                                <Show when={store.totalCount}>
                                  {
                                    store.totalCount[
                                      category.value.replace(/has_|is_/, '')
                                    ]
                                  }
                                </Show>
                              </span>
                            </A>
                          </li>
                        )
                      }}
                    </For>
                  </ul>
                </Show>
              </li>
              <li>
                <button
                  class="flex w-full items-center rounded-lg p-2 transition duration-75 hover:bg-gray-100 dark:hover:bg-gray-700"
                  onClick={() => setFoldersOpen(!foldersOpen())}
                >
                  <IconFolders />
                  <span class="ms-3 flex-1 whitespace-nowrap text-left">Folders</span>
                  <span
                    class="ms-1 inline-flex cursor-pointer items-center justify-center rounded-full text-xs opacity-60"
                    onClick={(e) => {
                      e.stopPropagation()
                      smartTagging()
                    }}
                  >
                    <Show
                      when={store.isTagging}
                      fallback={
                        <span class="animate-spin">
                          <IconSparkles />
                        </span>
                      }
                    >
                      <Spinner className="h-4 w-4 fill-gray-700 text-gray-200 dark:text-gray-600" />
                    </Show>
                  </span>
                  <svg
                    class={`ms-2 h-4 w-4 shrink-0 transition-transform duration-200 ${foldersOpen() ? 'rotate-180' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                <Show when={foldersOpen()}>
                  <Show when={store.totalCount}>
                    <div class="text-base">
                      <A
                        href="/"
                        class={`${'Unsorted' === store.folder ? 'text-blue-500 ' : ''} flex w-full items-center rounded-lg p-1 pl-11 transition duration-75`}
                        onClick={() => setStore('folder', 'Unsorted')}
                      >
                        Unsorted
                        <div class="ml-4 hidden flex-1 items-center justify-end gap-2">
                          <Show when={store.keyword}>
                            <span class="cursor-pointer">
                              <IconFolderMove />
                            </span>
                          </Show>
                        </div>
                        <span class="mr-1 flex-1 items-center text-right text-xs font-medium opacity-60">
                          {store.totalCount.unsorted}
                        </span>
                      </A>
                    </div>
                  </Show>
                  <AsideFolder />
                </Show>
              </li>
              <li>
                <A
                  class="flex items-center rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-gray-700"
                  href="/users"
                >
                  <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                  </svg>
                  <span class="ms-3 flex-1 whitespace-nowrap">Users</span>
                </A>
              </li>
              <li>
                <A
                  class="cursor-d flex items-center rounded-lg p-2  hover:bg-gray-100 dark:hover:bg-gray-700"
                  href="/export"
                >
                  <IconExport />
                  <span class="ms-3 flex-1 whitespace-nowrap">Export</span>
                  <span
                    class={`ms-3 inline-flex scale-75 items-center justify-center rounded-full text-xs ${isPremium() ? 'text-yellow-400' : 'text-gray-500'}`}
                  >
                    <IconCrown />
                  </span>
                </A>
              </li>
              <li>
                <A
                  class="cursor-d flex items-center rounded-lg p-2  hover:bg-gray-100 dark:hover:bg-gray-700"
                  href="/license"
                >
                  <IconLicense />
                  <span class="ms-3 flex-1 whitespace-nowrap">License</span>
                </A>
              </li>
            </ul>
          </div>
        </aside>
      </Show>

      <main class="bg-white text-gray-700 lg:ml-72 dark:bg-[#121212] dark:text-white">
        <div
          class={`flex-col items-center pt-28 lg:pt-[64px] ${store.selectedTweet > -1 ? 'hidden' : ''}`}
        >
          <div class="mx-auto hidden lg:block lg:w-[48rem]">
            <Show when={store.isAuthFailed}>
              <Authenticate />
            </Show>
            <Show when={store.isForceSyncTimedout}>
              <Alert
                message={
                  <>
                    <span class="font-medium">
                      Sync timed out, but that's not a big problem:
                    </span>
                    <ul class="mt-1.5 list-inside list-disc">
                      <li>All your synced tweets are available from now on.</li>
                      <li>
                        Refresh this page to continue syncing from where it last
                        failed.
                      </li>
                      <li>
                        If this problem persists, join our
                        <a
                          href="https://x.com/i/communities/1796857620672008306"
                          target="_blank"
                          class="text-blue-500 underline"
                        >
                          &nbsp;community&nbsp;
                        </a>
                        to get help from developers.
                      </li>
                    </ul>
                  </>
                }
                type="error"
              />
            </Show>
            <Show when={store.isForceSyncing}>
              <Indicator
                text={
                  <div class="text-center">
                    Sync in progress: {store.totalCount.total} tweets.
                  </div>
                }
              />
            </Show>
          </div>

          {props.children}
        </div>
        <Portal>
          <ZenMode />
          <Notification />
          <button
            class="fixed bottom-10 right-10 z-50 h-14 w-14 rounded-full border-0 bg-purple-500 p-4 text-lg font-semibold text-white opacity-40 shadow-md transition-colors duration-300 hover:bg-purple-700 hover:opacity-100"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          >
            <IconUp />
          </button>
        </Portal>
      </main>
    </>
  )
}

export default Layout
