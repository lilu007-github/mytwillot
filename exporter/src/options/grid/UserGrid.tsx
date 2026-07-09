import { type Component, For, Show, createEffect } from 'solid-js'

import type { StoredUser } from 'utils/db/users'
import type { ColumnDef, SortState } from './types'

export interface UserGridProps {
  users: StoredUser[]
  columns: ColumnDef[]
  visibility: Record<string, boolean>
  sort: SortState | null
  selectedIds: Set<string>
  headerCheckboxState: 'checked' | 'unchecked' | 'indeterminate'
  isLoading: boolean
  error: string | null
  onSort: (columnKey: string) => void
  onSelectRow: (id: string) => void
  onSelectAll: () => void
}

const UserGrid: Component<UserGridProps> = (props) => {
  let headerCheckboxRef: HTMLInputElement | undefined

  createEffect(() => {
    if (headerCheckboxRef) {
      headerCheckboxRef.indeterminate =
        props.headerCheckboxState === 'indeterminate'
    }
  })

  const visibleColumns = () =>
    props.columns.filter((col) => props.visibility[col.key] !== false)

  const sortIndicator = (col: ColumnDef) => {
    if (!props.sort || props.sort.column !== col.key) return null
    return props.sort.direction === 'asc' ? ' ↑' : ' ↓'
  }

  const renderCell = (user: StoredUser, col: ColumnDef) => {
    switch (col.key) {
      case 'avatar':
        return (
          <img
            src={user.profile_image_url_https}
            alt={`${user.name} avatar`}
            class="h-8 w-8 rounded-full object-cover"
          />
        )
      case 'is_blue_verified':
        return (
          <Show when={user.is_blue_verified}>
            <svg
              class="h-4 w-4 text-blue-500"
              fill="currentColor"
              viewBox="0 0 24 24"
              aria-label="Verified"
            >
              <path d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.34 2.19c-1.39-.46-2.9-.2-3.91.81s-1.27 2.52-.81 3.91C2.63 9.33 1.75 10.57 1.75 12s.88 2.67 2.19 3.34c-.46 1.39-.2 2.9.81 3.91s2.52 1.27 3.91.81c.66 1.31 1.91 2.19 3.34 2.19s2.67-.88 3.34-2.19c1.39.46 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34zm-11.29 4.71-4.25-4.25 1.41-1.41 2.84 2.84 6.01-6.01 1.41 1.41-7.42 7.42z" />
            </svg>
          </Show>
        )
      case 'created_at':
        return (
          <span class="whitespace-nowrap text-sm text-gray-600">
            {new Date(user.created_at).toLocaleDateString()}
          </span>
        )
      case 'description':
        return (
          <span
            class="line-clamp-2 max-w-xs text-sm text-gray-600"
            title={user.description}
          >
            {user.description}
          </span>
        )
      default: {
        const value = (user as unknown as Record<string, unknown>)[
          col.key
        ]
        return (
          <span class="text-sm text-gray-900">
            {value != null ? String(value) : ''}
          </span>
        )
      }
    }
  }

  return (
    <div class="w-full overflow-x-auto">
      <Show when={props.error}>
        <div class="flex items-center justify-center rounded-md border border-red-200 bg-red-50 p-6">
          <p class="text-sm text-red-600">{props.error}</p>
        </div>
      </Show>

      <Show when={!props.error}>
        <Show
          when={
            !props.isLoading &&
            props.users.length === 0
          }
        >
          <div class="flex items-center justify-center rounded-md border border-gray-200 bg-gray-50 p-6">
            <p class="text-sm text-gray-500">No users found</p>
          </div>
        </Show>

        <Show when={props.isLoading}>
          <div class="flex items-center justify-center p-6">
            <p class="text-sm text-gray-500">Loading...</p>
          </div>
        </Show>

        <Show when={!props.isLoading && props.users.length > 0}>
          <table class="w-full border-collapse text-left text-sm">
            <thead>
              <tr class="border-b border-gray-200 bg-gray-50">
                <th class="px-3 py-2">
                  <input
                    ref={headerCheckboxRef}
                    type="checkbox"
                    class="h-4 w-4 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    checked={props.headerCheckboxState === 'checked'}
                    onChange={() => props.onSelectAll()}
                    aria-label="Select all rows"
                  />
                </th>
                <For each={visibleColumns()}>
                  {(col) => (
                    <th
                      class={`px-3 py-2 text-xs font-medium uppercase tracking-wider text-gray-500 ${
                        col.sortable
                          ? 'cursor-pointer select-none hover:text-gray-700'
                          : ''
                      }`}
                      onClick={() => {
                        if (col.sortable) {
                          props.onSort(col.key)
                        }
                      }}
                    >
                      {col.label}
                      {sortIndicator(col)}
                    </th>
                  )}
                </For>
              </tr>
            </thead>
            <tbody>
              <For each={props.users}>
                {(user) => (
                  <tr class="border-b border-gray-100 hover:bg-gray-50">
                    <td class="px-3 py-2">
                      <input
                        type="checkbox"
                        class="h-4 w-4 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        checked={props.selectedIds.has(user.id)}
                        onChange={() => props.onSelectRow(user.id)}
                        aria-label={`Select ${user.name}`}
                      />
                    </td>
                    <For each={visibleColumns()}>
                      {(col) => (
                        <td class="px-3 py-2">
                          {renderCell(user, col)}
                        </td>
                      )}
                    </For>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </Show>
      </Show>
    </div>
  )
}

export default UserGrid
