import browser from 'webextension-polyfill'
import { describe, it, expect, beforeEach } from 'vitest'

import {
  SyncState,
  startFullSync,
  cancelCurrentSync,
  resumeSync,
  getSyncState,
} from './sync-engine'
import { setCurrentUserId, getStorageKey, StorageKeys } from './storage'

describe('Sync Engine', () => {
  beforeEach(() => {
    global.chrome = browser
    browser.reset()
  })

  describe('startFullSync', () => {
    it('resets bookmark cursor to empty string', async () => {
      const userId = '12345'
      const cursorKey = getStorageKey(StorageKeys.Bookmark_Cursor, userId)

      // Set an existing cursor
      await chrome.storage.local.set({ [cursorKey]: 'some-cursor-value' })

      await startFullSync(userId)

      const result = await chrome.storage.local.get(cursorKey)
      expect(result[cursorKey]).toBe('')
    })

    it('sets sync state to syncing with progress 0', async () => {
      const userId = '12345'
      await startFullSync(userId)

      const stateKey = getStorageKey('sync_state', userId)
      const result = await chrome.storage.local.get(stateKey)
      const state = result[stateKey] as SyncState

      expect(state.status).toBe('syncing')
      expect(state.progress).toBe(0)
      expect(state.total).toBeNull()
      expect(state.owner_id).toBe(userId)
    })

    it('throws when userId is empty', async () => {
      await expect(startFullSync('')).rejects.toThrow(
        'Cannot start sync without a valid user ID',
      )
    })
  })

  describe('cancelCurrentSync', () => {
    it('sets sync state to idle when currently syncing', async () => {
      const userId = '12345'
      await setCurrentUserId(userId)

      // Start a sync first
      await startFullSync(userId)

      // Cancel it
      await cancelCurrentSync()

      const stateKey = getStorageKey('sync_state', userId)
      const result = await chrome.storage.local.get(stateKey)
      const state = result[stateKey] as SyncState

      expect(state.status).toBe('idle')
      expect(state.owner_id).toBe(userId)
    })

    it('does nothing when no user is active', async () => {
      // No user set — should not throw
      await cancelCurrentSync()
    })

    it('does nothing when sync state is already idle', async () => {
      const userId = '12345'
      await setCurrentUserId(userId)

      const stateKey = getStorageKey('sync_state', userId)
      const idleState: SyncState = {
        status: 'idle',
        progress: 50,
        total: 100,
        owner_id: userId,
      }
      await chrome.storage.local.set({ [stateKey]: idleState })

      await cancelCurrentSync()

      const result = await chrome.storage.local.get(stateKey)
      const state = result[stateKey] as SyncState

      // State should remain unchanged
      expect(state.status).toBe('idle')
      expect(state.progress).toBe(50)
    })

    it('preserves progress count when cancelling', async () => {
      const userId = '12345'
      await setCurrentUserId(userId)

      const stateKey = getStorageKey('sync_state', userId)
      const syncingState: SyncState = {
        status: 'syncing',
        progress: 75,
        total: 200,
        owner_id: userId,
      }
      await chrome.storage.local.set({ [stateKey]: syncingState })

      await cancelCurrentSync()

      const result = await chrome.storage.local.get(stateKey)
      const state = result[stateKey] as SyncState

      expect(state.status).toBe('idle')
      expect(state.progress).toBe(75)
      expect(state.total).toBe(200)
    })
  })

  describe('resumeSync', () => {
    it('sets sync state to syncing when cursor exists', async () => {
      const userId = '12345'
      const cursorKey = getStorageKey(StorageKeys.Bookmark_Cursor, userId)

      // Set an existing cursor
      await chrome.storage.local.set({ [cursorKey]: 'page-3-cursor' })

      // Set existing state with progress
      const stateKey = getStorageKey('sync_state', userId)
      const existingState: SyncState = {
        status: 'idle',
        progress: 60,
        total: 150,
        owner_id: userId,
      }
      await chrome.storage.local.set({ [stateKey]: existingState })

      await resumeSync(userId)

      const result = await chrome.storage.local.get(stateKey)
      const state = result[stateKey] as SyncState

      expect(state.status).toBe('syncing')
      expect(state.progress).toBe(60)
      expect(state.total).toBe(150)
      expect(state.owner_id).toBe(userId)
    })

    it('does not reset the cursor when resuming', async () => {
      const userId = '12345'
      const cursorKey = getStorageKey(StorageKeys.Bookmark_Cursor, userId)

      await chrome.storage.local.set({ [cursorKey]: 'existing-cursor' })

      await resumeSync(userId)

      const result = await chrome.storage.local.get(cursorKey)
      expect(result[cursorKey]).toBe('existing-cursor')
    })

    it('falls back to startFullSync when no cursor exists', async () => {
      const userId = '12345'

      await resumeSync(userId)

      const stateKey = getStorageKey('sync_state', userId)
      const result = await chrome.storage.local.get(stateKey)
      const state = result[stateKey] as SyncState

      expect(state.status).toBe('syncing')
      expect(state.progress).toBe(0)
      expect(state.total).toBeNull()
      expect(state.owner_id).toBe(userId)
    })

    it('throws when userId is empty', async () => {
      await expect(resumeSync('')).rejects.toThrow(
        'Cannot resume sync without a valid user ID',
      )
    })
  })

  describe('getSyncState', () => {
    it('returns default idle state when no state exists', async () => {
      await setCurrentUserId('12345')

      const state = await getSyncState()

      expect(state.status).toBe('idle')
      expect(state.progress).toBe(0)
      expect(state.total).toBeNull()
      expect(state.owner_id).toBe('12345')
    })

    it('returns persisted sync state for active account', async () => {
      const userId = '12345'
      await setCurrentUserId(userId)

      const stateKey = getStorageKey('sync_state', userId)
      const persistedState: SyncState = {
        status: 'syncing',
        progress: 42,
        total: 100,
        owner_id: userId,
      }
      await chrome.storage.local.set({ [stateKey]: persistedState })

      const state = await getSyncState()

      expect(state.status).toBe('syncing')
      expect(state.progress).toBe(42)
      expect(state.total).toBe(100)
      expect(state.owner_id).toBe(userId)
    })

    it('returns default state when no active user', async () => {
      const state = await getSyncState()

      expect(state.status).toBe('idle')
      expect(state.progress).toBe(0)
      expect(state.total).toBeNull()
      expect(state.owner_id).toBe('')
    })

    it('returns state with error message when sync errored', async () => {
      const userId = '99999'
      await setCurrentUserId(userId)

      const stateKey = getStorageKey('sync_state', userId)
      const errorState: SyncState = {
        status: 'error',
        progress: 30,
        total: null,
        owner_id: userId,
        error_message: 'Network timeout',
      }
      await chrome.storage.local.set({ [stateKey]: errorState })

      const state = await getSyncState()

      expect(state.status).toBe('error')
      expect(state.error_message).toBe('Network timeout')
      expect(state.progress).toBe(30)
    })
  })
})
