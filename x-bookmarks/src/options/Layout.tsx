import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import { A, useLocation, useSearchParams } from '@solidjs/router'
import debounce from 'lodash.debounce'

import { createStyleSheet } from 'utils/dom'
import { type EntityScope } from 'utils/types'
import dataStore from './store'
import Indicator from '../components/Indicator'
import AccountIndicator from '~/components/AccountIndicator'
import Authenticate from './Authenticate'
import Search from './Search'
import {
  initSync,
  syncBookmarkChanges,
  queryByCondition,
  resetQuery,
  syncThreads,
} from './handlers'
import { Alert } from '../components/Alert'
import Notification from '../components/Notification'
import {
  IconBookmark,
  IconFolders,
  IconMessage,
  IconMoon,
  IconSun,
  IconUp,
  IconExport,
} from '../components/Icons'
import { initTags } from '../stores/tags'
import ZenMode from '../components/ZenMode'
import logo from '../../public/img/logo-128.png'
import { allCategories } from '../constants'
import { folderState, initFolders, setActiveScope, setActiveFolder } from '../stores/folders'
import FolderPanel from '../components/FolderPanel'
import TagPanel from '../components/TagPanel'
import { getCurrentUserId, getStorageKey, getAuthInfo, onLocalChanged, StorageKeys } from 'utils/storage'
import { getLicense, isViolatedLicense, LICENSE_KEY } from 'utils/license'
import { getAccountRegistry, upsertAccountEntry, type AccountEntry } from 'utils/account-manager'
import { getSyncState, type SyncState } from 'utils/sync-engine'
import { refreshData as refreshGridData } from './grid/gridStore'

/**
 * Determine the entity scope from the current route pathname.
 * Returns null for pages with no entity scope (e.g., /license, /export).
 */
function getScopeFromPath(pathname: string): EntityScope | null {
  if (pathname === '/' || pathname === '/bookmarks') return 'bookmark'
  if (pathname === '/users') return 'user'
  return null
}

