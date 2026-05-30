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
