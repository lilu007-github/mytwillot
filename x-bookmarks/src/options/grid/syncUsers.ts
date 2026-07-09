import { getFollowing } from 'utils/api/twitter-user'
import { getAccountRegistry } from 'utils/account-manager'
import { getCurrentUserId } from 'utils/storage'
import { Endpoint, TimelineUser } from 'utils/types'
import {
  ResponseKeyPath,
  getInstructions,
  getAllInstructionDetails,
} from 'utils/api/twitter-res-utils'
import { StoredUser, upsertUsers } from 'utils/db/users'
import { timelineUserToStoredUser } from 'utils/api/user-parse'
import { getRateLimitInfo } from 'utils/api/twitter-base'
import { FetchError } from 'utils/xfetch'

import type { Relationship } from './types'

export interface SyncUsersResult {
  count: number
  mode: 'api' | 'x-page'
}

/**
 * Syncs followers/following from the Twitter API into IndexedDB.
 * Calls onProgress with the running total as records are stored.
 * Returns the total number of users synced.
 */
export async function syncUsers(
  relationship: Relationship,
  onProgress?: (total: number) => void,
): Promise<SyncUsersResult> {
  const uid = await getCurrentUserId()
  if (!uid) {
    alert('Please authenticate first')
    return { count: 0, mode: 'api' }
  }

  if (relationship === 'followers') {
    await openFollowersPage(uid)
    return { count: 0, mode: 'x-page' }
  }

  const fetcher = getFollowing
  const keyPath =
    relationship === 'followers'
      ? ResponseKeyPath.user_followers
      : ResponseKeyPath.user_following
  const endpoint =
    relationship === 'followers' ? Endpoint.FOLLOWERS : Endpoint.FOLLOWING
  const storedRelationship =
    relationship === 'followers' ? 'follower' : 'following'

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

      const syncedAt = Math.floor(Date.now() / 1000)
      const docs: StoredUser[] = timelineUsers
        .map((item) =>
          timelineUserToStoredUser(item, uid, storedRelationship, syncedAt),
        )
        .filter((u): u is StoredUser => u !== null)

      if (docs.length > 0) {
        await upsertUsers(docs)
        totalSynced += docs.length
        onProgress?.(totalSynced)
      }

      if (cursorEntry) {
        cursor = cursorEntry
      } else {
        break
      }

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
    } else if (err.name === FetchError.EndpointError) {
      if (relationship === 'followers') {
        alert(
          'Syncing followers requires an X Premium account. The Following tab works without premium.',
        )
      } else {
        alert(
          'This endpoint is currently unavailable. Please try again later.',
        )
      }
    } else {
      console.error('Sync error:', err)
    }
  }

  return { count: totalSynced, mode: 'api' }
}

async function openFollowersPage(userId: string) {
  const registry = await getAccountRegistry()
  const account = registry.find((entry) => entry.user_id === userId)
  const followersUrl = account?.screen_name
    ? `https://x.com/${account.screen_name}/followers`
    : 'https://x.com/followers'

  const tabs = await chrome.tabs.query({
    url: ['https://x.com/*', 'https://*.x.com/*'],
    currentWindow: true,
  })
  const existing = tabs.find((tab) => tab.url?.includes('/followers'))

  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active: true, url: followersUrl })
    return
  }

  await chrome.tabs.create({ url: followersUrl, active: true })
}
