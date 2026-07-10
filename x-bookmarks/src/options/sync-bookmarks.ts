/**
 * Bookmark lifecycle: full/incremental sync from X's GraphQL, server-deletion
 * reconciliation, thread backfill, local delete tasks, and the one-time
 * category_name backfill. Drives the per-account SyncState (utils/sync-engine)
 * so the account indicator reflects real progress.
 */
import { reconcile } from 'solid-js/store'

import {
  deleteBookmark,
  getBookmarks,
  getTweetConversations,
  getTweetId,
  toRecord,
} from 'utils/api/twitter'
import { getRateLimitInfo } from 'utils/api/twitter-base'
import { DAYS, getLastNDaysDates } from 'utils/date'
import {
  upsertRecords,
  getRecord,
  iterate,
  countRecords,
  deleteRecord,
  deleteRecordsByTweetIds,
  getAllTweetIds,
  getRencentTweets,
  getTopUsers,
  backfillCategoryName,
} from 'utils/db/tweets'
import { FetchError } from 'utils/xfetch'
import {
  TimelineEntry,
  TimelineTimelineItem,
  TimelineTweet,
  TimelineAddEntriesInstruction,
  Endpoint,
  AuthStatus,
  TaskType,
} from 'utils/types'
import {
  getCurrentUserId,
  StorageKeys,
  logout,
  setLocal,
  getAuthInfo,
  getLastSyncInfo,
  getLocal,
} from 'utils/storage'
import { resumeSync, updateSyncProgress, finishSync } from 'utils/sync-engine'

import dataStore, { mutateStore } from './store'
import { refreshFolderCounts } from '~/stores/folders'
import { query } from './query'

/**
 * One-time backfill (DB v23): tag legacy records lacking category_name as
 * 'bookmarks'. Guarded by a global storage flag so it only runs once.
 */
async function runCategoryBackfill() {
  const FLAG = 'twillot_category_backfilled_v23'
  try {
    const existing = await chrome.storage.local.get(FLAG)
    if (existing[FLAG]) {
      return
    }
    const updated = await backfillCategoryName()
    await chrome.storage.local.set({ [FLAG]: Date.now() })
    if (updated > 0) {
      console.log(`Backfilled category_name on ${updated} legacy records`)
    }
  } catch (err) {
    console.error('category_name backfill failed', err)
  }
}

export async function initSync() {
  const [store, setStore] = dataStore
  try {
    await runCategoryBackfill()
    /**
     * 可能之前已经同步过数据
     */
    setStore('topUsers', await getTopUsers(10))
    setStore('totalCount', await countRecords())
    await initHistory()

    const [auth, lastForceSynced] = await Promise.all([
      getAuthInfo(),
      getLastSyncInfo(),
    ])
    if (!auth || !auth.token) {
      throw new Error(AuthStatus.AUTH_FAILED)
    }

    const uid = await getCurrentUserId()

    if (!lastForceSynced) {
      setStore('isForceSyncing', true)
      // Mark the per-account SyncState as syncing (preserves an interrupted
      // run's cursor/progress) so the account indicator reflects the loop.
      if (uid) {
        await resumeSync(uid)
      }
      /**
       * 全量同步时展示最新的 100 条数据
       * 后续更新只更新总数
       */
      for await (const docs of syncAllBookmarks(true)) {
        if (uid) {
          await updateSyncProgress(uid, docs.length)
        }
        /**
         * 已经有最新的数据展示，不对数据进行操作
         */
        if (store.tweets.length > 0) {
          setStore('totalCount', await countRecords())
        } else {
          setStore('tweets', docs)
        }
        await initHistory()
      }

      setStore('isForceSyncing', false)
      setStore('topUsers', reconcile(await getTopUsers(10)))
      const syncedTime = Math.floor(Date.now() / 1000)
      await setLocal({
        [StorageKeys.Last_Sync]: syncedTime,
      })
    } else {
      /**
       * 增量更新时先展示最新的 100 条
       * 后续更新同时更新总数和展示数据
       */
      setStore('isAutoSyncing', true)
      for await (const docs of syncAllBookmarks()) {
        setStore('totalCount', await countRecords())
        /**
         * 当前正在搜索时不更新数据
         */
        const isSearching = store.keyword.trim() || store.category
        if (store.isAutoSyncing && isSearching) {
          continue
        }
        await query(store.keyword)
      }
      await initHistory()
      setStore('isAutoSyncing', false)
    }

    setStore('topUsers', reconcile(await getTopUsers(10)))
    // Sync completed — flip the per-account SyncState back to idle so the
    // account indicator doesn't stay 'syncing' forever.
    if (uid) {
      await finishSync(uid)
    }
  } catch (err) {
    console.error(err)
    const uid = await getCurrentUserId()
    if (uid) {
      await finishSync(uid, err?.message || 'sync failed')
    }
    if (
      err.name == FetchError.IdentityError ||
      err.message == AuthStatus.AUTH_FAILED
    ) {
      setStore('isAuthFailed', true)
      await logout(uid)
    } else {
      setStore('isForceSyncTimedout', true)
      setStore('isForceSyncing', false)
    }
  }
}

