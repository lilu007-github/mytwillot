import { createEffect, on } from 'solid-js'

import { findUsers } from 'utils/db/users'
import {
  gridState,
  setUsers,
  setTotalCount,
  setIsLoading,
  setError,
} from './gridStore'
import { sortUsers } from './gridLogic'

export function useGridData(): void {
  createEffect(
    on(
      () => [
        gridState.relationship,
        gridState.keyword,
        gridState.page,
        gridState.pageSize,
        gridState.sort,
        gridState.dataVersion,
      ],
      async () => {
        setIsLoading(true)
        setError(null)

        try {
          const allUsers = await findUsers(
            gridState.relationship,
            gridState.keyword,
            Number.MAX_SAFE_INTEGER,
            0,
          )

          const sorted = sortUsers(allUsers, gridState.sort)
          const { page, pageSize } = gridState
          const start = (page - 1) * pageSize
          const pageSlice = sorted.slice(start, start + pageSize)

          setTotalCount(sorted.length)
          setUsers(pageSlice)
          setIsLoading(false)
        } catch (err) {
          const message =
            err instanceof Error ? err.message : 'Failed to load user data'
          setError(message)
          setIsLoading(false)
        }
      },
    ),
  )
}
