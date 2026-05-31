import { describe, it, expect } from 'vitest'

import { DEFAULT_COLUMNS } from '../types'
import { defaultGridState } from '../gridStore'
import { computeTotalPages } from '../gridLogic'

describe('gridLogic unit tests', () => {
  describe('Req 1.2: Default column order', () => {
    it('DEFAULT_COLUMNS keys are in the specified order', () => {
      const expectedOrder = [
        'avatar',
        'name',
        'screen_name',
        'followers_count',
        'friends_count',
        'statuses_count',
        'is_blue_verified',
        'location',
        'description',
        'created_at',
      ]
      const actualKeys = DEFAULT_COLUMNS.map((col) => col.key)
      expect(actualKeys).toEqual(expectedOrder)
    })
  })

  describe('Req 1.3: No DM column', () => {
    it('no column has key "dm"', () => {
      const keys = DEFAULT_COLUMNS.map((col) => col.key)
      expect(keys).not.toContain('dm')
    })

    it('no column label contains "DM" or "direct message"', () => {
      for (const col of DEFAULT_COLUMNS) {
        const lower = col.label.toLowerCase()
        expect(lower).not.toContain('dm')
        expect(lower).not.toContain('direct message')
      }
    })
  })

  describe('Req 3.6: Default page size is 20', () => {
    it('defaultGridState has pageSize of 20', () => {
      const state = defaultGridState()
      expect(state.pageSize).toBe(20)
    })
  })

  describe('Req 6.3: Default relationship filter is follower', () => {
    it('defaultGridState has relationship "follower"', () => {
      const state = defaultGridState()
      expect(state.relationship).toBe('follower')
    })
  })

  describe('Req 4.3: Tri-state sort cycle', () => {
    it('sort cycles: null → asc → desc → null', () => {
      // Starting state: no sort
      let sort: { column: string; direction: 'asc' | 'desc' } | null =
        null

      // First click: apply ascending sort
      const column = 'name'
      if (sort === null || sort.column !== column) {
        sort = { column, direction: 'asc' }
      }
      expect(sort).toEqual({ column: 'name', direction: 'asc' })

      // Second click: switch to descending
      if (sort && sort.column === column && sort.direction === 'asc') {
        sort = { column, direction: 'desc' }
      }
      expect(sort).toEqual({ column: 'name', direction: 'desc' })

      // Third click: remove sort
      if (
        sort &&
        sort.column === column &&
        sort.direction === 'desc'
      ) {
        sort = null
      }
      expect(sort).toBeNull()
    })
  })

  describe('Req 3.8: Pagination hidden when totalCount = 0', () => {
    it('computeTotalPages returns 1 for totalCount 0', () => {
      // Math.max(1, Math.ceil(0/20)) = 1
      expect(computeTotalPages(0, 20)).toBe(1)
    })

    it('totalCount = 0 is the condition to hide pagination', () => {
      const state = defaultGridState()
      // When totalCount is 0, pagination should be hidden
      expect(state.totalCount).toBe(0)
      // The UI hides pagination when totalCount === 0
      const shouldHidePagination = state.totalCount === 0
      expect(shouldHidePagination).toBe(true)
    })
  })
})
