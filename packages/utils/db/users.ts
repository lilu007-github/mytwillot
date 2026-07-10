import { getCurrentUserId } from '../storage'
import { DB_NAME, DB_VERSION, USERS_TABLE_NAME, getObjectStore, openDb } from './index'

export interface StoredUser {
  /** Composite key: `${owner_id}_${relationship}_${rest_id}` */
  id: string
  rest_id: string
  owner_id: string
  relationship: 'follower' | 'following'
  name: string
  screen_name: string
  profile_image_url_https: string
  profile_banner_url?: string
  description: string
  followers_count: number
  friends_count: number
  statuses_count: number
  is_blue_verified: boolean
  location: string
  created_at: string
  synced_at: number
  folder?: string
}

export function getUserId(
  ownerId: string,
  relationship: string,
  restId: string,
): string {
  return `${ownerId}_${relationship}_${restId}`
}

export async function upsertUsers(users: StoredUser[]): Promise<void> {
  const db = await openDb(DB_NAME, DB_VERSION)
  const { transaction, objectStore } = getObjectStore(db, USERS_TABLE_NAME)

  return new Promise((resolve, reject) => {
    users.forEach((user) => {
      objectStore.put(user)
    })
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(new Error('Failed to upsert users'))
  })
}

export async function countUsers(
  ownerId?: string,
): Promise<{ followers: number; following: number }> {
  const uid = ownerId || (await getCurrentUserId())
  const db = await openDb(DB_NAME, DB_VERSION)
  const { objectStore } = getObjectStore(db, USERS_TABLE_NAME)

  return new Promise((resolve, reject) => {
    const counts = { followers: 0, following: 0 }
    const index = objectStore.index('owner_id')
    const request = index.openCursor(IDBKeyRange.only(uid))

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest).result
      if (cursor) {
        const rel = cursor.value.relationship
        if (rel === 'follower') counts.followers++
        else if (rel === 'following') counts.following++
        cursor.continue()
      } else {
        resolve(counts)
      }
    }
    request.onerror = () => reject(new Error('Failed to count users'))
  })
}

export async function updateUserFolder(
  ids: string[],
  folder: string,
): Promise<{ succeeded: string[]; failed: string[] }> {
  const db = await openDb(DB_NAME, DB_VERSION)
  const { objectStore, transaction } = getObjectStore(db, USERS_TABLE_NAME)

  return new Promise((resolve, reject) => {
    const succeeded: string[] = []
    const failed: string[] = []
    let processed = 0

    transaction.oncomplete = () => resolve({ succeeded, failed })
    transaction.onerror = () => reject(new Error('Failed to update user folders'))

    ids.forEach((id) => {
      const request = objectStore.get(id)
      request.onsuccess = () => {
        const record = request.result
        if (record) {
          record.folder = folder
          objectStore.put(record)
          succeeded.push(id)
        } else {
          failed.push(id)
        }
        processed++
      }
      request.onerror = () => {
        failed.push(id)
        processed++
      }
    })
  })
}

/** All users for a relationship (no pagination) — used by the Circles view. */
export async function getUsersByRelationship(
  relationship: 'follower' | 'following',
  ownerId?: string,
): Promise<StoredUser[]> {
  return findUsers(relationship, '', Number.MAX_SAFE_INTEGER, 0, ownerId)
}

/**
 * Follow edges [source, target] passively captured into the users table,
 * restricted to a given id set (typically the people you follow). A row
 * {owner_id: A, relationship: 'following', rest_id: B} means "A follows B",
 * captured whenever you browsed A's Following tab on x.com. Scans only the
 * 'following' slice via the relationship index; rows outside `ids` (your own
 * lists, other browsed profiles) are filtered out.
 */
export async function getFollowEdgesAmong(
  ids: Set<string>,
): Promise<Array<[string, string]>> {
  const db = await openDb(DB_NAME, DB_VERSION)
  const { objectStore } = getObjectStore(db, USERS_TABLE_NAME)

  return new Promise((resolve, reject) => {
    const edges: Array<[string, string]> = []
    const request = objectStore
      .index('relationship')
      .openCursor(IDBKeyRange.only('following'))
    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest).result
      if (!cursor) {
        resolve(edges)
        return
      }
      const v = cursor.value as StoredUser
      if (ids.has(v.owner_id) && ids.has(v.rest_id)) {
        edges.push([v.owner_id, v.rest_id])
      }
      cursor.continue()
    }
    request.onerror = () => reject(new Error('Failed to read follow edges'))
  })
}

export async function findUsers(
  relationship: 'follower' | 'following',
  keyword = '',
  limit = 100,
  offset = 0,
  ownerId?: string,
): Promise<StoredUser[]> {
  const uid = ownerId || (await getCurrentUserId())
  const db = await openDb(DB_NAME, DB_VERSION)
  const { objectStore } = getObjectStore(db, USERS_TABLE_NAME)

  return new Promise((resolve, reject) => {
    const results: StoredUser[] = []
    const index = objectStore.index('owner_id')
    const request = index.openCursor(IDBKeyRange.only(uid))
    let skipped = 0
    const lowerKeyword = keyword.toLowerCase()

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest).result
      if (!cursor) {
        resolve(results)
        return
      }

      const value = cursor.value as StoredUser
      if (value.relationship !== relationship) {
        cursor.continue()
        return
      }

      if (
        lowerKeyword &&
        !value.name.toLowerCase().includes(lowerKeyword) &&
        !value.screen_name.toLowerCase().includes(lowerKeyword) &&
        !value.description.toLowerCase().includes(lowerKeyword)
      ) {
        cursor.continue()
        return
      }

      if (skipped < offset) {
        skipped++
        cursor.continue()
        return
      }

      if (results.length < limit) {
        results.push(value)
        cursor.continue()
      } else {
        resolve(results)
      }
    }

    request.onerror = () => reject(new Error('Failed to find users'))
  })
}
