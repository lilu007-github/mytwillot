import browser from 'webextension-polyfill'
import { describe, it, expect, beforeEach } from 'vitest'

import {
  AccountEntry,
  getAccountRegistry,
  upsertAccountEntry,
  removeAccount,
  getActiveAccountId,
  detectAndSetActiveAccount,
} from './account-manager'
import { setCurrentUserId, StorageKeys } from './storage'

describe('Account Manager', () => {
  beforeEach(() => {
    global.chrome = browser
    browser.reset()
  })

  describe('getAccountRegistry', () => {
    it('returns empty array when no registry exists', async () => {
      const result = await getAccountRegistry()
      expect(result).toEqual([])
    })

    it('returns entries sorted by last_active_at descending', async () => {
      const entries: AccountEntry[] = [
        {
          user_id: '1',
          screen_name: 'user1',
          profile_image_url: '',
          first_seen_at: 1000,
          last_active_at: 1000,
        },
        {
          user_id: '2',
          screen_name: 'user2',
          profile_image_url: '',
          first_seen_at: 2000,
          last_active_at: 3000,
        },
        {
          user_id: '3',
          screen_name: 'user3',
          profile_image_url: '',
          first_seen_at: 1500,
          last_active_at: 2000,
        },
      ]
      await browser.storage.local.set({ account_registry: entries })

      const result = await getAccountRegistry()
      expect(result[0].user_id).toBe('2')
      expect(result[1].user_id).toBe('3')
      expect(result[2].user_id).toBe('1')
    })
  })

  describe('upsertAccountEntry', () => {
    it('adds a new entry when user_id does not exist', async () => {
      await upsertAccountEntry({
        user_id: '123',
        screen_name: 'testuser',
        profile_image_url: 'https://example.com/img.png',
        last_active_at: 5000,
        first_seen_at: 5000,
      })

      const registry = await getAccountRegistry()
      expect(registry).toHaveLength(1)
      expect(registry[0].user_id).toBe('123')
      expect(registry[0].screen_name).toBe('testuser')
      expect(registry[0].first_seen_at).toBe(5000)
    })

    it('updates existing entry preserving first_seen_at', async () => {
      await upsertAccountEntry({
        user_id: '123',
        screen_name: 'oldname',
        profile_image_url: 'old.png',
        first_seen_at: 1000,
        last_active_at: 1000,
      })

      await upsertAccountEntry({
        user_id: '123',
        screen_name: 'newname',
        profile_image_url: 'new.png',
        last_active_at: 2000,
      })

      const registry = await getAccountRegistry()
      expect(registry).toHaveLength(1)
      expect(registry[0].screen_name).toBe('newname')
      expect(registry[0].profile_image_url).toBe('new.png')
      expect(registry[0].first_seen_at).toBe(1000)
      expect(registry[0].last_active_at).toBe(2000)
    })

    it('enforces 20-entry cap by evicting oldest last_active_at', async () => {
      // Add 20 entries
      for (let i = 1; i <= 20; i++) {
        await upsertAccountEntry({
          user_id: String(i),
          screen_name: `user${i}`,
          last_active_at: i * 100,
          first_seen_at: i * 100,
        })
      }

      let registry = await getAccountRegistry()
      expect(registry).toHaveLength(20)

      // Add 21st entry — should evict user_id '1' (oldest last_active_at = 100)
      await upsertAccountEntry({
        user_id: '21',
        screen_name: 'user21',
        last_active_at: 2100,
        first_seen_at: 2100,
      })

      registry = await getAccountRegistry()
      expect(registry).toHaveLength(20)
      expect(registry.find((e) => e.user_id === '1')).toBeUndefined()
      expect(registry.find((e) => e.user_id === '21')).toBeDefined()
    })
  })

  describe('removeAccount', () => {
    it('removes an entry from the registry', async () => {
      await upsertAccountEntry({
        user_id: '100',
        screen_name: 'toremove',
        last_active_at: 1000,
        first_seen_at: 1000,
      })
      await upsertAccountEntry({
        user_id: '200',
        screen_name: 'tokeep',
        last_active_at: 2000,
        first_seen_at: 2000,
      })

      // Set active account to '200' so we can remove '100'
      await setCurrentUserId('200')

      await removeAccount('100')
      const registry = await getAccountRegistry()
      expect(registry).toHaveLength(1)
      expect(registry[0].user_id).toBe('200')
    })

    it('rejects removal of the active account', async () => {
      await setCurrentUserId('100')
      await upsertAccountEntry({
        user_id: '100',
        screen_name: 'active',
        last_active_at: 1000,
        first_seen_at: 1000,
      })

      await expect(removeAccount('100')).rejects.toThrow(
        'Cannot remove the currently active account',
      )

      const registry = await getAccountRegistry()
      expect(registry).toHaveLength(1)
    })
  })

  describe('getActiveAccountId', () => {
    it('returns empty string when no active account', async () => {
      const result = await getActiveAccountId()
      expect(result).toBe('')
    })

    it('returns the current user id from storage', async () => {
      await setCurrentUserId('456')
      const result = await getActiveAccountId()
      expect(result).toBe('456')
    })
  })

  describe('detectAndSetActiveAccount', () => {
    it('updates current_user_id when different from stored', async () => {
      await setCurrentUserId('old_id')
      await detectAndSetActiveAccount('new_id', 'newuser', 'img.png')

      const activeId = await getActiveAccountId()
      expect(activeId).toBe('new_id')
    })

    it('upserts account entry with provided metadata', async () => {
      await detectAndSetActiveAccount('789', 'myuser', 'avatar.png')

      const registry = await getAccountRegistry()
      expect(registry).toHaveLength(1)
      expect(registry[0].user_id).toBe('789')
      expect(registry[0].screen_name).toBe('myuser')
      expect(registry[0].profile_image_url).toBe('avatar.png')
    })

    it('does not upsert when parsed user id is empty', async () => {
      await detectAndSetActiveAccount('', '', '')

      const registry = await getAccountRegistry()
      expect(registry).toHaveLength(0)
    })
  })
})
