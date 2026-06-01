import { createEffect, on } from 'solid-js'

import { findUsers, type StoredUser } from 'utils/db/users'
import {
  gridState,
  setUsers,
  setTotalCount,
  setIsLoading,
  setError,
  setPage,
} from './gridStore'
import { sortUsers } from './gridLogic'
import { folderState } from '~/stores/folders'

/**
 * Apply folder filtering to a list of users based on the active folder selection.
 * - null: no filter (show all)
 * - 'Unsorted': show users with no folder assigned
 * - folder name: show users assigned to that folder
 */
function filterByFolder(
  users: StoredUser[],
  activeFolder: string | null,
): StoredUser[] {
  if (activeFolder === null) return users
  if (activeFolder === 'Unsorted') {
    return users.filter((u) => !u.folder)
  }
  return users.filter((u) => u.folder === activeFolder)
}

function toStoredRelationship(relationship: 'followers' | 'following') {
  return relationship === 'followers' ? 'follower' : 'following'
}

export function useGridData(): void {
  // Reset pagination to page 1 when folder filter changes
  createEffect(
    on(
      () => folderState.activeFolder,
      () => {
        setPage(1)
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => [
        gridState.relationship,
        gridState.keyword,
        gridState.page,
        gridState.pageSize,
        gridState.sort,
        gridState.dataVersion,
        folderState.activeFolder,
      ],
      async () => {
        setIsLoading(true)
        setError(null)

        try {
          const allUsers = await findUsers(
            toStoredRelationship(gridState.relationship),
            gridState.keyword,
            Number.MAX_SAFE_INTEGER,
            0,
          )

          const filtered = filterByFolder(allUsers, folderState.activeFolder)
          const sorted = sortUsers(filtered, gridState.sort)
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
