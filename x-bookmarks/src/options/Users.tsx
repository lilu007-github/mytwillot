import { createSignal, For, onMount, Show } from 'solid-js'

import { getFollowers, getFollowing } from 'utils/api/twitter-user'
import { getCurrentUserId } from 'utils/storage'
import { Endpoint, TimelineUser } from 'utils/types'
import {
  ResponseKeyPath,
  getInstructions,
  getAllInstructionDetails,
} from 'utils/api/twitter-res-utils'
import {
  StoredUser,
  getUserId,
  upsertUsers,
  findUsers,
  countUsers,
} from 'utils/db/users'
import { getRateLimitInfo } from 'utils/api/twitter-base'
import { FetchError } from 'utils/xfetch'

import Spinner from '~/components/Spinner'

type Tab = 'followers' | 'following'

export default function Users() {
  const [activeTab, setActiveTab] = createSignal<Tab>('following')
  const [users, setUsers] = createSignal<StoredUser[]>([])
  const [keyword, setKeyword] = createSignal('')
  const [isSyncing, setIsSyncing] = createSignal(false)
  const [counts, setCounts] = createSignal({ followers: 0, following: 0 })
  const [syncProgress, setSyncProgress] = createSignal(0)

  onMount(async () => {
    const c = await countUsers()
    setCounts(c)
    await loadUsers()
  })

  async function loadUsers() {
    const list = await findUsers(activeTab(), keyword(), 200)
    setUsers(list)
  }

  function switchTab(tab: Tab) {
    setActiveTab(tab)
    // Reload after tab switch
    setTimeout(loadUsers, 0)
  }

  async function syncUsers(relationship: Tab) {
    const uid = await getCurrentUserId()
    if (!uid) {
      alert('Please authenticate first')
      return
    }

    setIsSyncing(true)
    setSyncProgress(0)

    const fetcher = relationship === 'followers' ? getFollowers : getFollowing
    const keyPath =
      relationship === 'followers'
        ? ResponseKeyPath.user_followers
        : ResponseKeyPath.user_following
    const endpoint =
      relationship === 'followers' ? Endpoint.FOLLOWERS : Endpoint.FOLLOWING

    let cursor = ''
    let totalSynced = 0

    try {
      while (true) {
        const json = await fetcher(uid, cursor || undefined)
        const instructions = getInstructions(json, keyPath)

        if (!instructions) {
          console.warn('No instructions in response')
          break
        }

        const { itemEntries, cursorEntry } = getAllInstructionDetails(
          instructions,
          undefined,
        )

        const timelineUsers = itemEntries.filter(
          (item: any) => item.itemType === 'TimelineUser',
        ) as TimelineUser[]

        if (timelineUsers.length === 0) {
          break
        }

        const docs: StoredUser[] = timelineUsers
          .map((item) => {
            try {
              const user = item.user_results?.result
              if (!user?.legacy) return null

              return {
                id: getUserId(uid, relationship, user.rest_id),
                rest_id: user.rest_id,
                owner_id: uid,
                relationship,
                name: user.legacy.name,
                screen_name: user.legacy.screen_name,
                profile_image_url_https: user.legacy.profile_image_url_https,
                profile_banner_url: user.legacy.profile_banner_url,
                description: user.legacy.description || '',
                followers_count: user.legacy.followers_count,
                friends_count: user.legacy.friends_count,
                statuses_count: user.legacy.statuses_count,
                is_blue_verified: user.is_blue_verified || false,
                location: user.legacy.location || '',
                created_at: user.legacy.created_at,
                synced_at: Math.floor(Date.now() / 1000),
              } as StoredUser
            } catch (err) {
              console.error('Failed to parse user', err)
              return null
            }
          })
          .filter((u): u is StoredUser => u !== null)

        if (docs.length > 0) {
          await upsertUsers(docs)
          totalSynced += docs.length
          setSyncProgress(totalSynced)
        }

        if (cursorEntry) {
          cursor = cursorEntry
        } else {
          break
        }

        // Check rate limit
        const rateLimit = getRateLimitInfo(endpoint, uid)
        if (rateLimit && rateLimit.remaining < 5) {
          console.log('Rate limit approaching, pausing sync')
          break
        }
      }
    } catch (err: any) {
      if (err.name === FetchError.RateLimitError) {
        console.log('Rate limited, stopping sync')
      } else if (err.name === FetchError.IdentityError) {
        alert('Authentication expired. Please re-authenticate.')
      } else {
        console.error('Sync error:', err)
      }
    }

    setIsSyncing(false)
    const c = await countUsers()
    setCounts(c)
    await loadUsers()
  }

  return (
    <div class="mx-auto my-4 w-full flex-1 text-base text-gray-700 lg:w-[48rem] dark:text-white">
      <div class="mb-6 flex items-center justify-between px-3 lg:px-0">
        <h2 class="text-xl font-bold">Users</h2>
        <div class="flex items-center gap-2">
          <Show when={isSyncing()}>
            <span class="flex items-center gap-2 text-sm text-gray-500">
              <Spinner className="h-4 w-4 fill-blue-500 text-gray-200" />
              Synced {syncProgress()} users...
            </span>
          </Show>
          <button
            class="rounded-lg bg-blue-500 px-4 py-2 text-sm text-white hover:bg-blue-600 disabled:opacity-50"
            disabled={isSyncing()}
            onClick={() => syncUsers(activeTab())}
          >
            Sync {activeTab() === 'followers' ? 'Followers' : 'Following'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div class="mb-4 flex gap-4 border-b border-gray-200 px-3 lg:px-0 dark:border-gray-700">
        <button
          class={`pb-2 text-base font-medium ${activeTab() === 'following' ? 'border-b-2 border-blue-500 text-blue-500' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
          onClick={() => switchTab('following')}
        >
          Following
          <span class="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-800">
            {counts().following}
          </span>
        </button>
        <button
          class={`pb-2 text-base font-medium ${activeTab() === 'followers' ? 'border-b-2 border-blue-500 text-blue-500' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
          onClick={() => switchTab('followers')}
        >
          Followers
          <span class="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-800">
            {counts().followers}
          </span>
        </button>
      </div>

      {/* Search */}
      <div class="mb-4 px-3 lg:px-0">
        <input
          type="text"
          placeholder="Search by name, handle, or bio..."
          class="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          value={keyword()}
          onInput={(e) => {
            setKeyword(e.currentTarget.value)
            loadUsers()
          }}
        />
      </div>

      {/* User list */}
      <div class="space-y-2 px-3 lg:px-0">
        <Show
          when={users().length > 0}
          fallback={
            <div class="py-16 text-center text-gray-400">
              <Show
                when={counts()[activeTab()] > 0}
                fallback={
                  <div>
                    <p class="mb-2 text-lg">No {activeTab()} yet</p>
                    <p class="text-sm">
                      Click "Sync {activeTab() === 'followers' ? 'Followers' : 'Following'}" to start syncing.
                    </p>
                  </div>
                }
              >
                <p>No results found</p>
              </Show>
            </div>
          }
        >
          <For each={users()}>
            {(user) => (
              <div class="flex items-start gap-3 rounded-lg p-3 hover:bg-gray-50 dark:hover:bg-gray-800">
                <a
                  href={`https://x.com/${user.screen_name}`}
                  target="_blank"
                >
                  <img
                    class="h-12 w-12 rounded-full"
                    src={user.profile_image_url_https.replace(
                      '_normal',
                      '_x96',
                    )}
                    alt={user.name}
                  />
                </a>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <a
                      href={`https://x.com/${user.screen_name}`}
                      target="_blank"
                      class="truncate font-semibold hover:underline"
                    >
                      {user.name}
                    </a>
                    <Show when={user.is_blue_verified}>
                      <svg
                        class="h-4 w-4 shrink-0 text-blue-500"
                        viewBox="0 0 22 22"
                        fill="currentColor"
                      >
                        <path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.69-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.636.433 1.221.878 1.69.47.446 1.055.752 1.69.883.635.13 1.294.083 1.902-.143.271.586.702 1.084 1.24 1.438.54.354 1.167.551 1.813.568.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.225 1.261.272 1.893.143.634-.131 1.22-.434 1.69-.88.445-.47.749-1.055.88-1.69.13-.634.085-1.29-.138-1.896.587-.274 1.084-.705 1.438-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z" />
                      </svg>
                    </Show>
                    <span class="shrink-0 text-sm text-gray-500">
                      @{user.screen_name}
                    </span>
                  </div>
                  <p class="mt-1 line-clamp-2 text-sm text-gray-600 dark:text-gray-400">
                    {user.description}
                  </p>
                  <div class="mt-2 flex gap-4 text-xs text-gray-500">
                    <span>
                      <strong class="text-gray-700 dark:text-gray-300">
                        {user.followers_count.toLocaleString()}
                      </strong>{' '}
                      followers
                    </span>
                    <span>
                      <strong class="text-gray-700 dark:text-gray-300">
                        {user.friends_count.toLocaleString()}
                      </strong>{' '}
                      following
                    </span>
                    <span>
                      <strong class="text-gray-700 dark:text-gray-300">
                        {user.statuses_count.toLocaleString()}
                      </strong>{' '}
                      posts
                    </span>
                    <Show when={user.location}>
                      <span>📍 {user.location}</span>
                    </Show>
                  </div>
                </div>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  )
}
