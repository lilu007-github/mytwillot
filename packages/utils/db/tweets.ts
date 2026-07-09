import { Tweet, QueryOptions, CountInfo } from '../types'
import { formatDate } from '../date'
import { parseTwitterQuery } from '../query-parser'
import { getCurrentUserId } from '../storage'
import { openDb, getObjectStore, TWEETS_TABLE_NAME_V2 } from './index'
import { requireActiveAccount } from './context-guard'

const metadataFields =
  'views_count,bookmark_count,favorite_count,quote_count,reply_count,retweet_count,bookmarked,favorited,is_quote_status,retweeted'.split(
    ',',
  )

export function getPostId(user_id: string, tweet_id: string) {
  if (!user_id || !tweet_id) {
    console.error('Invalid user_id or tweet_id', user_id, tweet_id)
    throw new Error('Invalid user_id or tweet_id')
  }

  // startsWith (not includes): a numeric tweet_id can contain user_id as a
  // substring, which would skip the owner prefix and mis-scope the key.
  return tweet_id.startsWith(user_id + '_')
    ? tweet_id
    : user_id + '_' + tweet_id
}

export async function upsertRecords(
  records: Tweet[],
  isUpdate = false,
): Promise<void> {
  await requireActiveAccount()
  const db = await openDb()
  const user_id = await getCurrentUserId()

  return new Promise((resolve, reject) => {
    const { transaction, objectStore } = getObjectStore(
      db,
      TWEETS_TABLE_NAME_V2,
    )
    transaction.oncomplete = () => {
      resolve()
    }
    transaction.onerror = (event: Event) => {
      reject(
        'Transaction error: ' + (event.target as IDBRequest).error?.toString(),
      )
    }

    records.forEach((record) => {
      if (record) {
        /**
         * 明确知道是更新，或者有可能是新增或者更新
         */
        if (isUpdate) {
          objectStore.put(record)
          return
        }

        const key = getPostId(user_id, record.tweet_id)
        record.id = key
        record.owner_id = user_id

        const getRequest = objectStore.get(key)
        getRequest.onsuccess = () => {
          const existingRecord = getRequest.result
          // 更新一般有两种
          // 更新 metadata or 更新文件夹
          if (existingRecord) {
            metadataFields.forEach((field) => {
              if (field in record) {
                existingRecord[field] = record[field]
              }
            })
            if ('folder' in record) {
              existingRecord.folder = record.folder
            }
            /**
             * 只有明确设置了 is_thread 才会更新 conversations
             */
            if (typeof record.is_thread === 'boolean') {
              existingRecord.is_thread = record.is_thread
              existingRecord.conversations = record.conversations
            }
            objectStore.put(existingRecord)
          } else {
            objectStore.put(record)
          }
        }
        getRequest.onerror = (event: Event) => {
          console.error(
            'Get request error: ' +
              record.tweet_id +
              (event.target as IDBRequest).error?.toString(),
          )
        }
      }
    })
  })
}

/**
 * Upsert records that already have an explicit `id` (category records use a
 * namespaced id like `likes_${owner}_${tweet}`). Unlike upsertRecords, this
 * does NOT recompute the key from tweet_id, and it preserves user-authored
 * fields (folder/tags/note/title, thread state) across re-captures.
 */
export async function upsertCategoryRecords(records: Tweet[]): Promise<void> {
  await requireActiveAccount()
  const db = await openDb()

  return new Promise((resolve, reject) => {
    const { transaction, objectStore } = getObjectStore(
      db,
      TWEETS_TABLE_NAME_V2,
    )
    transaction.oncomplete = () => resolve()
    transaction.onerror = (event: Event) => {
      reject(
        'Transaction error: ' + (event.target as IDBRequest).error?.toString(),
      )
    }

    records.forEach((record) => {
      if (!record || !record.id) {
        return
      }
      const getRequest = objectStore.get(record.id)
      getRequest.onsuccess = () => {
        const existing = getRequest.result
        if (existing) {
          record.folder = existing.folder
          record.tags = existing.tags
          record.note = existing.note
          record.title = existing.title
          if (typeof existing.is_thread === 'boolean') {
            record.is_thread = existing.is_thread
            record.conversations = existing.conversations
          }
        }
        objectStore.put(record)
      }
    })
  })
}

