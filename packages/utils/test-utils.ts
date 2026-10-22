/**
 * Shared helpers for the property-based tests (fast-check + fake-indexeddb).
 * Imported only by *.test.ts files.
 */
import 'fake-indexeddb/auto'
import browser from 'webextension-polyfill'
import fc from 'fast-check'

import { openDb, getObjectStore } from './db/index'
import { setCurrentUserId } from './storage'
import { Tweet } from './types'

/** Iterations per property (design docs: minimum 100). */
export const NUM_RUNS = 100

/** Fresh fake chrome storage + fresh in-memory IndexedDB. */
export async function resetEnv(activeUserId = '') {
  global.chrome = browser as any
  ;(browser as any).reset()
  globalThis.indexedDB = new IDBFactory()
  if (activeUserId) {
    await setCurrentUserId(activeUserId)
  }
}

/** Write records straight into a store, bypassing owner/context checks. */
export async function putRaw(storeName: string, records: any[]) {
  const db = await openDb()
  const { objectStore, transaction } = getObjectStore(db, storeName)
  await new Promise<void>((resolve, reject) => {
    records.forEach((r) => objectStore.put(r))
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
}

export async function getAllRaw<T = any>(storeName: string): Promise<T[]> {
  const db = await openDb()
  const { objectStore } = getObjectStore(db, storeName)
  return new Promise((resolve, reject) => {
    const request = objectStore.getAll()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** Numeric Twitter-style user id. */
export const arbUserId = fc.stringMatching(/^[1-9]\d{0,18}$/)

/** Minimal post record that satisfies the owner_sort / owner_created indexes. */
export function makePost(
  ownerId: string,
  tweetId: string,
  extra: Partial<Tweet> = {},
): Tweet {
  return {
    id: `${ownerId}_${tweetId}`,
    owner_id: ownerId,
    tweet_id: tweetId,
    sort_index: tweetId,
    created_at: 1700000000,
    full_text: `post ${tweetId}`,
    screen_name: 'someone',
    folder: '',
    category_name: 'bookmarks',
    ...extra,
  } as Tweet
}
