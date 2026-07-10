import {
  Tag,
  DuplicateTagError,
  InvalidTagNameError,
  TAG_COLORS,
} from '../types/tag'
import { getCurrentUserId } from '../storage'
import {
  openDb,
  getObjectStore,
  TAGS_TABLE_NAME,
  TWEETS_TABLE_NAME_V2,
} from './index'

export function getTagId(ownerId: string, name: string): string {
  return `${ownerId}_${name}`
}

export function validateTagName(
  name: string,
  existingNames: string[],
): string | Error {
  const trimmed = name.trim()
  if (trimmed.length === 0) {
    return new InvalidTagNameError('Tag name cannot be empty')
  }
  if (trimmed.length > 50) {
    return new InvalidTagNameError('Tag name must be 50 characters or fewer')
  }
  if (existingNames.includes(trimmed)) {
    return new DuplicateTagError(trimmed)
  }
  return trimmed
}

export async function getTags(): Promise<Tag[]> {
  const ownerId = await getCurrentUserId()
  const db = await openDb()
  const { objectStore } = getObjectStore(db, TAGS_TABLE_NAME)

  return new Promise((resolve, reject) => {
    const index = objectStore.index('owner_id')
    const request = index.openCursor(IDBKeyRange.only(ownerId))
    const tags: Tag[] = []
    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
      if (cursor) {
        tags.push(cursor.value)
        cursor.continue()
      } else {
        tags.sort((a, b) => a.sort_order - b.sort_order)
        resolve(tags)
      }
    }
    request.onerror = () => reject(new Error('Failed to get tags'))
  })
}

export async function createTag(name: string, color?: string): Promise<Tag> {
  const ownerId = await getCurrentUserId()
  const existing = await getTags()
  const result = validateTagName(
    name,
    existing.map((t) => t.name),
  )
  if (result instanceof Error) {
    throw result
  }
  const trimmed = result
  const tag: Tag = {
    id: getTagId(ownerId, trimmed),
    owner_id: ownerId,
    name: trimmed,
    color: color || TAG_COLORS[existing.length % TAG_COLORS.length],
    sort_order: existing.length,
    created_at: Math.floor(Date.now() / 1000),
  }
  const db = await openDb()
  const { objectStore, transaction } = getObjectStore(db, TAGS_TABLE_NAME)
  return new Promise((resolve, reject) => {
    objectStore.put(tag)
    transaction.oncomplete = () => resolve(tag)
    transaction.onerror = () => reject(new Error('Failed to create tag'))
  })
}

export async function setTagColor(name: string, color: string): Promise<void> {
  const ownerId = await getCurrentUserId()
  const id = getTagId(ownerId, name)
  const db = await openDb()
  const { objectStore, transaction } = getObjectStore(db, TAGS_TABLE_NAME)
  return new Promise((resolve, reject) => {
    const getReq = objectStore.get(id)
    getReq.onsuccess = () => {
      const tag = getReq.result as Tag | undefined
      if (tag) {
        tag.color = color
        objectStore.put(tag)
      }
    }
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(new Error('Failed to set tag color'))
  })
}

/**
 * Delete a tag and remove it from every tweet's `tags` array.
 */
export async function deleteTag(name: string): Promise<void> {
  const ownerId = await getCurrentUserId()
  const id = getTagId(ownerId, name)

  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const { objectStore, transaction } = getObjectStore(db, TAGS_TABLE_NAME)
    objectStore.delete(id)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(new Error('Failed to delete tag'))
  })

  // Strip the tag from all tweets that reference it.
  const db2 = await openDb()
  await new Promise<void>((resolve, reject) => {
    const { objectStore, transaction } = getObjectStore(
      db2,
      TWEETS_TABLE_NAME_V2,
    )
    const index = objectStore.index('tags')
    const request = index.openCursor(IDBKeyRange.only(name))
    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
      if (cursor) {
        const record = cursor.value
        if (record.owner_id === ownerId && Array.isArray(record.tags)) {
          record.tags = record.tags.filter((t: string) => t !== name)
          cursor.update(record)
        }
        cursor.continue()
      } else {
        resolve()
      }
    }
    request.onerror = () => reject(new Error('Failed to strip tag from tweets'))
  })
}

export async function renameTag(
  oldName: string,
  newName: string,
): Promise<void> {
  const ownerId = await getCurrentUserId()
  const existing = await getTags()
  const result = validateTagName(
    newName,
    existing.filter((t) => t.name !== oldName).map((t) => t.name),
  )
  if (result instanceof Error) {
    throw result
  }
  const trimmed = result
  const old = existing.find((t) => t.name === oldName)
  if (!old) {
    return
  }
  const updated: Tag = {
    ...old,
    id: getTagId(ownerId, trimmed),
    name: trimmed,
  }

  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const { objectStore, transaction } = getObjectStore(db, TAGS_TABLE_NAME)
    objectStore.delete(old.id)
    objectStore.put(updated)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(new Error('Failed to rename tag'))
  })

  const db2 = await openDb()
  await new Promise<void>((resolve, reject) => {
    const { objectStore, transaction } = getObjectStore(
      db2,
      TWEETS_TABLE_NAME_V2,
    )
    const index = objectStore.index('tags')
    const request = index.openCursor(IDBKeyRange.only(oldName))
    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
      if (cursor) {
        const record = cursor.value
        if (record.owner_id === ownerId && Array.isArray(record.tags)) {
          record.tags = record.tags.map((t: string) =>
            t === oldName ? trimmed : t,
          )
          cursor.update(record)
        }
        cursor.continue()
      } else {
        resolve()
      }
    }
    request.onerror = () => reject(new Error('Failed to rename tag on tweets'))
  })
}

/**
 * Set the full tag list on a single tweet record.
 */
export async function setTweetTags(
  tweetId: string,
  tags: string[],
): Promise<void> {
  const ownerId = await getCurrentUserId()
  const db = await openDb()
  const { objectStore, transaction } = getObjectStore(
    db,
    TWEETS_TABLE_NAME_V2,
  )
  return new Promise((resolve, reject) => {
    const getReq = objectStore.get(tweetId)
    getReq.onsuccess = () => {
      const record = getReq.result
      if (record && record.owner_id === ownerId) {
        record.tags = tags
        objectStore.put(record)
      }
    }
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(new Error('Failed to set tweet tags'))
  })
}

/**
 * Count tweets per tag name for the current user.
 */
export async function getTagCounts(): Promise<Record<string, number>> {
  const ownerId = await getCurrentUserId()
  const db = await openDb()
  const { objectStore } = getObjectStore(db, TWEETS_TABLE_NAME_V2)
  return new Promise((resolve, reject) => {
    const counts: Record<string, number> = {}
    // Scan only this account's records via the owner_id index; each record is
    // visited once and its tags counted in JS (the multiEntry tags index would
    // walk one entry per tag across every account).
    const request = objectStore
      .index('owner_id')
      .openCursor(IDBKeyRange.only(ownerId))
    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
      if (cursor) {
        const tags = cursor.value.tags
        if (Array.isArray(tags)) {
          for (const tag of tags) {
            counts[tag] = (counts[tag] || 0) + 1
          }
        }
        cursor.continue()
      } else {
        resolve(counts)
      }
    }
    request.onerror = () => reject(new Error('Failed to count tags'))
  })
}