export async function initHistory() {
  const [_, setStore] = dataStore
  const days = getLastNDaysDates(DAYS)
  const { total, data: items } = await getRencentTweets(DAYS)
  const countMap = items.reduce((map, item) => {
    map[item.date] = item.count
    return map
  }, {})
  const history = days.map((date) => {
    return {
      date: date,
      count: countMap[date] || 0,
    }
  })
  setStore({
    history,
    historySize: total,
  })
}

export async function syncBookmarkChanges(isInit = false) {
  const tasks = (await getLocal(StorageKeys.Tasks))[StorageKeys.Tasks] || []
  const del_ids = []

  for (const task of tasks) {
    try {
      const id = task.payload.variables.tweet_id
      if (task.type === TaskType.DeleteBookmark) {
        await deleteRecord(id)
        del_ids.push(id)
      }
    } catch (e) {
      console.error(`Failed to delete bookmark`, task)
    }
  }
  mutateStore((state) => {
    state.tweets = state.tweets.filter((t) => !del_ids.includes(t.tweet_id))
  })

  if (!isInit && tasks.length > 0) {
    console.log(`Bookmark changes synced, total ${tasks.length} changes`, tasks)
    initSync()
  }

  await setLocal({
    [StorageKeys.Tasks]: [],
  })

  return del_ids
}

export async function* syncAllBookmarks(forceSync = false) {
  /**
   * 仅针对全量同步记录 cursor 到本地
   */
  const del_ids = await syncBookmarkChanges(true)
  let cursor: string | undefined = forceSync
    ? (await getLocal(StorageKeys.Bookmark_Cursor))[StorageKeys.Bookmark_Cursor]
    : undefined
  // Track all tweet_ids received from the server during a full sync
  // to detect server-side deletions
  const serverTweetIds: Set<string> = new Set()
  while (true) {
    const json = await getBookmarks(cursor)
    const instruction =
      json.data.bookmark_timeline_v2.timeline.instructions?.find(
        (i) => i.type === 'TimelineAddEntries',
      ) as TimelineAddEntriesInstruction | undefined
    if (!instruction) {
      console.error('No instructions found in response')
      break
    }

    let tweets = instruction.entries.filter(
      (e) => e.content.entryType === 'TimelineTimelineItem',
    ) as TimelineEntry<TimelineTweet, TimelineTimelineItem<TimelineTweet>>[]
    if (!tweets.length) {
      console.warn(
        `Reached end of bookmarks with cursor ${cursor}, ${tweets.length}`,
      )
      break
    } else {
      if (!forceSync) {
        if (await isBookmarksSynced(tweets)) {
          console.log('All bookmarks have been synchronized')
          break
        }
      }

      // 有可能被删除
      const docs = tweets
        .map((i) => {
          try {
            return toRecord(i.content.itemContent, i.sortIndex)
          } catch (err) {
            console.error('Failed to parse bookmark, skipping', err, i)
            return null
          }
        })
        .filter((t) => t && del_ids.includes(t.tweet_id) === false)

      // Tag every bookmark record so it is retrievable by category_name.
      docs.forEach((t) => {
        if (t) t.category_name = 'bookmarks'
      })

      // Track server-side tweet IDs during full sync
      if (forceSync) {
        docs.forEach((t) => {
          if (t) serverTweetIds.add(t.tweet_id)
        })
      }

      await upsertRecords(docs)
      yield docs
    }
    const target = instruction.entries[instruction.entries.length - 1].content
    if (target.entryType === 'TimelineTimelineCursor') {
      cursor = target.value
      if (forceSync) {
        await setLocal({ [StorageKeys.Bookmark_Cursor]: cursor })
      }
    } else {
      break
    }
  }

  // After a full sync completes, remove local records that no longer exist on the server
  if (forceSync && serverTweetIds.size > 0) {
    try {
      const localTweetIds = await getAllTweetIds()
      const staleIds = localTweetIds.filter((id) => !serverTweetIds.has(id))
      if (staleIds.length > 0) {
        const deleted = await deleteRecordsByTweetIds(staleIds)
        console.log(
          `Removed ${deleted} bookmarks deleted on server during sync`,
        )
      }
    } catch (err) {
      console.error('Failed to clean up server-side deletions', err)
    }
  }
}

