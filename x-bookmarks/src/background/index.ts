import { getOptionsPageTab } from 'utils/browser'
import {
  captureGraphQLRequestTemplateFromUrl,
  captureQueryIdFromUrl,
  StorageKeys,
  syncAuthHeaders,
} from 'utils/storage'
import { Host } from 'utils/types'
import type { TimelineUser } from 'utils/types'
import {
  ResponseKeyPath,
  getAllInstructionDetails,
  getInstructions,
} from 'utils/api/twitter-res-utils'
import { cancelCurrentSync, startFullSync } from 'utils/sync-engine'
import { upsertAccountEntry } from 'utils/account-manager'
import { getUserId, type StoredUser, upsertUsers } from 'utils/db/users'
import { getCurrentUserId } from 'utils/storage'
import { parseTimelineToRecords } from 'utils/api/timeline-parse'
import { upsertCategoryRecords } from 'utils/db/tweets'
import type { TweetCategory } from 'utils/types'

interface CapturedUserListMessage {
  type: 'TWILLOT_CAPTURED_X_USER_LIST'
  url: string
  json: unknown
}

interface CapturedTimelineMessage {
  type: 'TWILLOT_CAPTURED_TIMELINE'
  operation: string
  url: string
  json: unknown
}

// Map a captured GraphQL operation to a stored tweet category.
const OPERATION_CATEGORY: Record<string, TweetCategory> = {
  Bookmarks: 'bookmarks',
  Likes: 'likes',
  UserTweets: 'posts',
  UserTweetsAndReplies: 'replies',
  UserMedia: 'media',
}

chrome.action.onClicked.addListener(function () {
  chrome.runtime.openOptionsPage()
})

chrome.runtime.onMessage.addListener(
  (message: CapturedUserListMessage | CapturedTimelineMessage) => {
    if (message?.type === 'TWILLOT_CAPTURED_X_USER_LIST') {
      ingestCapturedUserList(message.url, message.json).catch((err) => {
        chrome.storage.local.set({
          [StorageKeys.Captured_Users_Debug]: {
            stage: 'background-error',
            url: message.url,
            error: err instanceof Error ? err.message : String(err),
            updated_at: Date.now(),
          },
        })
        console.error('Failed to ingest captured X user list', err)
      })
    } else if (message?.type === 'TWILLOT_CAPTURED_TIMELINE') {
      ingestCapturedTimeline(message.operation, message.url, message.json).catch(
        (err) => console.error('Failed to ingest captured timeline', err),
      )
    }
  },
)

/**
 * Passively ingest a captured tweet timeline (bookmarks/likes/posts/replies/
 * media) that the X web app fetched while the user browses. This bypasses the
 * direct-API rate limits and the 800-bookmark cap.
 */
async function ingestCapturedTimeline(
  operation: string,
  url: string,
  json: unknown,
) {
  const category = OPERATION_CATEGORY[operation]
  if (!category) {
    return
  }

  const ownerId = await getCurrentUserId()
  if (!ownerId) {
    return
  }

  // For profile-scoped timelines (posts/replies/media/likes), the response
  // belongs to whichever profile is being viewed. Only ingest the logged-in
  // user's own data so we don't attribute a stranger's tweets to this account.
  if (category !== 'bookmarks') {
    const targetUserId = getUserIdFromGraphQLUrl(url)
    if (targetUserId && targetUserId !== ownerId) {
      return
    }
  }

  const { docs } = parseTimelineToRecords(json, category, ownerId)
  if (docs.length === 0) {
    return
  }

  await upsertCategoryRecords(docs)
  await chrome.storage.local.set({
    [StorageKeys.Captured_Timeline_Updated]: {
      owner_id: ownerId,
      category,
      count: docs.length,
      updated_at: Math.floor(Date.now() / 1000),
    },
  })
  console.log(`Captured ${docs.length} ${category} from X page`)
}

