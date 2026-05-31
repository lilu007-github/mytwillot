import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

import { resolveSelectionAfterBulkAction } from '../gridLogic'

const NUM_RUNS = 100

/**
 * Arbitrary: generates a non-empty array of unique string IDs (simulating selected user IDs).
 */
const arbSelectedIds = fc
  .array(fc.uuid(), { minLength: 1, maxLength: 50 })
  .map((ids) => [...new Set(ids)])
  .filter((ids) => ids.length > 0)

describe('Feature: user-grid-view, Property 16: Partial bulk action failure preserves failed selections', () => {
  /**
   * Validates: Requirements 5.10
   */
  it('when all succeed (failedIds is empty), selection should be empty', () => {
    fc.assert(
      fc.property(arbSelectedIds, (selectedIds) => {
        const result = resolveSelectionAfterBulkAction(selectedIds, [])
        expect(result).toEqual([])
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it('when all fail (failedIds equals selectedIds), selection should equal selectedIds', () => {
    fc.assert(
      fc.property(arbSelectedIds, (selectedIds) => {
        const result = resolveSelectionAfterBulkAction(
          selectedIds,
          selectedIds,
        )
        expect(result).toEqual(selectedIds)
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it('when some fail, selection should contain exactly the failed IDs', () => {
    fc.assert(
      fc.property(
        arbSelectedIds.filter((ids) => ids.length >= 2),
        fc.nat(),
        (selectedIds, splitSeed) => {
          // Split selectedIds into succeeded and failed subsets
          const splitPoint = (splitSeed % (selectedIds.length - 1)) + 1
          const failedIds = selectedIds.slice(splitPoint)

          const result = resolveSelectionAfterBulkAction(
            selectedIds,
            failedIds,
          )

          expect(result).toEqual(failedIds)
        },
      ),
      { numRuns: NUM_RUNS },
    )
  })

  it('failed IDs should always be a subset of the original selectedIds', () => {
    fc.assert(
      fc.property(
        arbSelectedIds,
        fc.array(fc.uuid(), { minLength: 0, maxLength: 30 }),
        (selectedIds, randomFailedIds) => {
          // Mix some IDs from selectedIds with some random IDs not in selectedIds
          const uniqueRandom = [...new Set(randomFailedIds)]
          const failedIds = [
            ...selectedIds.slice(0, Math.ceil(selectedIds.length / 2)),
            ...uniqueRandom,
          ]

          const result = resolveSelectionAfterBulkAction(
            selectedIds,
            failedIds,
          )

          // Result should only contain IDs that are in both selectedIds and failedIds
          const selectedSet = new Set(selectedIds)
          for (const id of result) {
            expect(selectedSet.has(id)).toBe(true)
          }
        },
      ),
      { numRuns: NUM_RUNS },
    )
  })
})
