import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

import {
  getHeaderCheckboxState,
  shouldToolbarBeVisible,
  getSelectedCount,
  clearSelectionOnChange,
} from '../gridLogic'

const NUM_RUNS = 100

/**
 * Arbitrary: generates a non-empty array of unique string IDs (simulating page row IDs).
 */
const arbPageIds = fc.array(fc.uuid(), { minLength: 1, maxLength: 50 }).map(
  (ids) => [...new Set(ids)],
).filter((ids) => ids.length > 0)

/**
 * Arbitrary: generates a (possibly empty) array of unique string IDs (simulating selected IDs).
 */
const arbSelectedIds = fc.array(fc.uuid(), { minLength: 0, maxLength: 100 }).map(
  (ids) => [...new Set(ids)],
)

/**
 * Arbitrary: generates a non-empty array of unique string IDs for selection.
 */
const arbNonEmptySelectedIds = fc.array(fc.uuid(), { minLength: 1, maxLength: 100 }).map(
  (ids) => [...new Set(ids)],
).filter((ids) => ids.length > 0)

describe('Feature: user-grid-view, Property 10: Toolbar visibility and count reflect selection state', () => {
  /**
   * Validates: Requirements 5.2, 5.3, 5.6, 5.7
   */
  it('toolbar is visible if and only if selectedIds is non-empty', () => {
    fc.assert(
      fc.property(
        arbSelectedIds,
        (selectedIds) => {
          const visible = shouldToolbarBeVisible(selectedIds)
          expect(visible).toBe(selectedIds.length > 0)
        },
      ),
      { numRuns: NUM_RUNS },
    )
  })

  it('displayed count equals the size of the selected set', () => {
    fc.assert(
      fc.property(
        arbSelectedIds,
        (selectedIds) => {
          const count = getSelectedCount(selectedIds)
          expect(count).toBe(selectedIds.length)
        },
      ),
      { numRuns: NUM_RUNS },
    )
  })

  it('toolbar is hidden when selectedIds is empty', () => {
    const visible = shouldToolbarBeVisible([])
    expect(visible).toBe(false)
  })

  it('toolbar is visible for any non-empty selection', () => {
    fc.assert(
      fc.property(
        arbNonEmptySelectedIds,
        (selectedIds) => {
          const visible = shouldToolbarBeVisible(selectedIds)
          expect(visible).toBe(true)
        },
      ),
      { numRuns: NUM_RUNS },
    )
  })
})

describe('Feature: user-grid-view, Property 11: Header checkbox state matches selection', () => {
  /**
   * Validates: Requirements 5.2
   */
  it('header checkbox is checked when all page IDs are selected', () => {
    fc.assert(
      fc.property(
        arbPageIds,
        (pageIds) => {
          // All page IDs are in selectedIds
          const result = getHeaderCheckboxState(pageIds, pageIds)
          expect(result).toBe('checked')
        },
      ),
      { numRuns: NUM_RUNS },
    )
  })

  it('header checkbox is unchecked when no page IDs are selected', () => {
    fc.assert(
      fc.property(
        arbPageIds,
        arbSelectedIds,
        (pageIds, otherIds) => {
          // Ensure none of the selected IDs are in pageIds
          const disjointSelected = otherIds.filter(
            (id) => !pageIds.includes(id),
          )
          const result = getHeaderCheckboxState(pageIds, disjointSelected)
          expect(result).toBe('unchecked')
        },
      ),
      { numRuns: NUM_RUNS },
    )
  })

  it('header checkbox is indeterminate when some but not all page IDs are selected', () => {
    fc.assert(
      fc.property(
        arbPageIds.filter((ids) => ids.length >= 2),
        fc.nat(),
        (pageIds, splitIdx) => {
          // Select a non-empty proper subset of page IDs
          const splitPoint = (splitIdx % (pageIds.length - 1)) + 1
          const subset = pageIds.slice(0, splitPoint)

          const result = getHeaderCheckboxState(pageIds, subset)
          expect(result).toBe('indeterminate')
        },
      ),
      { numRuns: NUM_RUNS },
    )
  })

  it('header checkbox is unchecked when pageIds is empty', () => {
    fc.assert(
      fc.property(
        arbSelectedIds,
        (selectedIds) => {
          const result = getHeaderCheckboxState([], selectedIds)
          expect(result).toBe('unchecked')
        },
      ),
      { numRuns: NUM_RUNS },
    )
  })

  it('header checkbox state is correct for any subset of page IDs', () => {
    fc.assert(
      fc.property(
        arbPageIds,
        fc.nat(),
        (pageIds, subsetSize) => {
          const n = pageIds.length
          const s = subsetSize % (n + 1) // 0 to n inclusive
          const selectedSubset = pageIds.slice(0, s)

          const result = getHeaderCheckboxState(pageIds, selectedSubset)

          if (s === n) {
            expect(result).toBe('checked')
          } else if (s === 0) {
            expect(result).toBe('unchecked')
          } else {
            expect(result).toBe('indeterminate')
          }
        },
      ),
      { numRuns: NUM_RUNS },
    )
  })
})

describe('Feature: user-grid-view, Property 12: Navigation and filter changes clear selection', () => {
  /**
   * Validates: Requirements 5.8, 6.6
   */
  it('changing page clears selectedIds (stateChanged=true produces empty array)', () => {
    fc.assert(
      fc.property(
        arbNonEmptySelectedIds,
        (selectedIds) => {
          const result = clearSelectionOnChange(selectedIds, true)
          expect(result).toEqual([])
        },
      ),
      { numRuns: NUM_RUNS },
    )
  })

  it('changing relationship filter clears selectedIds (stateChanged=true produces empty array)', () => {
    fc.assert(
      fc.property(
        arbNonEmptySelectedIds,
        (selectedIds) => {
          const result = clearSelectionOnChange(selectedIds, true)
          expect(result).toEqual([])
          expect(result.length).toBe(0)
        },
      ),
      { numRuns: NUM_RUNS },
    )
  })

  it('no state change preserves selectedIds', () => {
    fc.assert(
      fc.property(
        arbSelectedIds,
        (selectedIds) => {
          const result = clearSelectionOnChange(selectedIds, false)
          expect(result).toEqual(selectedIds)
        },
      ),
      { numRuns: NUM_RUNS },
    )
  })

  it('clearing always produces an empty array regardless of initial selection size', () => {
    fc.assert(
      fc.property(
        fc.array(fc.uuid(), { minLength: 1, maxLength: 200 }).map(
          (ids) => [...new Set(ids)],
        ).filter((ids) => ids.length > 0),
        (selectedIds) => {
          const result = clearSelectionOnChange(selectedIds, true)
          expect(result).toEqual([])
          expect(result.length).toBe(0)
        },
      ),
      { numRuns: NUM_RUNS },
    )
  })
})