function meetsCriteria(
  tweet: Tweet,
  options: QueryOptions,
  category = '',
  folder = '',
  user_id = '',
  dataType = 'bookmarks',
  tag = '',
): boolean {
  if (tweet.owner_id !== user_id) {
    return false
  }

  // Data type (bookmarks/likes/posts/replies/media). Legacy records without a
  // category_name are treated as bookmarks. An empty dataType matches all.
  if (dataType && (tweet.category_name || 'bookmarks') !== dataType) {
    return false
  }

  if (tag && !(Array.isArray(tweet.tags) && tweet.tags.includes(tag))) {
    return false
  }

  let folderFilter = false
  // 指定 folder 为 null 表示查询没有 unsorted 的记录
  if (folder === 'Unsorted') {
    folderFilter = !tweet.folder
  } else {
    folderFilter =
      !folder || tweet.folder?.toLowerCase() === folder.toLowerCase()
  }

  return (
    (!options.keyword ||
      tweet.full_text.toLowerCase().includes(options.keyword.toLowerCase())) &&
    (!options.fromUser ||
      tweet.screen_name.toLowerCase() === options.fromUser.toLowerCase()) &&
    (!category || tweet[category]) &&
    folderFilter
  )
}

function getRange(since?: number, until?: number): IDBKeyRange | null {
  if (since && until) {
    return IDBKeyRange.bound(since, until)
  } else if (since) {
    return IDBKeyRange.lowerBound(since)
  } else if (until) {
    return IDBKeyRange.upperBound(until)
  }
  return null
}

/**
 * Number 目前都只查了第一页，翻页涉及查询条件会不准
 */
export async function findRecords(
  keyword = '',
  category = '',
  folder = '',
  lastId = '',
  pageSize = 100,
  dataType = 'bookmarks',
  tag = '',
): Promise<Tweet[]> {
  await requireActiveAccount()
  const db = await openDb()
  const user_id = await getCurrentUserId()
  const options = parseTwitterQuery(keyword)
  const results: Tweet[] = []
  let recordsFetched = 0 // 实际已获取的记录数
  let isStartLooking = !lastId
  const since = options.since
    ? Math.floor(new Date(options.since + ' 00:00:00').getTime() / 1000)
    : null
  const until = options.until
    ? Math.floor(new Date(options.until + ' 23:59:59').getTime() / 1000)
    : null
  const indexName = since || until ? 'created_at' : 'sort_index' // 选择索引

  return new Promise((resolve, reject) => {
    const { objectStore } = getObjectStore(db, TWEETS_TABLE_NAME_V2)
    const index = objectStore.index(indexName)
    const range = getRange(since, until) // 创建时间范围
    const request = index.openCursor(range, 'prev')

    request.onsuccess = (event: Event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
      if (cursor) {
        const tweet = cursor.value as Tweet
        if (isStartLooking) {
          const met = meetsCriteria(
            tweet,
            options,
            category,
            folder,
            user_id,
            dataType,
            tag,
          )
          if (met) {
            recordsFetched++
            if (recordsFetched <= pageSize) {
              results.push(tweet)
            }
            if (recordsFetched === pageSize) {
              resolve(results)
              return
            }
          }
        } else {
          if (tweet.tweet_id === lastId) {
            isStartLooking = true
          }
        }

        cursor.continue()
      } else {
        resolve(results)
      }
    }

    request.onerror = (event: Event) => {
      reject(
        'Failed to retrieve records: ' +
          (event.target as IDBRequest).error?.toString(),
      )
    }
  })
}

