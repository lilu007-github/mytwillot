import { describe, it, expect, beforeEach } from 'vitest'
import fc from 'fast-check'
import 'webextension-polyfill'

import {
  filterByRelationship,
  filterByKeyword,
  truncateKeyword,
  sortUsers,
  computeTotalPages,
  navigatePage,
  computeResetPage,
  applyColumnToggle,
} from '../gridLogic'
import {
  loadColumnPreferences,
  saveColumnPreferences,
} from '../columnStorage'
import { COLUMN_PREF_KEY } from '../types'
import type { SortState } from '../types'
import { arbStoredUser, arbStoredUserList, arbRelationship } from './generators'

const NUM_RUNS = 100

/**
 * Arbitrary: generates a column visibility record with at least one true value.
 * Keys are random lowercase strings (1-10 chars), values are booleans,
 * with the constraint that at least one value is true.
 */
const columnVisibilityArb = fc
  .dictionary(
    fc.stringMatching(/^[a-z][a-z0-9_]{0,9}$/),
    fc.boolean(),
    { minKeys: 1, maxKeys: 10 },
  )
  .filter((obj) => Object.values(obj).some(Boolean))

/**
 * Arbitrary: generates a column visibility record where exactly one column is visible.
 */
const singleVisibleColumnArb = fc
  .array(
    fc.stringMatching(/^[a-z][a-z0-9_]{0,9}$/),
    { minLength: 1, maxLength: 10 },
  )
  .chain((keys) => {
    const uniqueKeys = [...new Set(keys)]
    if (uniqueKeys.length === 0) return fc.constant(null)
    return fc.nat({ max: uniqueKeys.length - 1 }).map((visibleIdx) => {
      const record: Record<string, boolean> = {}
      uniqueKeys.forEach((key, i) => {
        record[key] = i === visibleIdx
      })
      return record
    })
  })
  .filter((v): v is Record<string, boolean> => v !== null)

