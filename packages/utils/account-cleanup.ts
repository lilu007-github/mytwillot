import { getActiveAccountId, removeAccount } from './account-manager'
import {
  openDb,
  TWEETS_TABLE_NAME_V2,
  CONFIGS_TABLE_NAME_V2,
  USERS_TABLE_NAME,
  FOLDERS_TABLE_NAME,
} from './db/index'

export interface AccountCleanupResult {
  indexedDbDeleted: boolean
  chromeStorageDeleted: boolean
  registryRemoved: boolean
}

/**
 * Validate that the target account is not the active account.
 * Returns false if userId matches `current_user_id`.
 */
export async function canDelete(userId: string): Promise<boolean> {
  const activeId = await getActiveAccountId()
  return userId !== activeId
}

/**
 * Delete all IndexedDB records where `owner_id === userId`
 * across all object stores (posts, settings, users, folders).
 */
async function deleteIndexedDbRecords(userId: string): Promise<void> {
  const db = await openDb()
  const storeNames = [
    TWEETS_TABLE_NAME_V2,
    CONFIGS_TABLE_NAME_V2,
    USERS_TABLE_NAME,
    FOLDERS_TABLE_NAME,
  ]

  for (const storeName of storeNames) {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readwrite')
      const objectStore = transaction.objectStore(storeName)
      const request = objectStore.openCursor()

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
        if (cursor) {
          const record = cursor.value
          if (record.owner_id === userId) {
            cursor.delete()
          }
          cursor.continue()
        } else {
          resolve()
        }
      }

      request.onerror = (event) => {
        reject(
          new Error(
            `Failed to delete records from ${storeName}: ` +
              (event.target as IDBRequest).error?.toString(),
          ),
        )
      }
    })
  }
}

/**
 * Remove all Chrome Storage keys matching `user:{userId}:*` pattern.
 */
async function deleteChromeStorageKeys(userId: string): Promise<void> {
  const prefix = `user:${userId}:`
  const allItems = await chrome.storage.local.get()
  const keysToRemove = Object.keys(allItems).filter((key) =>
    key.startsWith(prefix),
  )

  if (keysToRemove.length > 0) {
    await chrome.storage.local.remove(keysToRemove)
  }
}

/**
 * Delete all data for a non-active account.
 *
 * Steps:
 * 1. Check canDelete(userId) — throws if false
 * 2. Try to delete all IndexedDB records where owner_id === userId
 * 3. Try to remove all Chrome Storage keys matching user:{userId}:*
 * 4. If both succeed, remove from account registry
 * 5. If one fails, report partial failure and keep registry entry
 */
export async function deleteAccountData(
  userId: string,
): Promise<AccountCleanupResult> {
  const allowed = await canDelete(userId)
  if (!allowed) {
    throw new Error('Cannot delete the currently active account')
  }

  const result: AccountCleanupResult = {
    indexedDbDeleted: false,
    chromeStorageDeleted: false,
    registryRemoved: false,
  }

  // Step 1: Try to delete IndexedDB records
  try {
    await deleteIndexedDbRecords(userId)
    result.indexedDbDeleted = true
  } catch (error) {
    // IndexedDB deletion failed — continue to try Chrome Storage
  }

  // Step 2: Try to delete Chrome Storage keys
  try {
    await deleteChromeStorageKeys(userId)
    result.chromeStorageDeleted = true
  } catch (error) {
    // Chrome Storage deletion failed
  }

  // Step 3: Only remove from registry if both deletions succeeded
  if (result.indexedDbDeleted && result.chromeStorageDeleted) {
    try {
      await removeAccount(userId)
      result.registryRemoved = true
    } catch (error) {
      // Registry removal failed — still report what succeeded
    }
  }

  return result
}