export async function getRecord(tweetId: string): Promise<Tweet | undefined> {
  if (!tweetId) {
    return Promise.resolve(undefined)
  }

  await requireActiveAccount()
  const db = await openDb()
  const user_id = await getCurrentUserId()
  const key = getPostId(user_id, tweetId)

  return new Promise((resolve, reject) => {
    const { objectStore } = getObjectStore(db, TWEETS_TABLE_NAME_V2)
    const request = objectStore.get(key)

    request.onsuccess = (event: Event) => {
      resolve((event.target as IDBRequest<Tweet>).result)
    }

    request.onerror = (event: Event) => {
      reject(
        'Get record error: ' + (event.target as IDBRequest).error?.toString(),
      )
    }
  })
}

export async function deleteRecord(id: string): Promise<Tweet | undefined> {
  if (!id) {
    return Promise.resolve(undefined)
  }

  await requireActiveAccount()
  const db = await openDb()
  const user_id = await getCurrentUserId()
  const key = getPostId(user_id, id)
  const record = await getRecord(key)

  return new Promise((resolve, reject) => {
    const { objectStore } = getObjectStore(db, TWEETS_TABLE_NAME_V2)
    const request = objectStore.delete(key)
    request.onsuccess = (event: Event) => {
      resolve(record)
    }
    request.onerror = (event: Event) => {
      reject(
        'Get record error: ' + (event.target as IDBRequest).error?.toString(),
      )
    }
  })
}

/**
 * Get all BOOKMARK tweet_ids for the current user's records.
 * Used to compare local state against the server's bookmark timeline during
 * full sync. Scoped to category_name 'bookmarks' — likes/posts/replies/media
 * records must never be classified as "stale bookmarks" and deleted.
 * (Records without category_name predate the v23 backfill and are bookmarks.)
 */
export async function getAllTweetIds(): Promise<string[]> {
  const db = await openDb()
  const user_id = await getCurrentUserId()
  if (!user_id) {
    return []
  }

  return new Promise((resolve, reject) => {
    const { objectStore } = getObjectStore(db, TWEETS_TABLE_NAME_V2)
    const index = objectStore.index('owner_id')
    const range = IDBKeyRange.only(user_id)
    const request = index.openCursor(range)
    const ids: string[] = []

    request.onsuccess = (event: Event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
      if (cursor) {
        const record = cursor.value
        if ((record.category_name ?? 'bookmarks') === 'bookmarks') {
          ids.push(record.tweet_id)
        }
        cursor.continue()
      } else {
        resolve(ids)
      }
    }

    request.onerror = (event: Event) => {
      reject(
        'Failed to get tweet ids: ' +
          (event.target as IDBRequest).error?.toString(),
      )
    }
  })
}

/**
 * Delete multiple BOOKMARK records by their tweet_ids for the current user.
 * Keys are rebuilt with the bookmark scheme (`${owner}_${tweet}`), so
 * category-prefixed records (likes/posts/…) are structurally unreachable here.
 * Used to remove bookmarks that were deleted on the server during sync.
 */
export async function deleteRecordsByTweetIds(
  tweetIds: string[],
): Promise<number> {
  if (!tweetIds.length) {
    return 0
  }

  const db = await openDb()
  const user_id = await getCurrentUserId()

  return new Promise((resolve, reject) => {
    const { objectStore, transaction } = getObjectStore(
      db,
      TWEETS_TABLE_NAME_V2,
    )
    let deleted = 0

    transaction.oncomplete = () => {
      resolve(deleted)
    }

    transaction.onerror = (event: Event) => {
      reject(
        'Transaction error: ' + (event.target as IDBRequest).error?.toString(),
      )
    }

    tweetIds.forEach((tweetId) => {
      const key = getPostId(user_id, tweetId)
      const request = objectStore.delete(key)
      request.onsuccess = () => {
        deleted++
      }
    })
  })
}

/**
 * One-time backfill: tag any existing record that has no `category_name` as
 * `'bookmarks'`. Runs outside the onupgradeneeded transaction (which must stay
 * light) and is guarded by a storage flag so it only runs once per user.
 *
 * Rationale: IndexedDB indexes skip records whose indexed field is `undefined`,
 * so legacy bookmarks would not appear when querying by category until backfilled.
 */