export const Layout = (props) => {
  const [store, setStore] = dataStore
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const [bookmarksOpen, setBookmarksOpen] = createSignal(true)
  const [foldersOpen, setFoldersOpen] = createSignal(true)
  const [tagsOpen, setTagsOpen] = createSignal(true)

  // Reactive signals for AccountIndicator
  const [activeUserId, setActiveUserId] = createSignal('')
  const [activeScreenName, setActiveScreenName] = createSignal('')
  const [activeProfileImage, setActiveProfileImage] = createSignal('')
  const [syncStatus, setSyncStatus] = createSignal<'idle' | 'syncing' | 'error'>('idle')
  const [syncProgress, setSyncProgress] = createSignal<number | undefined>(undefined)

  // Load initial account indicator data and listen for changes
  async function loadAccountIndicatorData() {
    const userId = await getCurrentUserId()
    setActiveUserId(userId)

    if (userId) {
      let registry = await getAccountRegistry()

      // Bootstrap: if the user is logged in but has no registry entry yet,
      // create a minimal one so the indicator isn't blank.
      if (!registry.find((e) => e.user_id === userId)) {
        await upsertAccountEntry({
          user_id: userId,
          last_active_at: Math.floor(Date.now() / 1000),
        })
        registry = await getAccountRegistry()
      }

      const entry = registry.find((e) => e.user_id === userId)
      if (entry) {
        setActiveScreenName(entry.screen_name)
        setActiveProfileImage(entry.profile_image_url)
      }

      const state = await getSyncState()
      setSyncStatus(state.status)
      setSyncProgress(state.status === 'syncing' ? state.progress : undefined)
    } else {
      setActiveScreenName('')
      setActiveProfileImage('')
      setSyncStatus('idle')
      setSyncProgress(undefined)
    }
  }

  onMount(() => {
    loadAccountIndicatorData()
  })

  // Listen for Chrome Storage changes to reactively update the indicator
  const storageChangeListener = (changes: Record<string, chrome.storage.StorageChange>) => {
    if (StorageKeys.Current_UID in changes) {
      const newUserId = changes[StorageKeys.Current_UID].newValue || ''
      setActiveUserId(newUserId)
      // Reload registry and sync state for the new user
      loadAccountIndicatorData()
      // Clear the store immediately so old account's data disappears
      setStore({
        tweets: [],
        totalCount: null,
        keyword: '',
        category: '',
        folder: '',
        isAuthFailed: false,
        isAutoSyncing: false,
        isForceSyncing: false,
        isForceSyncTimedout: false,
        topUsers: [],
        historySize: 0,
      })
      // Refresh the Users grid so it re-queries with the new account's owner_id
      refreshGridData()
      // Try to start sync for the new account. If the token already exists
      // (returning account), initSync will work immediately. If not (brand new
      // account), initSync will fail with AUTH_FAILED — that's fine, the token
      // watcher below will retry when the token arrives.
      if (newUserId) {
        getAuthInfo().then((auth) => {
          if (auth && auth.token) {
            Promise.all([initSync(), initFolders('bookmark')])
          }
          // else: wait for token to be written (new account, no prior session)
        })
      }
      return
    }

    // When the auth token for the active account is written (captured by the
    // background script from a Twitter request), kick off initSync + initFolders.
    // This handles brand-new accounts whose token hasn't been captured yet.
    const userId = activeUserId()
    if (userId) {
      const tokenKey = getStorageKey(StorageKeys.Token, userId)
      if (tokenKey in changes && changes[tokenKey].newValue) {
        // Token written for this account — start sync
        Promise.all([initSync(), initFolders('bookmark')])
        return
      }
    }

    // Check for account_registry changes
    if ('account_registry' in changes) {
      const registryUserId = activeUserId()
      if (registryUserId) {
        const registry: AccountEntry[] = changes['account_registry'].newValue || []
        const entry = registry.find((e) => e.user_id === registryUserId)
        if (entry) {
          setActiveScreenName(entry.screen_name)
          setActiveProfileImage(entry.profile_image_url)
        }
      }
    }

    // Check for sync_state changes (per-account key)
    const syncUserId = activeUserId()
    if (syncUserId) {
      const syncKey = getStorageKey('sync_state', syncUserId)
      if (syncKey in changes) {
        const newState: SyncState = changes[syncKey].newValue
        if (newState) {
          setSyncStatus(newState.status)
          setSyncProgress(newState.status === 'syncing' ? newState.progress : undefined)
        } else {
          setSyncStatus('idle')
          setSyncProgress(undefined)
        }
      }
    }
  }

  onMount(() => {
    chrome.storage.local.onChanged.addListener(storageChangeListener)
  })

  onCleanup(() => {
    chrome.storage.local.onChanged.removeListener(storageChangeListener)
  })

  const activeScope = createMemo(() => getScopeFromPath(location.pathname))

  // Tweet views (bookmarks Home + category pages) support tag filtering.
  const isTweetView = createMemo(
    () =>
      location.pathname === '/' ||
      location.pathname === '/bookmarks' ||
      location.pathname.startsWith('/type/'),
  )

  const unsortedCount = createMemo(() => {
    const scope = activeScope()
    if (scope === 'bookmark' && store.totalCount) {
      return store.totalCount.unsorted
    }
    // For users, unsorted count is not readily available in the store
    // Return 0 as a fallback until a dedicated count is wired
    return 0
  })

  // Watch route changes and update folder scope + clear filter
  createEffect(() => {
    const scope = activeScope()
    if (scope) {
      setActiveScope(scope)
    }
    // Clear active folder filter on navigation
    setActiveFolder(null)
  })

  // Apply a ?folder= deep-link (used by the Collections page to open a
  // collection). Runs after the reset effect above so it wins on navigation.
  // Clearing the param (e.g. clicking "Bookmarks") drops the filter. Note this
  // tracks only searchParams.folder, so sidebar FolderPanel clicks — which set
  // activeFolder without touching the URL — are not clobbered.
  createEffect(() => {
    const folder = searchParams.folder
    if (activeScope() !== 'bookmark') return
    setActiveFolder(folder ? (folder as string) : null)
  })

  // Sync folderState.activeFolder → store.folder for bookmark grid query
  // When activeFolder changes, update the main store's folder field
  // which triggers queryByCondition reactively and resets pagination
  createEffect(() => {
    const active = folderState.activeFolder
    const scope = activeScope()
    if (scope === 'bookmark') {
      // Map activeFolder to the store.folder value:
      // null → '' (show all), 'Unsorted' → 'Unsorted', folder name → folder name
      setStore('folder', active ?? '')
      // Reset tweets to clear cursor-based pagination (re-query from start)
      setStore('tweets', [])
    }
  })

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
    await Promise.all([initSync(), initFolders('bookmark'), initTags()])
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
          <div class="flex h-full flex-col overflow-y-auto px-3 pb-4">
            <AccountIndicator
              userId={activeUserId()}
              screenName={activeScreenName()}
              profileImageUrl={activeProfileImage()}
              syncStatus={syncStatus()}
              syncProgress={syncProgress()}
            />
            <ul class="flex-1 space-y-1 font-medium">
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
              <For
                each={[
                  { type: 'likes', label: 'Likes' },
                  { type: 'posts', label: 'Your Posts' },
                  { type: 'replies', label: 'Replies' },
                  { type: 'media', label: 'Media' },
                ]}
              >
                {(item) => (
                  <li>
                    <A
                      class="flex items-center rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-gray-700"
                      href={`/type/${item.type}`}
                    >
                      <IconBookmark />
                      <span class="ms-3 flex-1 whitespace-nowrap">
                        {item.label}
                      </span>
                    </A>
                  </li>
                )}
              </For>
              <li>
                <A
                  class="flex items-center rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-gray-700"
                  href="/collections"
                >
                  <IconFolders cls="h-5 w-5" />
                  <span class="ms-3 flex-1 whitespace-nowrap">Collections</span>
                </A>
              </li>
              <li>
                <A
                  class="flex items-center rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-gray-700"
                  href="/gallery"
                >
                  <svg
                    class="h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
                    />
                  </svg>
                  <span class="ms-3 flex-1 whitespace-nowrap">Gallery</span>
                </A>
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
                  class="flex items-center rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-gray-700"
                  href="/circles"
                >
                  <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <circle cx="7" cy="9" r="3.25" />
                    <circle cx="16" cy="8" r="3.25" />
                    <circle cx="12" cy="16" r="3.25" />
                  </svg>
                  <span class="ms-3 flex-1 whitespace-nowrap">Circles</span>
                </A>
              </li>
              <li>
                <A
                  class="flex items-center rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-gray-700"
                  href="/accounts"
                >
                  <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                  </svg>
                  <span class="ms-3 flex-1 whitespace-nowrap">Accounts</span>
                </A>
              </li>
              <li>
                <A
                  class="flex items-center rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-gray-700"
                  href="/export"
                >
                  <IconExport />
                  <span class="ms-3 flex-1 whitespace-nowrap">Export</span>
                </A>
              </li>
              <li>
                <A
                  class="flex items-center rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-gray-700"
                  href="/settings"
                >
                  <svg
                    class="h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.855.107 1.205l.527.737c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.855-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.505-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.855-.108-1.205l-.526-.737a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z"
                    />
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                  <span class="ms-3 flex-1 whitespace-nowrap">Settings</span>
                </A>
              </li>
            </ul>

            {/* Folder + Tag panels - sticky at bottom */}
            <Show when={activeScope() || isTweetView()}>
              <div class="sticky bottom-0 border-t border-gray-200 bg-white pt-2 dark:border-gray-700 dark:bg-[#121212]">
                <Show when={activeScope()}>
                  <FolderPanel
                    scope={activeScope()!}
                    unsortedCount={unsortedCount()}
                    isOpen={foldersOpen()}
                    onToggle={() => setFoldersOpen(!foldersOpen())}
                  />
                </Show>
                <Show when={isTweetView()}>
                  <TagPanel
                    isOpen={tagsOpen()}
                    onToggle={() => setTagsOpen(!tagsOpen())}
                  />
                </Show>
              </div>
            </Show>
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
