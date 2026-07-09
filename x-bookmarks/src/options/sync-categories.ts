import { createStore, produce } from 'solid-js/store'

import { getPosts, getReplies, getMedia, getLikes } from 'utils/api/twitter-user'
import { parseTimelineToRecords } from 'utils/api/timeline-parse'
import { upsertCategoryRecords } from 'utils/db/tweets'
import { getRateLimitInfo } from 'utils/api/twitter-base'
import { FetchError } from 'utils/xfetch'
import { getCurrentUserId, getLocal, setLocal } from 'utils/storage'
import { Endpoint, TweetCategory } from 'utils/types'

export type SyncableCategory = Extract<
  TweetCategory,
  'likes' | 'posts' | 'replies' | 'media'
>

type Handler = (uid: string, cursor?: string) => Promise<any>

const CONFIG: Record<
  SyncableCategory,
  { handler: Handler; endpoint: Endpoint }
> = {
  posts: { handler: getPosts, endpoint: Endpoint.USER_TWEETS },
  replies: { handler: getReplies, endpoint: Endpoint.USER_TWEETS_AND_REPLIES },
  media: { handler: getMedia, endpoint: Endpoint.USER_MEDIA },
  likes: { handler: getLikes, endpoint: Endpoint.LIKES },
}

export type SyncStatus = 'idle' | 'running' | 'paused' | 'error' | 'done'

interface CategorySyncState {
  status: SyncStatus
  done: number
  /** Unix seconds when a rate-limited category may resume. */
  reset: number
  error?: string
}

const initial = (): Record<SyncableCategory, CategorySyncState> => ({
  likes: { status: 'idle', done: 0, reset: 0 },
  posts: { status: 'idle', done: 0, reset: 0 },
  replies: { status: 'idle', done: 0, reset: 0 },
  media: { status: 'idle', done: 0, reset: 0 },
})

const [syncState, setSyncState] = createStore(initial())

export { syncState }

function mutate(fn: (s: Record<SyncableCategory, CategorySyncState>) => void) {
  setSyncState(produce(fn))
}

const cursorKey = (category: SyncableCategory) => `${category}_cursor`

/**
 * Full/incremental sync for a profile-scoped category (likes/posts/replies/
 * media). Walks the timeline page by page, persisting the cursor so it can
 * resume, and reschedules itself on rate-limit. Mirrors the exporter engine
 * but writes into the shared posts store via upsertCategoryRecords.
 */
export async function syncCategory(category: SyncableCategory): Promise<void> {
  const uid = await getCurrentUserId()
  if (!uid) {
    return
  }
  const { handler, endpoint } = CONFIG[category]

  const key = cursorKey(category)
  let cursor: string = (await getLocal(key))[key] || ''

  mutate((s) => {
    s[category].status = 'running'
    s[category].error = undefined
    s[category].reset = 0
  })

  while (true) {
    let json: any
    try {
      json = await handler(uid, cursor)
    } catch (err: any) {
      if (err?.name === FetchError.RateLimitError) {
        const info = getRateLimitInfo(endpoint, uid)
        mutate((s) => {
          s[category].status = 'paused'
          s[category].reset = info?.reset || 0
        })
        const wait = (info?.reset || 0) * 1000 - Date.now() + 5000
        if (wait > 0) {
          setTimeout(() => syncCategory(category), wait)
        }
      } else {
        mutate((s) => {
          s[category].status = 'error'
          s[category].error = err?.message || String(err)
        })
      }
      return
    }

    const { docs, cursor: nextCursor } = parseTimelineToRecords(
      json,
      category,
      uid,
    )

    if (docs.length === 0) {
      mutate((s) => {
        s[category].status = 'done'
      })
      return
    }

    await upsertCategoryRecords(docs)
    mutate((s) => {
      s[category].done += docs.length
      s[category].status = 'running'
    })

    if (nextCursor && nextCursor !== cursor) {
      cursor = nextCursor
      await setLocal({ [key]: cursor })
    } else {
      mutate((s) => {
        s[category].status = 'done'
      })
      return
    }
  }
}
