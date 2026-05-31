import type { StoredUser } from 'utils/db/users'
import type { Relationship, SortState } from './types'

export function filterByRelationship(
  users: StoredUser[],
  relationship: Relationship,
): StoredUser[] {
  return users.filter((u) => u.relationship === relationship)
}

export function filterByKeyword(
  users: StoredUser[],
  keyword: string,
): StoredUser[] {
  const trimmed = keyword.trim()
  if (!trimmed) return users
  const lower = trimmed.toLowerCase()
  return users.filter(
    (u) =>
      u.name.toLowerCase().includes(lower) ||
      u.screen_name.toLowerCase().includes(lower) ||
      u.description.toLowerCase().includes(lower),
  )
}

export function truncateKeyword(input: string): string {
  return input.slice(0, 100)
}

export function sortUsers(
  users: StoredUser[],
  sort: SortState | null,
): StoredUser[] {
  if (!sort) return users

  const { column, direction } = sort
  const numericColumns = ['followers_count', 'friends_count', 'statuses_count']
  const textColumns = ['name', 'screen_name', 'location']
  const dateColumns = ['created_at']

  const sorted = [...users].sort((a, b) => {
    const aVal = (a as unknown as Record<string, unknown>)[column]
    const bVal = (b as unknown as Record<string, unknown>)[column]

    let cmp = 0

    if (numericColumns.includes(column)) {
      cmp = (aVal as number) - (bVal as number)
    } else if (textColumns.includes(column)) {
      cmp = String(aVal)
        .toLowerCase()
        .localeCompare(String(bVal).toLowerCase())
    } else if (dateColumns.includes(column)) {
      cmp =
        new Date(aVal as string).getTime() -
        new Date(bVal as string).getTime()
    }

    return direction === 'desc' ? -cmp : cmp
  })

  return sorted
}

export function computeTotalPages(
  totalCount: number,
  pageSize: number,
): number {
  return Math.max(1, Math.ceil(totalCount / pageSize))
}

export function navigatePage(
  current: number,
  total: number,
  direction: 'next' | 'prev',
): number {
  if (direction === 'next' && current < total) {
    return current + 1
  }
  if (direction === 'prev' && current > 1) {
    return current - 1
  }
  return current
}

export function applyColumnToggle(
  visibility: Record<string, boolean>,
  key: string,
): Record<string, boolean> {
  const currentValue = visibility[key] ?? true
  if (currentValue) {
    const visibleCount = Object.values(visibility).filter(Boolean).length
    if (visibleCount <= 1) {
      return visibility
    }
  }
  return { ...visibility, [key]: !currentValue }
}

export function getHeaderCheckboxState(
  pageIds: string[],
  selectedIds: string[],
): 'checked' | 'unchecked' | 'indeterminate' {
  if (pageIds.length === 0) return 'unchecked'
  const selectedSet = new Set(selectedIds)
  const selectedOnPage = pageIds.filter((id) => selectedSet.has(id))
  if (selectedOnPage.length === 0) return 'unchecked'
  if (selectedOnPage.length === pageIds.length) return 'checked'
  return 'indeterminate'
}

export function computeResetPage(
  stateChanged: boolean,
  currentPage: number,
): number {
  return stateChanged ? 1 : currentPage
}

export function shouldToolbarBeVisible(selectedIds: string[]): boolean {
  return selectedIds.length > 0
}

export function getSelectedCount(selectedIds: string[]): number {
  return selectedIds.length
}

export function clearSelectionOnChange(
  selectedIds: string[],
  stateChanged: boolean,
): string[] {
  return stateChanged ? [] : selectedIds
}

export function resolveSelectionAfterBulkAction(
  selectedIds: string[],
  failedIds: string[],
): string[] {
  if (failedIds.length === 0) return []
  const failedSet = new Set(failedIds)
  return selectedIds.filter((id) => failedSet.has(id))
}
