import debounce from 'lodash.debounce'

import { COLUMN_PREF_KEY, DEFAULT_COLUMNS } from './types'

const allVisibleDefaults = (): Record<string, boolean> =>
  Object.fromEntries(DEFAULT_COLUMNS.map((col) => [col.key, true]))

/**
 * Loads column visibility preferences from Chrome Storage.
 * Falls back to all-columns-visible defaults if storage read fails
 * or no preferences have been saved yet.
 */
export async function loadColumnPreferences(): Promise<
  Record<string, boolean>
> {
  try {
    const result = await chrome.storage.local.get(COLUMN_PREF_KEY)
    const stored = result[COLUMN_PREF_KEY]
    if (
      stored &&
      typeof stored === 'object' &&
      !Array.isArray(stored)
    ) {
      return stored as Record<string, boolean>
    }
    return allVisibleDefaults()
  } catch (e) {
    console.warn(
      'Failed to load column preferences, using defaults',
      e,
    )
    return allVisibleDefaults()
  }
}

/**
 * Persists column visibility preferences to Chrome Storage.
 * Debounced to avoid excessive writes (< 1 second).
 */
export const saveColumnPreferences = debounce(
  async (visibility: Record<string, boolean>): Promise<void> => {
    try {
      await chrome.storage.local.set({
        [COLUMN_PREF_KEY]: visibility,
      })
    } catch (e) {
      console.error('Failed to save column preferences', e)
    }
  },
  500,
)