/**
 * 定期同步 threads 记录
 * 详情接口的限制是 150 条
 */
export async function syncThreads() {
  const detailLimit = 50
  /**
   * 一旦设置为 true/false 表示已经同步过
   */
  const records = await iterate(
    (t) => typeof t.is_thread !== 'boolean',
    detailLimit * 0.5,
  )
  console.log(`Syncing ${records.length} threads`, records)
  const uid = await getCurrentUserId()

  for (const record of records) {
    const rateLimitInfo = await getRateLimitInfo(Endpoint.TWEET_DETAIL, uid)
    if (rateLimitInfo?.remaining < 50) {
      const retryIn = rateLimitInfo.reset * 1000 - Date.now() + 60 * 1000
      setTimeout(syncThreads, retryIn)
      console.log(
        `Rate limit reached, retry in ${Math.floor(retryIn / 1000)} seconds`,
        rateLimitInfo,
      )
      break
    }

    try {
      const conversations = await getTweetConversations(record.tweet_id)
      record.conversations = conversations
      record.is_thread = conversations.length > 0
      await upsertRecords([record], true)
    } catch (e) {
      console.error('Failed to get conversations', e)
      if (e.name === FetchError.IdentityError) {
        break
      }
    }
  }

  console.log('Synced threads finished')
  setTimeout(syncThreads, 10 * 60 * 1000)
}

export async function isBookmarksSynced(
  tweets: TimelineEntry<TimelineTweet, TimelineTimelineItem<TimelineTweet>>[],
) {
  const remoteLatest = tweets[0]
  const remoteLast = tweets[tweets.length - 1]
  const [localLatest, localLast] = await Promise.all([
    getRecord(getTweetId(remoteLatest)),
    getRecord(getTweetId(remoteLast)),
  ])
  /**
   * 首尾两条都同步过了，说明已经同步完毕，可以退出循环
   * 如果因为同步被中断导致部分旧数据未同步，可以手动调用时设置 forceSync 参数为 true
   */
  if (localLatest && localLast) {
    // 有可能将老数据取消收藏，然后又重新收藏
    // 这个时候 sort_index 没有更新，需要重新同步
    if (
      localLatest.sort_index === remoteLatest.sortIndex &&
      localLast.sort_index === remoteLast.sortIndex
    ) {
      return true
    }
  }

  return false
}

/**
 * 删除收藏
 * 删除数据库记录
 * 更新 store 中的数据
 * @param tweetId
 */
export async function removeBookmark(tweetId: string) {
  try {
    await deleteBookmark(tweetId)
    await deleteRecord(tweetId)
    mutateStore((state) => {
      const index = state.tweets.findIndex((t) => t.tweet_id === tweetId)
      if (index === -1) {
        return
      }
      state.tweets.splice(index, 1)
      state.totalCount.total -= 1
    })
    // Folder counts live in folderState; recompute from the DB.
    await refreshFolderCounts()
  } catch (e) {
    console.error('Failed to delete bookmark', e)
  }
}
