import 'fake-indexeddb/auto'
import browser from 'webextension-polyfill'
import { describe, it, expect, beforeEach } from 'vitest'

import { canDelete, deleteAccountData, AccountCleanupResult } from './account-cleanup'
import { upsertAccountEntry, getAccountRegistry } from './account-manager'
import { setCurrentUserId } from './storage'
import {
  openDb,
  TWEETS_TABLE_NAME_V2,
  CONFIGS_TABLE_NAME_V2,
  USERS_TABLE_NAME,
  FOLDERS_TABLE_NAME,
} from './db/index'

describe('Account Cleanup', () => {
  beforeEach(() => {
    global.chrome = browser
    browser.reset()
  })

  describe('canDelete', () => {
    it('returns true when userId does not match active account', async () => {
      await setCurrentUserId('active_user')
      const result = await canDelete('other_user')
      expect(result).toBe(true)
    })

    it('returns false when userId matches active account', async () => {
      await setCurrentUserId('active_user')
      const result = await canDelete('active_user')
      expect(result).toBe(false)
    })

    it('returns true when no active account is set and userId is non-empty', async () => {
      // No active account set (empty string)
      const result = await canDelete('some_user')
      expect(result).toBe(true)
    })
  })

  describe('deleteAccountData', () => {
    it('throws when attempting to delete the active account', async () => {
      await setCurrentUserId('active_user')
      await expect(deleteAccountData('active_user')).rejects.toThrow(
        'Cannot delete the currently active account',
      )
    })

    it('removes Chrome Storage keys matching user:{userId}:* pattern', async () => {
      await setCurrentUserId('active_user')

      // Set up namespaced keys for the target account
      await chrome.storage.local.set({
        'user:target_user:token': 'abc',
        'user:target_user:csrf': 'xyz',
        'user:target_user:bookmark_cursor': 'cursor123',
        'user:active_user:token': 'keep_this',
        'current_user_id': 'active_user',
      })

      // Set up registry
      await upsertAccountEntry({
        user_id: 'target_user',
        screen_name: 'target',
        last_active_at: 1000,
        first_seen_at: 1000,
      })

      const result = await deleteAccountData('target_user')

      expect(result.chromeStorageDeleted).toBe(true)

      // Verify target keys are removed
      const storage = await chrome.storage.local.get(null)
      const targetKeys = Object.keys(storage).filter((k) =>
        k.startsWith('user:target_user:'),
      )
      expect(targetKeys).toHaveLength(0)

      // Verify active user keys are preserved
      expect(storage['user:active_user:token']).toBe('keep_this')
    })

    it('removes account from registry when both deletions succeed', async () => {
      await setCurrentUserId('active_user')

      await upsertAccountEntry({
        user_id: 'target_user',
        screen_name: 'target',
        last_active_at: 1000,
        first_seen_at: 1000,
      })
      await upsertAccountEntry({
        user_id: 'active_user',
        screen_name: 'active',
        last_active_at: 2000,
        first_seen_at: 2000,
      })

      const result = await deleteAccountData('target_user')

      expect(result.indexedDbDeleted).toBe(true)
      expect(result.chromeStorageDeleted).toBe(true)
      expect(result.registryRemoved).toBe(true)

      const registry = await getAccountRegistry()
      expect(registry.find((e) => e.user_id === 'target_user')).toBeUndefined()
      expect(registry.find((e) => e.user_id === 'active_user')).toBeDefined()
    })

    it('returns complete success result when all steps succeed', async () => {
      await setCurrentUserId('active_user')

      await upsertAccountEntry({
        user_id: 'to_delete',
        screen_name: 'deleteme',
        last_active_at: 1000,
        first_seen_at: 1000,
      })

      const result = await deleteAccountData('to_delete')

      expect(result).toEqual({
        indexedDbDeleted: true,
        chromeStorageDeleted: true,
        registryRemoved: true,
      } satisfies AccountCleanupResult)
    })

    it('deletes IndexedDB records for the target user across all stores', async () => {
      await setCurrentUserId('active_user')

      await upsertAccountEntry({
        user_id: 'target_user',
        screen_name: 'target',
        last_active_at: 1000,
        first_seen_at: 1000,
      })

      // Seed IndexedDB with records for both users
      const db = await openDb()

      // Add posts for target user
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([TWEETS_TABLE_NAME_V2], 'readwrite')
        const store = tx.objectStore(TWEETS_TABLE_NAME_V2)
        store.put({
          id: 'target_user_tweet1',
          tweet_id: 'tweet1',
          owner_id: 'target_user',
          full_text: 'hello',
          sort_index: 1,
          screen_name: 'target',
          created_at: 1000,
        })
        store.put({
          id: 'active_user_tweet2',
          tweet_id: 'tweet2',
          owner_id: 'active_user',
          full_text: 'world',
          sort_index: 2,
          screen_name: 'active',
          created_at: 2000,
        })
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })

      // Add folders for target user
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([FOLDERS_TABLE_NAME], 'readwrite')
        const store = tx.objectStore(FOLDERS_TABLE_NAME)
        store.put({
          id: 'target_user_bookmark_work',
          owner_id: 'target_user',
          name: 'work',
          scope: 'bookmark',
          sort_order: 0,
          created_at: 1000,
        })
        store.put({
          id: 'active_user_bookmark_personal',
          owner_id: 'active_user',
          name: 'personal',
          scope: 'bookmark',
          sort_order: 0,
          created_at: 2000,
        })
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })

      const result = await deleteAccountData('target_user')
      expect(result.indexedDbDeleted).toBe(true)

      // Verify target user records are deleted
      const postsRemaining = await new Promise<any[]>((resolve, reject) => {
        const tx = db.transaction([TWEETS_TABLE_NAME_V2], 'readonly')
        const store = tx.objectStore(TWEETS_TABLE_NAME_V2)
        const request = store.getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })

      expect(postsRemaining).toHaveLength(1)
      expect(postsRemaining[0].owner_id).toBe('active_user')

      // Verify target user folders are deleted
      const foldersRemaining = await new Promise<any[]>((resolve, reject) => {
        const tx = db.transaction([FOLDERS_TABLE_NAME], 'readonly')
        const store = tx.objectStore(FOLDERS_TABLE_NAME)
        const request = store.getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })

      expect(foldersRemaining).toHaveLength(1)
      expect(foldersRemaining[0].owner_id).toBe('active_user')
    })
  })
})
