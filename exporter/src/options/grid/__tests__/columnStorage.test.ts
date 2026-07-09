import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'webextension-polyfill'

import { COLUMN_PREF_KEY, DEFAULT_COLUMNS } from '../types'
import {
  loadColumnPreferences,
  saveColumnPreferences,
} from '../columnStorage'

const allVisibleDefaults = (): Record<string, boolean> =>
  Object.fromEntries(DEFAULT_COLUMNS.map((col) => [col.key, true]))

describe('columnStorage', () => {
  beforeEach(async () => {
    await chrome.storage.local.clear()
    saveColumnPreferences.cancel()
  })

  describe('loadColumnPreferences', () => {
    it('returns all-visible defaults when no preferences saved', async () => {
      const result = await loadColumnPreferences()
      expect(result).toEqual(allVisibleDefaults())
    })

    it('returns saved preferences from Chrome Storage', async () => {
      const prefs = { ...allVisibleDefaults(), location: false }
      await chrome.storage.local.set({
        [COLUMN_PREF_KEY]: prefs,
      })

      const result = await loadColumnPreferences()
      expect(result).toEqual(prefs)
    })

    it('falls back to defaults when stored value is not an object', async () => {
      await chrome.storage.local.set({
        [COLUMN_PREF_KEY]: 'invalid',
      })

      const result = await loadColumnPreferences()
      expect(result).toEqual(allVisibleDefaults())
    })

    it('falls back to defaults when stored value is an array', async () => {
      await chrome.storage.local.set({
        [COLUMN_PREF_KEY]: [true, false],
      })

      const result = await loadColumnPreferences()
      expect(result).toEqual(allVisibleDefaults())
    })
  })

  describe('saveColumnPreferences', () => {
    it('persists visibility to Chrome Storage', async () => {
      const prefs = {
        ...allVisibleDefaults(),
        description: false,
      }

      saveColumnPreferences(prefs)
      saveColumnPreferences.flush()

      await vi.waitFor(async () => {
        const stored = await chrome.storage.local.get(
          COLUMN_PREF_KEY,
        )
        expect(stored[COLUMN_PREF_KEY]).toEqual(prefs)
      })
    })

    it('debounces multiple rapid calls', async () => {
      const prefs1 = { ...allVisibleDefaults(), name: false }
      const prefs2 = { ...allVisibleDefaults(), location: false }

      saveColumnPreferences(prefs1)
      saveColumnPreferences(prefs2)
      saveColumnPreferences.flush()

      await vi.waitFor(async () => {
        const stored = await chrome.storage.local.get(
          COLUMN_PREF_KEY,
        )
        // Only the last call should be persisted
        expect(stored[COLUMN_PREF_KEY]).toEqual(prefs2)
      })
    })
  })
})
