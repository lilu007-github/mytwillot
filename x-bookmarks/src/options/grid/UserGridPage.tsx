import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js'

import { countUsers } from 'utils/db/users'
import { StorageKeys } from 'utils/storage'

import Spinner from '~/components/Spinner'
import { DEFAULT_COLUMNS, type Relationship, type SortState } from './types'
import {
  gridState,
  refreshData,
  setColumnVisibility,
  setKeyword,
  setPage,
  setPageSize,
  setRelationship,
  setSelectedIds,
  setSort,
} from './gridStore'
import { useGridData } from './useGridData'
import {
  loadColumnPreferences,
  saveColumnPreferences,
} from './columnStorage'
import {
  applyColumnToggle,
  computeTotalPages,
  getHeaderCheckboxState,
} from './gridLogic'
import { syncUsers } from './syncUsers'

import RelationshipFilter from './RelationshipFilter'
import SearchInput from './SearchInput'
import ColumnConfig from './ColumnConfig'
import BulkActionToolbar from './BulkActionToolbar'
import UserGrid from './UserGrid'
import PaginationControl from './PaginationControl'
import MoveToFolderDialog from './MoveToFolderDialog'
import UnfollowDialog from './UnfollowDialog'

export default function UserGridPage() {
  const [moveDialogOpen, setMoveDialogOpen] = createSignal(false)
  const [unfollowDialogOpen, setUnfollowDialogOpen] = createSignal(false)
  const [counts, setCounts] = createSignal({ followers: 0, following: 0 })
  const [isSyncing, setIsSyncing] = createSignal(false)
  const [syncProgress, setSyncProgress] = createSignal(0)

  async function refreshCounts() {
    try {
      const c = await countUsers()
      setCounts(c)
    } catch (err) {
      console.error('Failed to count users', err)
    }
  }

  onMount(async () => {
    const prefs = await loadColumnPreferences()
    setColumnVisibility(prefs)
    await refreshCounts()

    // Re-query when the active account changes or X page captures users.
    const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (
        StorageKeys.Current_UID in changes ||
        StorageKeys.Captured_Users_Updated in changes
      ) {
        refreshCounts()
        refreshData()
      }
    }
    chrome.storage.local.onChanged.addListener(onStorageChanged)
    onCleanup(() => chrome.storage.local.onChanged.removeListener(onStorageChanged))
  })

  useGridData()

  const totalPages = createMemo(() =>
    computeTotalPages(gridState.totalCount, gridState.pageSize),
  )

  const pageUserIds = createMemo(() => gridState.users.map((u) => u.id))

  const headerCheckboxState = createMemo(() =>
    getHeaderCheckboxState(pageUserIds(), gridState.selectedIds),
  )

  const selectedIdsSet = createMemo(() => new Set(gridState.selectedIds))

  const selectedUsers = createMemo(() => {
    const sel = selectedIdsSet()
    return gridState.users.filter((u) => sel.has(u.id))
  })

  const emptyMessage = createMemo(() => {
    if (gridState.keyword.trim()) return 'No users match your search.'
    const count = counts()[gridState.relationship]
    if (count === 0) {
      return `No ${gridState.relationship} yet. Click "Sync ${
        gridState.relationship === 'followers' ? 'Followers' : 'Following'
      }" to start syncing.`
    }
    return 'No results found.'
  })

  // Persist column visibility changes (deferred so the initial load doesn't write)
  createEffect(
    on(
      () => ({ ...gridState.columnVisibility }),
      (visibility) => {
        saveColumnPreferences(visibility)
      },
      { defer: true },
    ),
  )

  const handleRelationshipChange = (value: Relationship) => {
    setRelationship(value)
  }

  const handleSearch = (keyword: string) => {
    setKeyword(keyword)
  }

  const handleColumnToggle = (columnKey: string) => {
    const updated = applyColumnToggle(gridState.columnVisibility, columnKey)
    setColumnVisibility(updated)
  }

  const handleSort = (columnKey: string) => {
    const current = gridState.sort
    let next: SortState | null

    if (!current || current.column !== columnKey) {
      next = { column: columnKey, direction: 'asc' }
    } else if (current.direction === 'asc') {
      next = { column: columnKey, direction: 'desc' }
    } else {
      next = null
    }

    setSort(next)
  }

  const handleSelectRow = (id: string) => {
    const current = gridState.selectedIds
    if (current.includes(id)) {
      setSelectedIds(current.filter((sid) => sid !== id))
    } else {
      setSelectedIds([...current, id])
    }
  }

  const handleSelectAll = () => {
    const state = headerCheckboxState()
    if (state === 'checked') {
      setSelectedIds([])
    } else {
      setSelectedIds(pageUserIds())
    }
  }

  const handlePageChange = (page: number) => setPage(page)
  const handlePageSizeChange = (size: number) => setPageSize(size)

  const handleMoveComplete = (result: {
    succeeded: string[]
    failed: string[]
  }) => {
    if (result.failed.length === 0) {
      setSelectedIds([])
    } else {
      const failedSet = new Set(result.failed)
      setSelectedIds(gridState.selectedIds.filter((id) => failedSet.has(id)))
    }
    refreshData()
  }

  const handleUnfollowComplete = async (failedIds: string[]) => {
    if (failedIds.length === 0) {
      setSelectedIds([])
    } else {
      const failedSet = new Set(failedIds)
      setSelectedIds(gridState.selectedIds.filter((id) => failedSet.has(id)))
    }
    await refreshCounts()
    refreshData()
  }

  const handleSync = async () => {
    setIsSyncing(true)
    setSyncProgress(0)
    await syncUsers(gridState.relationship, (total) => setSyncProgress(total))
    setIsSyncing(false)
    await refreshCounts()
    refreshData()
  }

  return (
    <div class="mx-auto my-4 w-full flex-1 px-3 text-base text-gray-700 dark:text-white">
      <div class="mb-6 flex items-center justify-between">
        <h2 class="text-xl font-bold">Users</h2>
        <div class="flex items-center gap-3">
          <Show when={isSyncing()}>
            <span class="flex items-center gap-2 text-sm text-gray-500">
              <Spinner className="h-4 w-4 fill-blue-500 text-gray-200" />
              Synced {syncProgress()} users...
            </span>
          </Show>
          <button
            type="button"
            class="rounded-lg bg-blue-500 px-4 py-2 text-sm text-white hover:bg-blue-600 disabled:opacity-50"
            disabled={isSyncing()}
            onClick={handleSync}
          >
            Sync{' '}
            {gridState.relationship === 'followers' ? 'Followers' : 'Following'}
          </button>
        </div>
      </div>

      <div class="mb-4 flex items-end justify-between gap-3">
        <RelationshipFilter
          value={gridState.relationship}
          followingCount={counts().following}
          followersCount={counts().followers}
          onChange={handleRelationshipChange}
        />
        <ColumnConfig
          columns={DEFAULT_COLUMNS}
          visibility={gridState.columnVisibility}
          onToggle={handleColumnToggle}
        />
      </div>

      <div class="mb-4">
        <SearchInput value={gridState.keyword} onSearch={handleSearch} />
      </div>

      <div class="mb-3">
        <BulkActionToolbar
          selectedCount={gridState.selectedIds.length}
          onMoveToFolder={() => setMoveDialogOpen(true)}
          onUnfollow={() => setUnfollowDialogOpen(true)}
        />
      </div>

      <UserGrid
        users={gridState.users}
        columns={DEFAULT_COLUMNS}
        visibility={gridState.columnVisibility}
        sort={gridState.sort}
        selectedIds={selectedIdsSet()}
        headerCheckboxState={headerCheckboxState()}
        isLoading={gridState.isLoading}
        error={gridState.error}
        emptyMessage={emptyMessage()}
        onSort={handleSort}
        onSelectRow={handleSelectRow}
        onSelectAll={handleSelectAll}
      />

      <PaginationControl
        currentPage={gridState.page}
        totalPages={totalPages()}
        totalCount={gridState.totalCount}
        pageSize={gridState.pageSize}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
      />

      <MoveToFolderDialog
        open={moveDialogOpen()}
        selectedIds={gridState.selectedIds}
        onOpenChange={setMoveDialogOpen}
        onComplete={handleMoveComplete}
      />

      <UnfollowDialog
        open={unfollowDialogOpen()}
        selectedUsers={selectedUsers()}
        onOpenChange={setUnfollowDialogOpen}
        onComplete={handleUnfollowComplete}
      />
    </div>
  )
}
