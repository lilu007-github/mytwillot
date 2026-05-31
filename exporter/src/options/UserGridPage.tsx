import { createEffect, createMemo, on, onMount } from 'solid-js'

import { DEFAULT_COLUMNS } from './grid/types'
import {
  gridState,
  setRelationship,
  setKeyword,
  setPage,
  setPageSize,
  setSort,
  setSelectedIds,
  setColumnVisibility,
} from './grid/gridStore'
import { useGridData } from './grid/useGridData'
import {
  loadColumnPreferences,
  saveColumnPreferences,
} from './grid/columnStorage'
import {
  applyColumnToggle,
  computeTotalPages,
  getHeaderCheckboxState,
} from './grid/gridLogic'
import type { SortState } from './grid/types'

import RelationshipFilter from './grid/RelationshipFilter'
import SearchInput from './grid/SearchInput'
import ColumnConfig from './grid/ColumnConfig'
import BulkActionToolbar from './grid/BulkActionToolbar'
import UserGrid from './grid/UserGrid'
import PaginationControl from './grid/PaginationControl'
import MoveToFolderDialog from './grid/MoveToFolderDialog'

import { createSignal } from 'solid-js'

export default function UserGridPage() {
  const [moveDialogOpen, setMoveDialogOpen] = createSignal(false)

  onMount(async () => {
    const prefs = await loadColumnPreferences()
    setColumnVisibility(prefs)
  })

  useGridData()

  const totalPages = createMemo(() =>
    computeTotalPages(gridState.totalCount, gridState.pageSize),
  )

  const pageUserIds = createMemo(() =>
    gridState.users.map((u) => u.id),
  )

  const headerCheckboxState = createMemo(() =>
    getHeaderCheckboxState(pageUserIds(), gridState.selectedIds),
  )

  const selectedIdsSet = createMemo(() =>
    new Set(gridState.selectedIds),
  )

  // Persist column visibility changes
  createEffect(
    on(
      () => ({ ...gridState.columnVisibility }),
      (visibility) => {
        saveColumnPreferences(visibility)
      },
      { defer: true },
    ),
  )

  const handleRelationshipChange = (
    value: 'follower' | 'following',
  ) => {
    setRelationship(value)
  }

  const handleSearch = (keyword: string) => {
    setKeyword(keyword)
  }

  const handleColumnToggle = (columnKey: string) => {
    const updated = applyColumnToggle(
      gridState.columnVisibility,
      columnKey,
    )
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

  const handlePageChange = (page: number) => {
    setPage(page)
  }

  const handlePageSizeChange = (size: number) => {
    setPageSize(size)
  }

  const handleMoveToFolder = () => {
    setMoveDialogOpen(true)
  }

  const handleMoveComplete = (result: {
    succeeded: string[]
    failed: string[]
  }) => {
    if (result.failed.length === 0) {
      setSelectedIds([])
    } else {
      const failedSet = new Set(result.failed)
      setSelectedIds(
        gridState.selectedIds.filter((id) => failedSet.has(id)),
      )
    }
  }

  const handleUnfollowComplete = (failedIds: string[]) => {
    if (failedIds.length === 0) {
      setSelectedIds([])
    } else {
      const failedSet = new Set(failedIds)
      setSelectedIds(
        gridState.selectedIds.filter((id) => failedSet.has(id)),
      )
    }
  }

  return (
    <div class="mx-auto w-full max-w-7xl space-y-4 p-4">
      <div class="flex flex-wrap items-center gap-3">
        <RelationshipFilter
          value={gridState.relationship}
          onChange={handleRelationshipChange}
        />
        <SearchInput
          value={gridState.keyword}
          onSearch={handleSearch}
        />
        <div class="ml-auto">
          <ColumnConfig
            columns={DEFAULT_COLUMNS}
            visibility={gridState.columnVisibility}
            onToggle={handleColumnToggle}
          />
        </div>
      </div>

      <BulkActionToolbar
        selectedCount={gridState.selectedIds.length}
        selectedUserIds={gridState.selectedIds}
        onMoveToFolder={handleMoveToFolder}
        onUnfollowComplete={handleUnfollowComplete}
      />

      <UserGrid
        users={gridState.users}
        columns={DEFAULT_COLUMNS}
        visibility={gridState.columnVisibility}
        sort={gridState.sort}
        selectedIds={selectedIdsSet()}
        headerCheckboxState={headerCheckboxState()}
        isLoading={gridState.isLoading}
        error={gridState.error}
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
        onOpenChange={setMoveDialogOpen}
        selectedIds={gridState.selectedIds}
        onComplete={handleMoveComplete}
      />
    </div>
  )
}