async function ingestCapturedUserList(url: string, json: unknown) {
  await chrome.storage.local.set({
    [StorageKeys.Captured_Users_Debug]: {
      stage: 'background-received',
      url,
      updated_at: Date.now(),
    },
  })

  const operation = getUserListOperation(url)
  if (!operation) {
    await setCapturedUsersDebug('ignored-operation', { url })
    return
  }

  const ownerId = getUserIdFromGraphQLUrl(url)
  if (!ownerId) {
    await setCapturedUsersDebug('missing-owner-id', { url, operation })
    return
  }

  const instructions = getInstructions(
    json,
    operation === 'Followers'
      ? ResponseKeyPath.user_followers
      : ResponseKeyPath.user_following,
  )

  if (!instructions) {
    await setCapturedUsersDebug('missing-instructions', {
      url,
      operation,
      owner_id: ownerId,
    })
    return
  }

  const { itemEntries, moduleEntries, moduleItems } = getAllInstructionDetails(
    instructions,
    undefined,
  )
  const userEntries = [...itemEntries, ...moduleEntries, ...moduleItems]
  const relationship = operation === 'Followers' ? 'follower' : 'following'
  const now = Math.floor(Date.now() / 1000)
  const docs: StoredUser[] = userEntries
    .filter((item: any) => item.itemType === 'TimelineUser')
    .map((item: TimelineUser) => {
      const user = item.user_results?.result
      const legacy = user?.legacy
      if (!user?.rest_id || !legacy) {
        return null
      }

      const core = user.core || {}
      return {
        id: getUserId(ownerId, relationship, user.rest_id),
        rest_id: user.rest_id,
        owner_id: ownerId,
        relationship,
        name: core.name ?? legacy.name ?? '',
        screen_name: core.screen_name ?? legacy.screen_name ?? '',
        profile_image_url_https:
          user.avatar?.image_url ?? legacy.profile_image_url_https ?? '',
        profile_banner_url: legacy.profile_banner_url,
        description: legacy.description || '',
        followers_count: legacy.followers_count,
        friends_count: legacy.friends_count,
        statuses_count: legacy.statuses_count,
        is_blue_verified: user.is_blue_verified || false,
        location: legacy.location || '',
        created_at: core.created_at ?? legacy.created_at ?? '',
        synced_at: now,
      } as StoredUser
    })
    .filter((user): user is StoredUser => user !== null)

  if (docs.length === 0) {
    await setCapturedUsersDebug('no-user-docs', {
      url,
      operation,
      owner_id: ownerId,
      relationship,
      entries: userEntries.length,
    })
    return
  }

  await upsertUsers(docs)
  await chrome.storage.local.set({
    [StorageKeys.Captured_Users_Updated]: {
      owner_id: ownerId,
      relationship,
      count: docs.length,
      updated_at: now,
    },
    [StorageKeys.Captured_Users_Debug]: {
      stage: 'stored-users',
      url,
      operation,
      owner_id: ownerId,
      relationship,
      count: docs.length,
      updated_at: Date.now(),
    },
  })
  console.log(`Captured ${docs.length} ${relationship} users from X page`)
}

async function setCapturedUsersDebug(
  stage: string,
  details: Record<string, unknown>,
) {
  await chrome.storage.local.set({
    [StorageKeys.Captured_Users_Debug]: {
      stage,
      ...details,
      updated_at: Date.now(),
    },
  })
}

function getUserListOperation(url: string): 'Followers' | 'Following' | null {
  if (url.includes('/Followers?')) {
    return 'Followers'
  }
  if (url.includes('/Following?')) {
    return 'Following'
  }
  return null
}

function getUserIdFromGraphQLUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const variables = parsed.searchParams.get('variables')
    if (!variables) {
      return ''
    }
    return JSON.parse(variables).userId || ''
  } catch (err) {
    console.warn('Failed to parse X user list owner id', err)
    return ''
  }
}

chrome.webRequest.onSendHeaders.addListener(
  async (details: chrome.webRequest.WebRequestHeadersDetails) => {
    const { url, initiator } = details
    // 当前页面不监听
    if (initiator !== Host) {
      return
    }

    /**
     * Capture the live persisted-query id for every GraphQL operation x.com
     * calls. Twitter rotates these ids, so hardcoded values eventually 404.
     * Using the ids from the user's own session keeps requests working.
     */
    await captureQueryIdFromUrl(url)

    await syncAuthHeaders(details.requestHeaders)
  },
  {
    types: ['xmlhttprequest'],
    urls: [`${Host}/i/api/graphql/*`],
  },
  ['requestHeaders'],
)

chrome.webRequest.onCompleted.addListener(
  async (details) => {
    const { url, initiator, statusCode } = details
    if (initiator !== Host || statusCode < 200 || statusCode >= 300) {
      return
    }

    await captureGraphQLRequestTemplateFromUrl(url)
  },
  {
    types: ['xmlhttprequest'],
    urls: [`${Host}/i/api/graphql/*`],
  },
)

chrome.omnibox.onInputEntered.addListener(async (text) => {
  const newURL =
    chrome.runtime.getURL('pages/options.html') +
    '#/?q=' +
    encodeURIComponent(text)
  let tab = await getOptionsPageTab()
  if (tab) {
    await chrome.tabs.update(tab.id, { url: newURL, active: true })
  } else {
    await chrome.tabs.create({ url: newURL })
  }
})

/**
 * Listen for account switches.
 * When `current_user_id` changes in Chrome Storage:
 * 1. Cancel any in-progress sync for the previous account
 * 2. Update the new account's registry entry (last_active_at)
 * 3. Start a full sync for the new account (resets cursor)
 */
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== 'local') {
    return
  }

  const userIdChange = changes[StorageKeys.Current_UID]
  if (!userIdChange) {
    return
  }

  const oldUserId: string = userIdChange.oldValue || ''
  const newUserId: string = userIdChange.newValue || ''

  // No actual change
  if (oldUserId === newUserId) {
    return
  }

  // Cancel any active sync for the previous account
  if (oldUserId) {
    await cancelCurrentSync()
  }

  // If new user ID is empty (logged out), don't start a new sync
  if (!newUserId) {
    return
  }

  // Update the account registry with the new account's last_active_at
  await upsertAccountEntry({
    user_id: newUserId,
    last_active_at: Math.floor(Date.now() / 1000),
  })

  // Start a full sync for the new account (resets cursor)
  await startFullSync(newUserId)
})