describe('Feature: user-grid-view', () => {
  describe('Property 1: Relationship filter produces only matching records', () => {
    /**
     * Validates: Requirements 1.1, 6.2
     */
    it('filtered output contains only users whose relationship matches the selected filter', () => {
      fc.assert(
        fc.property(
          arbStoredUserList(0, 100),
          arbRelationship,
          (users, relationship) => {
            const result = filterByRelationship(users, relationship)

            // All results must match the filter
            for (const user of result) {
              expect(user.relationship).toBe(relationship)
            }

            // Count must equal the number of matching records in input
            const expectedCount = users.filter(
              (u) => u.relationship === relationship,
            ).length
            expect(result.length).toBe(expectedCount)
          },
        ),
        { numRuns: NUM_RUNS },
      )
    })
  })

  describe('Property 5: Pagination math is correct', () => {
    /**
     * Validates: Requirements 3.1
     */
    it('computeTotalPages equals Math.ceil(totalCount / pageSize)', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100_000 }),
          fc.integer({ min: 1, max: 1000 }),
          (totalCount, pageSize) => {
            const result = computeTotalPages(totalCount, pageSize)
            expect(result).toBe(Math.ceil(totalCount / pageSize))
          },
        ),
        { numRuns: NUM_RUNS },
      )
    })

    it('returns at least 1 for any positive totalCount and pageSize', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 100_000 }),
          fc.integer({ min: 1, max: 1000 }),
          (totalCount, pageSize) => {
            const result = computeTotalPages(totalCount, pageSize)
            expect(result).toBeGreaterThanOrEqual(1)
          },
        ),
        { numRuns: NUM_RUNS },
      )
    })
  })

  describe('Property 6: Page navigation stays within valid bounds', () => {
    /**
     * Validates: Requirements 3.2, 3.3, 3.4, 3.5
     */
    it('navigating forward from currentPage < totalPages increments by 1', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2, max: 1000 }).chain((total) =>
            fc.tuple(
              fc.integer({ min: 1, max: total - 1 }),
              fc.constant(total),
            ),
          ),
          ([current, total]) => {
            const result = navigatePage(current, total, 'next')
            expect(result).toBe(current + 1)
          },
        ),
        { numRuns: NUM_RUNS },
      )
    })

    it('navigating backward from currentPage > 1 decrements by 1', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2, max: 1000 }).chain((total) =>
            fc.tuple(
              fc.integer({ min: 2, max: total }),
              fc.constant(total),
            ),
          ),
          ([current, total]) => {
            const result = navigatePage(current, total, 'prev')
            expect(result).toBe(current - 1)
          },
        ),
        { numRuns: NUM_RUNS },
      )
    })

    it('navigation is a no-op at the last page for next', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 1000 }),
          (total) => {
            const result = navigatePage(total, total, 'next')
            expect(result).toBe(total)
          },
        ),
        { numRuns: NUM_RUNS },
      )
    })

    it('navigation is a no-op at page 1 for prev', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 1000 }),
          (total) => {
            const result = navigatePage(1, total, 'prev')
            expect(result).toBe(1)
          },
        ),
        { numRuns: NUM_RUNS },
      )
    })
  })

  describe('Property 7: State changes reset pagination to page one', () => {
    /**
     * Validates: Requirements 3.7, 4.6, 6.4, 7.3
     */
    it('returns 1 when stateChanged is true', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 1000 }),
          (currentPage) => {
            const result = computeResetPage(true, currentPage)
            expect(result).toBe(1)
          },
        ),
        { numRuns: NUM_RUNS },
      )
    })

    it('returns currentPage when stateChanged is false', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 1000 }),
          (currentPage) => {
            const result = computeResetPage(false, currentPage)
            expect(result).toBe(currentPage)
          },
        ),
        { numRuns: NUM_RUNS },
      )
    })
  })

  describe('Property 8: Sort produces correctly ordered output', () => {
    /**
     * Validates: Requirements 4.1, 4.2, 4.7
     */
    it('ascending sort on numeric columns produces non-decreasing order', () => {
      const numericColumns = ['followers_count', 'friends_count', 'statuses_count']

      fc.assert(
        fc.property(
          arbStoredUserList(2, 50),
          fc.constantFrom(...numericColumns),
          (users, column) => {
            const sort: SortState = { column, direction: 'asc' }
            const sorted = sortUsers(users, sort)

            for (let i = 1; i < sorted.length; i++) {
              const prev = (sorted[i - 1] as unknown as Record<string, number>)[column]
              const curr = (sorted[i] as unknown as Record<string, number>)[column]
              expect(prev).toBeLessThanOrEqual(curr)
            }
          },
        ),
        { numRuns: NUM_RUNS },
      )
    })

    it('descending sort on numeric columns produces non-increasing order', () => {
      const numericColumns = ['followers_count', 'friends_count', 'statuses_count']

      fc.assert(
        fc.property(
          arbStoredUserList(2, 50),
          fc.constantFrom(...numericColumns),
          (users, column) => {
            const sort: SortState = { column, direction: 'desc' }
            const sorted = sortUsers(users, sort)

            for (let i = 1; i < sorted.length; i++) {
              const prev = (sorted[i - 1] as unknown as Record<string, number>)[column]
              const curr = (sorted[i] as unknown as Record<string, number>)[column]
              expect(prev).toBeGreaterThanOrEqual(curr)
            }
          },
        ),
        { numRuns: NUM_RUNS },
      )
    })

    it('ascending sort on text columns produces lexicographic order (case-insensitive)', () => {
      const textColumns = ['name', 'screen_name', 'location']

      fc.assert(
        fc.property(
          arbStoredUserList(2, 50),
          fc.constantFrom(...textColumns),
          (users, column) => {
            const sort: SortState = { column, direction: 'asc' }
            const sorted = sortUsers(users, sort)

            for (let i = 1; i < sorted.length; i++) {
              const prev = String(
                (sorted[i - 1] as unknown as Record<string, string>)[column],
              ).toLowerCase()
              const curr = String(
                (sorted[i] as unknown as Record<string, string>)[column],
              ).toLowerCase()
              expect(prev.localeCompare(curr)).toBeLessThanOrEqual(0)
            }
          },
        ),
        { numRuns: NUM_RUNS },
      )
    })

    it('descending sort on text columns produces reverse lexicographic order', () => {
      const textColumns = ['name', 'screen_name', 'location']

      fc.assert(
        fc.property(
          arbStoredUserList(2, 50),
          fc.constantFrom(...textColumns),
          (users, column) => {
            const sort: SortState = { column, direction: 'desc' }
            const sorted = sortUsers(users, sort)

            for (let i = 1; i < sorted.length; i++) {
              const prev = String(
                (sorted[i - 1] as unknown as Record<string, string>)[column],
              ).toLowerCase()
              const curr = String(
                (sorted[i] as unknown as Record<string, string>)[column],
              ).toLowerCase()
              expect(prev.localeCompare(curr)).toBeGreaterThanOrEqual(0)
            }
          },
        ),
        { numRuns: NUM_RUNS },
      )
    })

    it('ascending sort on date column produces chronological order', () => {
      fc.assert(
        fc.property(
          arbStoredUserList(2, 50),
          (users) => {
            const sort: SortState = { column: 'created_at', direction: 'asc' }
            const sorted = sortUsers(users, sort)

            for (let i = 1; i < sorted.length; i++) {
              const prev = new Date(sorted[i - 1].created_at).getTime()
              const curr = new Date(sorted[i].created_at).getTime()
              expect(prev).toBeLessThanOrEqual(curr)
            }
          },
        ),
        { numRuns: NUM_RUNS },
      )
    })

    it('descending sort on date column produces reverse chronological order', () => {
      fc.assert(
        fc.property(
          arbStoredUserList(2, 50),
          (users) => {
            const sort: SortState = { column: 'created_at', direction: 'desc' }
            const sorted = sortUsers(users, sort)

            for (let i = 1; i < sorted.length; i++) {
              const prev = new Date(sorted[i - 1].created_at).getTime()
              const curr = new Date(sorted[i].created_at).getTime()
              expect(prev).toBeGreaterThanOrEqual(curr)
            }
          },
        ),
        { numRuns: NUM_RUNS },
      )
    })
  })

  describe('Property 9: Non-sortable columns do not change sort state', () => {
    /**
     * Validates: Requirements 4.8
     */
    it('sorting on non-sortable columns returns elements in original order', () => {
      const nonSortableColumns = ['avatar', 'is_blue_verified', 'description']

      fc.assert(
        fc.property(
          arbStoredUserList(2, 50),
          fc.constantFrom(...nonSortableColumns),
          fc.constantFrom('asc' as const, 'desc' as const),
          (users, column, direction) => {
            const sort: SortState = { column, direction }
            const sorted = sortUsers(users, sort)

            // Since comparison returns 0 for non-sortable columns,
            // the sort is stable and preserves original order
            for (let i = 0; i < users.length; i++) {
              expect(sorted[i].id).toBe(users[i].id)
            }
          },
        ),
        { numRuns: NUM_RUNS },
      )
    })
  })

  describe('Property 13: Search results all contain keyword', () => {
    /**
     * Validates: Requirements 7.1
     */
    it('every user in filtered results contains the keyword in name, screen_name, or description', () => {
      fc.assert(
        fc.property(
          arbStoredUserList(1, 50),
          fc.string({ minLength: 1, maxLength: 20 }).filter(
            (s) => s.trim().length > 0,
          ),
          (users, keyword) => {
            const result = filterByKeyword(users, keyword)
            const lower = keyword.trim().toLowerCase()

            for (const user of result) {
              const matches =
                user.name.toLowerCase().includes(lower) ||
                user.screen_name.toLowerCase().includes(lower) ||
                user.description.toLowerCase().includes(lower)
              expect(matches).toBe(true)
            }
          },
        ),
        { numRuns: NUM_RUNS },
      )
    })

    it('no user outside the results matches the keyword', () => {
      fc.assert(
        fc.property(
          arbStoredUserList(1, 50),
          fc.string({ minLength: 1, maxLength: 20 }).filter(
            (s) => s.trim().length > 0,
          ),
          (users, keyword) => {
            const result = filterByKeyword(users, keyword)
            const resultIds = new Set(result.map((u) => u.id))
            const lower = keyword.trim().toLowerCase()

            for (const user of users) {
              if (resultIds.has(user.id)) continue
              const matches =
                user.name.toLowerCase().includes(lower) ||
                user.screen_name.toLowerCase().includes(lower) ||
                user.description.toLowerCase().includes(lower)
              expect(matches).toBe(false)
            }
          },
        ),
        { numRuns: NUM_RUNS },
      )
    })
  })

  describe('Property 14: Whitespace-only search equals no search', () => {
    /**
     * Validates: Requirements 7.2
     */
    it('whitespace-only keyword returns all users', () => {
      fc.assert(
        fc.property(
          arbStoredUserList(0, 50),
          fc.stringMatching(/^[\s]{0,20}$/),
          (users, whitespace) => {
            const result = filterByKeyword(users, whitespace)
            expect(result.length).toBe(users.length)
            expect(result).toEqual(users)
          },
        ),
        { numRuns: NUM_RUNS },
      )
    })
  })

  describe('Property 15: Keyword truncation to 100 characters', () => {
    /**
     * Validates: Requirements 7.5
     */
    it('returns first 100 chars for strings longer than 100', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 101, maxLength: 500 }),
          (input) => {
            const result = truncateKeyword(input)
            expect(result.length).toBe(100)
            expect(result).toBe(input.slice(0, 100))
          },
        ),
        { numRuns: NUM_RUNS },
      )
    })

    it('returns the full string for strings of 100 chars or fewer', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 100 }),
          (input) => {
            const result = truncateKeyword(input)
            expect(result).toBe(input)
          },
        ),
        { numRuns: NUM_RUNS },
      )
    })
  })
})