export async function backfillCategoryName(): Promise<number> {
  const db = await openDb()
  const user_id = await getCurrentUserId()
  if (!user_id) {
    return 0
  }

  return new Promise((resolve, reject) => {
    const { objectStore, transaction } = getObjectStore(
      db,
      TWEETS_TABLE_NAME_V2,
    )
    const index = objectStore.index('owner_id')
    const request = index.openCursor(IDBKeyRange.only(user_id))
    let updated = 0

    request.onsuccess = (event: Event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
      if (cursor) {
        const record = cursor.value as Tweet
        if (!record.category_name) {
          record.category_name = 'bookmarks'
          cursor.update(record)
          updated++
        }
        cursor.continue()
      }
    }

    transaction.oncomplete = () => resolve(updated)
    transaction.onerror = (event: Event) =>
      reject(
        'Backfill error: ' + (event.target as IDBRequest).error?.toString(),
      )
  })
}

export async function countRecords(
  indexName?: string,
  value?: string,
): Promise<CountInfo> {
  const db = await openDb()
  const user_id = await getCurrentUserId()

  return new Promise((resolve, reject) => {
    const { objectStore } = getObjectStore(db, TWEETS_TABLE_NAME_V2)
    let request
    if (indexName) {
      const index = objectStore.index(indexName)
      const keyRange = IDBKeyRange.only(value)
      request = index.count(keyRange)
    } else {
      request = objectStore.count()
    }
    const counts = {
      total: 0,
      // 不属于任何文件夹
      unsorted: 0,
      image: 0,
      video: 0,
      gif: 0,
      link: 0,
      quote: 0,
      long_text: 0,
    }
    request.onsuccess = async (event: Event) => {
      const total = (event.target as IDBRequest<number>).result
      if (indexName) {
        counts.total = total
        resolve(counts)
      } else {
        const cursorRequest = objectStore.openCursor()
        cursorRequest.onsuccess = (cursorEvent: Event) => {
          const cursor = (cursorEvent.target as IDBRequest<IDBCursorWithValue>)
            .result
          if (cursor) {
            const record = cursor.value
            if (record.owner_id === user_id) {
              counts.total++
              if (record.has_image) counts.image++
              if (record.has_video) counts.video++
              if (record.has_gif) counts.gif++
              if (record.has_link) counts.link++
              if (record.has_quote) counts.quote++
              if (record.is_long_text) counts.long_text++
              if (!record.folder) counts.unsorted++
            }
            cursor.continue()
          } else {
            resolve(counts)
          }
        }
        cursorRequest.onerror = (cursorEvent: Event) => {
          reject(
            'Cursor error: ' +
              (cursorEvent.target as IDBRequest).error?.toString(),
          )
        }
      }
    }
    request.onerror = (event: Event) => {
      reject(
        'Count records error: ' +
          (event.target as IDBRequest).error?.toString(),
      )
    }
  })
}

export async function aggregateUsers(): Promise<
  Record<
    string,
    { username: string; avatar_url: string; screen_name: string; count: number }
  >
> {
  const db = await openDb()
  const user_id = await getCurrentUserId()
  const userInfo = {}

  return new Promise((resolve, reject) => {
    const { objectStore } = getObjectStore(db, TWEETS_TABLE_NAME_V2)
    const index = objectStore.index('sort_index')
    const request = index.openCursor()

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
      if (cursor) {
        const record = cursor.value
        if (record.owner_id === user_id) {
          const userId = record.screen_name
          if (!userInfo[userId]) {
            userInfo[userId] = {
              avatar_url: record.avatar_url,
              username: record.username,
              screen_name: record.screen_name,
              count: 0,
            }
          }
          userInfo[userId].count += 1
        }
        cursor.continue()
      } else {
        resolve(userInfo)
      }
    }

    request.onerror = () => reject(request.error)
  })
}

