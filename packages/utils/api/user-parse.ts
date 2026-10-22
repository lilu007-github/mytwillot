import { TimelineUser } from '../types'
import { getUserId, type StoredUser } from '../db/users'
import {
  ResponseKeyPath,
  getInstructions,
  getAllInstructionDetails,
} from './twitter-res-utils'

export type UserRelationship = 'follower' | 'following'

/**
 * Map a captured GraphQL URL to the relationship it lists, or null for other
 * operations. BlueVerifiedFollowers is the "Verified" tab of the followers
 * page — a subset of followers with the same response shape.
 */
export function getUserListRelationship(url: string): UserRelationship | null {
  if (/\/(Followers|BlueVerifiedFollowers)\?/.test(url)) {
    return 'follower'
  }
  if (url.includes('/Following?')) {
    return 'following'
  }
  return null
}

/**
 * Parse a Followers/Following GraphQL response into StoredUser records.
 * Shared by the background passive-capture ingest.
 */
export function parseUserListToRecords(
  json: any,
  relationship: UserRelationship,
  ownerId: string,
  syncedAt: number,
): StoredUser[] {
  // Followers and Following share the same key path.
  const instructions = getInstructions(json, ResponseKeyPath.user_followers)
  if (!instructions) {
    return []
  }

  const { itemEntries, moduleEntries, moduleItems } = getAllInstructionDetails(
    instructions,
    undefined,
  )
  return [...itemEntries, ...moduleEntries, ...moduleItems]
    .filter((item: any) => item?.itemType === 'TimelineUser')
    .map((item) =>
      timelineUserToStoredUser(
        item as TimelineUser,
        ownerId,
        relationship,
        syncedAt,
      ),
    )
    .filter((user): user is StoredUser => user !== null)
}

/**
 * Map a GraphQL TimelineUser entry to a StoredUser record.
 *
 * X moved name / screen_name / created_at out of `legacy` into a new `core`
 * object, and the avatar into `avatar.image_url`. Older responses still use
 * `legacy`, so read core first and fall back to legacy to support both shapes.
 *
 * Shared by the background passive-capture ingest and the active follower/
 * following sync — keep the field mapping in one place so they can't drift.
 * Returns null for entries without a usable user payload.
 */
export function timelineUserToStoredUser(
  item: TimelineUser,
  ownerId: string,
  relationship: UserRelationship,
  syncedAt: number,
): StoredUser | null {
  try {
    const user = item.user_results?.result
    const legacy = user?.legacy
    if (!user?.rest_id || !legacy) {
      return null
    }

    const core = (user as any).core || {}
    return {
      id: getUserId(ownerId, relationship, user.rest_id),
      rest_id: user.rest_id,
      owner_id: ownerId,
      relationship,
      name: core.name ?? legacy.name ?? '',
      screen_name: core.screen_name ?? legacy.screen_name ?? '',
      profile_image_url_https:
        (user as any).avatar?.image_url ?? legacy.profile_image_url_https ?? '',
      profile_banner_url: legacy.profile_banner_url,
      description: legacy.description || '',
      followers_count: legacy.followers_count,
      friends_count: legacy.friends_count,
      statuses_count: legacy.statuses_count,
      is_blue_verified: (user as any).is_blue_verified || false,
      location: legacy.location || '',
      created_at: core.created_at ?? legacy.created_at ?? '',
      synced_at: syncedAt,
    } as StoredUser
  } catch (err) {
    console.error('Failed to parse user', err)
    return null
  }
}