describe('Feature: user-grid-view, Property 2: Column toggle changes visibility correctly', () => {
  /**
   * Validates: Requirements 2.2, 2.3
   */
  it('toggling a column flips its visibility when min-one-visible is not violated', () => {
    fc.assert(
      fc.property(
        columnVisibilityArb,
        fc.nat(),
        (visibility, keyIdx) => {
          const keys = Object.keys(visibility)
          const key = keys[keyIdx % keys.length]
          const originalValue = visibility[key]
          const visibleCount = Object.values(visibility).filter(Boolean).length

          const result = applyColumnToggle(visibility, key)

          // If the column is currently visible and it's the only one,
          // the toggle should be a no-op (covered by Property 3)
          if (originalValue && visibleCount <= 1) {
            expect(result).toEqual(visibility)
          } else {
            // Otherwise, the visibility should be flipped
            expect(result[key]).toBe(!originalValue)
          }
        },
      ),
      { numRuns: NUM_RUNS },
    )
  })

  it('toggling preserves all other column visibilities', () => {
    fc.assert(
      fc.property(
        columnVisibilityArb,
        fc.nat(),
        (visibility, keyIdx) => {
          const keys = Object.keys(visibility)
          const key = keys[keyIdx % keys.length]

          const result = applyColumnToggle(visibility, key)

          // All other keys should remain unchanged
          for (const k of keys) {
            if (k !== key) {
              expect(result[k]).toBe(visibility[k])
            }
          }
        },
      ),
      { numRuns: NUM_RUNS },
    )
  })
})