export async function getTopUsers(num = 10) {
  const users = await aggregateUsers()
  return Object.values(users)
    .sort((a, b) => b.count - a.count)
    .slice(0, num)
}

export async function getRencentTweets(days: number): Promise<{
  total: number
  data: { date: string; count: number }[]
}> {
  const db = await openDb()
  const user_id = await getCurrentUserId()
  return new Promise((resolve, reject) => {
    const { objectStore } = getObjectStore(db, TWEETS_TABLE_NAME_V2)
    const index = objectStore.index('created_at')
    const oneYearAgo = Math.floor(
      (Date.now() - days * 24 * 60 * 60 * 1000) / 1000,
    )
    const range = IDBKeyRange.lowerBound(oneYearAgo)
    const request = index.openCursor(range)
    const dateCounts: { [key: string]: number } = {}
    let total = 0

    request.onsuccess = () => {
      const cursor = request.result
      if (cursor) {
        const tweet = cursor.value
        if (tweet.owner_id === user_id) {
          const date = formatDate(new Date(tweet.created_at * 1000))
          total += 1
          if (dateCounts[date]) {
            dateCounts[date] += 1
          } else {
            dateCounts[date] = 1
          }
        }
        cursor.continue()
      } else {
        const result = Object.keys(dateCounts).map((date) => ({
          date,
          count: dateCounts[date],
        }))
        resolve({
          total,
          data: result,
        })
      }
    }

    request.onerror = (event) => {
      reject(request.error)
    }
  })
}

export async function clearFolder(folder: string): Promise<void> {
  const db = await openDb()
  const user_id = await getCurrentUserId()

  return new Promise((resolve, reject) => {
    const store = getObjectStore(db, TWEETS_TABLE_NAME_V2).objectStore
    const index = store.index('folder')
    const request = index.openCursor(IDBKeyRange.only(folder))

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
      if (cursor) {
        const updateData = cursor.value
        if (updateData.owner_id === user_id) {
          updateData.folder = ''
          cursor.update(updateData)
        }
        cursor.continue()
      } else {
        resolve()
      }
    }

    request.onerror = (event) => {
      reject(
        'Failed to clear folder: ' +
          (event.target as IDBRequest).error?.toString(),
      )
    }
  })
}

export async function updateFolder(
  ids: string[],
  folder: string,
): Promise<number> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const { objectStore, transaction } = getObjectStore(
      db,
      TWEETS_TABLE_NAME_V2,
    )

    let count = 0

    transaction.oncomplete = function () {
      resolve(count)
    }

    transaction.onerror = function (err) {
      reject(err)
    }

    ids.forEach((id) => {
      // 获取记录
      const request = objectStore.get(id)
      request.onsuccess = function () {
        const record = request.result
        if (record) {
          record.folder = folder
          objectStore.put(record)
          count += 1
        } else {
          console.log(`Record with id ${id} not found`)
        }
      }

      request.onerror = function (err) {
        console.error(`Error getting record with id ${id}:`, err)
      }
    })
  })
}

export async function iterate(
  filter: (record: Tweet) => boolean,
  limit = Number.MAX_SAFE_INTEGER,
  offset = 0,
): Promise<Tweet[]> {
  const db = await openDb()
  const user_id = await getCurrentUserId()
  if (!user_id) {
    return Promise.resolve([])
  }

  const records: Tweet[] = []
  let total = 0
  let mateched = 0

  return new Promise((resolve, reject) => {
    const { objectStore } = getObjectStore(db, TWEETS_TABLE_NAME_V2)
    const index = objectStore.index('sort_index')
    const request = index.openCursor(null, 'prev')

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
      if (cursor && total < limit) {
        const record = cursor.value
        if (record.owner_id === user_id) {
          if (filter(record) === true) {
            mateched += 1
            if (mateched > offset) {
              total += 1
              records.push(record)
            }
          }
        }
        cursor.continue()
      } else {
        resolve(records)
      }
    }

    request.onerror = () => reject(request.error)
  })
}
