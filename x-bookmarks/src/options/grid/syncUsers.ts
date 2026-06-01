import { getFollowers, getFollowing } from 'utils/api/twitter-user'
import { getCurrentUserId } from 'utils/storage'
import { Endpoint, TimelineUser } from 'utils/types'
import {
  ResponseKeyPath,
  getInstructions,
  getAllInstructionDetails,
} from 'utils/api/twitter-res-utils'
import { StoredUser, getUserId, upsertUsers } from 'utils/db/users'
import { getRateLimitInfo } from 'utils/api/twitter-base'
import { FetchError } from 'utils/xfetch'

import type { Relationship } from './types'

/**
 * Syncs followers/following from the Twitter API into IndexedDB.
 * Calls onProgress with the running total as records are stored.
 * Returns the total number of users synced.
 */
export async function syncUsers(
  relationship: Relationship,
  onProgress?: (total: number) => void,
): Promise<number> {
  const uid = await getCurrentUserId()
  if (!uid) {
    alert('Please authenticate first')
    return 0
  }

  const fetcher = relationship === 'followers' ? getFollowers : getFollowing
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

      const docs: StoredUser[] = timelineUsers
        .map((item) => {
          try {
            const user = item.user_results?.result
            const legacy = user?.legacy
            if (!legacy) return null

            /**
             * X moved name / screen_name / created_at out of `legacy` into a
             * new `core` object, and the avatar into `avatar.image_url`.
             * Older responses still use `legacy`, so read core first and fall
             * back to legacy to support both shapes.
             */
            const core = user.core || {}
            return {
              id: getUserId(uid, storedRelationship, user.rest_id),
              rest_id: user.rest_id,
              owner_id: uid,
              relationship: storedRelationship,
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

  return totalSynced
}
