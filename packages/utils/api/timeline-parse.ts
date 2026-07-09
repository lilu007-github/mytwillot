import { Tweet, TweetCategory, TimelineTweet } from '../types'
import { getPostId } from '../db/tweets'
import {
  ResponseKeyPath,
  getInstructions,
  getAllInstructionDetails,
} from './twitter-res-utils'
import { toRecord } from './twitter'

const CATEGORY_KEYPATH: Record<TweetCategory, ResponseKeyPath> = {
  bookmarks: ResponseKeyPath.bookmarks,
  likes: ResponseKeyPath.user_likes,
  posts: ResponseKeyPath.user_posts,
  replies: ResponseKeyPath.user_replies,
  media: ResponseKeyPath.user_media,
}

/**
 * Build the stored record id for a given category.
 * Bookmarks keep the historical `${owner}_${tweet}` key so they de-dupe with
 * the existing bookmark store; other categories are namespaced so the same
 * tweet can live under multiple categories (a tweet can be both liked and
 * bookmarked).
 */
export function getCategoryRecordId(
  category: TweetCategory,
  ownerId: string,
  tweetId: string,
): string {
  const base = getPostId(ownerId, tweetId)
  return category === 'bookmarks' ? base : `${category}_${base}`
}

/**
 * Parse a captured/fetched GraphQL timeline JSON into Tweet records tagged with
 * the given category, plus the bottom pagination cursor. Shared by the passive
 * capture interceptor (background) and the active category sync engine.
 */
export function parseTimelineToRecords(
  json: any,
  category: TweetCategory,
  ownerId: string,
): { docs: Tweet[]; cursor: string } {
  const keypath = CATEGORY_KEYPATH[category]
  const instructions = getInstructions(json, keypath)
  if (!instructions) {
    return { docs: [], cursor: '' }
  }

  const { itemEntries, moduleEntries, moduleItems, cursorEntry } =
    getAllInstructionDetails(instructions, undefined)

  const list = [
    ...itemEntries,
    ...(moduleEntries.length > 0 &&
    (moduleEntries[0] as any)?.itemType === 'TimelineTweet'
      ? moduleEntries
      : []),
    ...moduleItems,
  ] as TimelineTweet[]

  const docs = list
    .map((item) => {
      const tweet = toRecord(item, '')
      if (!tweet) {
        return null
      }
      // replies timeline includes non-reply context tweets — keep only replies
      if (category === 'replies' && !tweet.is_reply) {
        return null
      }
      tweet.sort_index = tweet.created_at.toString()
      tweet.id = getCategoryRecordId(category, ownerId, tweet.tweet_id)
      tweet.owner_id = ownerId
      tweet.category_name = category
      return tweet
    })
    .filter((t): t is Tweet => t !== null)

  return { docs, cursor: cursorEntry || '' }
}
