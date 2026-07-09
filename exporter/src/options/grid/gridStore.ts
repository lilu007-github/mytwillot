import { produce, createStore } from 'solid-js/store'

import type { GridState, SortState } from './types'
import { DEFAULT_COLUMNS } from './types'
import type { StoredUser } from 'utils/db/users'

const initialColumnVisibility = (): Record<string, boolean> =>
  Object.fromEntries(DEFAULT_COLUMNS.map((col) => [col.key, true]))

export const defaultGridState = (): GridState => ({
  relationship: 'follower',
  keyword: '',
  page: 1,
  pageSize: 20,
  sort: null,
  selectedIds: [],
  columnVisibility: initialColumnVisibility(),
  users: [],
  totalCount: 0,
  isLoading: false,
  error: null,
})

const [gridState, setGridState] = createStore<GridState>(defaultGridState())

export { gridState }

export const setRelationship = (
  relationship: 'follower' | 'following',
) =>
  setGridState(
    produce((s) => {
      s.relationship = relationship
      s.page = 1
      s.selectedIds = []
    }),
  )

export const setKeyword = (keyword: string) =>
  setGridState(
    produce((s) => {
      s.keyword = keyword
      s.page = 1
    }),
  )

export const setPage = (page: number) =>
  setGridState(
    produce((s) => {
      s.page = page
      s.selectedIds = []
    }),
  )

export const setPageSize = (pageSize: number) =>
  setGridState(
    produce((s) => {
      s.pageSize = pageSize
      s.page = 1
    }),
  )

export const setSort = (sort: SortState | null) =>
  setGridState(
    produce((s) => {
      s.sort = sort
      s.page = 1
    }),
  )

export const setSelectedIds = (selectedIds: string[]) =>
  setGridState('selectedIds', selectedIds)

export const setColumnVisibility = (
  visibility: Record<string, boolean>,
) => setGridState('columnVisibility', visibility)

export const setUsers = (users: StoredUser[]) =>
  setGridState('users', users)

export const setTotalCount = (totalCount: number) =>
  setGridState('totalCount', totalCount)

export const setIsLoading = (isLoading: boolean) =>
  setGridState('isLoading', isLoading)

export const setError = (error: string | null) =>
  setGridState('error', error)

export const mutateGridStore = (fn: (state: GridState) => void) =>
  setGridState(produce(fn))