describe('Feature: user-grid-view, Property 3: Minimum one visible column invariant', () => {
  /**
   * Validates: Requirements 2.7
   */
  it('attempting to hide the last visible column leaves state unchanged', () => {
    fc.assert(
      fc.property(
        singleVisibleColumnArb,
        (visibility) => {
          const visibleKey = Object.entries(visibility).find(
            ([, v]) => v,
          )![0]

          const result = applyColumnToggle(visibility, visibleKey)

          // State should be unchanged — the last visible column cannot be hidden
          expect(result).toEqual(visibility)
        },
      ),
      { numRuns: NUM_RUNS },
    )
  })

  it('result always has at least one visible column after any toggle', () => {
    fc.assert(
      fc.property(
        columnVisibilityArb,
        fc.nat(),
        (visibility, keyIdx) => {
          const keys = Object.keys(visibility)
          const key = keys[keyIdx % keys.length]

          const result = applyColumnToggle(visibility, key)

          const visibleCount = Object.values(result).filter(Boolean).length
          expect(visibleCount).toBeGreaterThanOrEqual(1)
        },
      ),
      { numRuns: NUM_RUNS },
    )
  })
})

describe('Feature: user-grid-view, Property 4: Column preference round-trip', () => {
  beforeEach(async () => {
    await chrome.storage.local.clear()
    saveColumnPreferences.cancel()
  })

  /**
   * Validates: Requirements 2.4, 2.5
   */
  it('persisting and loading column preferences produces identical object', async () => {
    await fc.assert(
      fc.asyncProperty(
        columnVisibilityArb,
        async (visibility) => {
          // Clear storage before each iteration
          await chrome.storage.local.clear()

          // Save directly to storage (bypass debounce for testing)
          await chrome.storage.local.set({
            [COLUMN_PREF_KEY]: visibility,
          })

          // Load back
          const loaded = await loadColumnPreferences()

          expect(loaded).toEqual(visibility)
        },
      ),
      { numRuns: NUM_RUNS },
    )
  })

  it('round-trip via saveColumnPreferences and loadColumnPreferences', async () => {
    await fc.assert(
      fc.asyncProperty(
        columnVisibilityArb,
        async (visibility) => {
          // Clear storage before each iteration
          await chrome.storage.local.clear()

          // Save using the actual function (flush debounce)
          saveColumnPreferences(visibility)
          saveColumnPreferences.flush()

          // Small wait for async storage write
          await new Promise((resolve) => setTimeout(resolve, 10))

          // Load back
          const loaded = await loadColumnPreferences()

          expect(loaded).toEqual(visibility)
        },
      ),
      { numRuns: NUM_RUNS },
    )
  })
})
