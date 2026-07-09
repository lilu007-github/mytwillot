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
  emptyMessage: string
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
          <a href={`https://x.com/${user.screen_name}`} target="_blank">
            <img
              src={user.profile_image_url_https?.replace('_normal', '_x96')}
              alt={user.name}
              class="h-9 w-9 rounded-full object-cover"
            />
          </a>
        )
      case 'name':
        return (
          <a
            href={`https://x.com/${user.screen_name}`}
            target="_blank"
            class="font-medium text-gray-900 hover:underline dark:text-white"
          >
            {user.name}
          </a>
        )
      case 'screen_name':
        return (
          <span class="text-sm text-gray-500 dark:text-gray-400">
            @{user.screen_name}
          </span>
        )
      case 'followers_count':
        return (
          <span class="text-sm text-gray-900 dark:text-gray-200">
            {user.followers_count?.toLocaleString()}
          </span>
        )
      case 'friends_count':
        return (
          <span class="text-sm text-gray-900 dark:text-gray-200">
            {user.friends_count?.toLocaleString()}
          </span>
        )
      case 'statuses_count':
        return (
          <span class="text-sm text-gray-900 dark:text-gray-200">
            {user.statuses_count?.toLocaleString()}
          </span>
        )
      case 'is_blue_verified':
        return (
          <Show when={user.is_blue_verified}>
            <svg
              class="h-4 w-4 text-blue-500"
              viewBox="0 0 22 22"
              fill="currentColor"
              aria-label="Verified"
            >
              <path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.69-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.636.433 1.221.878 1.69.47.446 1.055.752 1.69.883.635.13 1.294.083 1.902-.143.271.586.702 1.084 1.24 1.438.54.354 1.167.551 1.813.568.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.225 1.261.272 1.893.143.634-.131 1.22-.434 1.69-.88.445-.47.749-1.055.88-1.69.13-.634.085-1.29-.138-1.896.587-.274 1.084-.705 1.438-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z" />
            </svg>
          </Show>
        )
      case 'location':
        return (
          <span class="text-sm text-gray-600 dark:text-gray-400">
            {user.location}
          </span>
        )
      case 'description':
        return (
          <span
            class="line-clamp-2 block max-w-xs text-sm text-gray-600 dark:text-gray-400"
            title={user.description}
          >
            {user.description}
          </span>
        )
      case 'created_at':
        return (
          <span class="whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
            {user.created_at
              ? new Date(user.created_at).toLocaleDateString()
              : ''}
          </span>
        )
      default: {
        const value = (user as unknown as Record<string, unknown>)[col.key]
        return (
          <span class="text-sm text-gray-900 dark:text-gray-200">
            {value != null ? String(value) : ''}
          </span>
        )
      }
    }
  }

  return (
    <div class="w-full overflow-x-auto">
      <Show when={props.error}>
        <div class="flex items-center justify-center rounded-md border border-red-200 bg-red-50 p-6 dark:border-red-900 dark:bg-red-950">
          <p class="text-sm text-red-600 dark:text-red-400">{props.error}</p>
        </div>
      </Show>

      <Show when={!props.error}>
        <Show when={props.isLoading}>
          <div class="flex items-center justify-center p-6">
            <p class="text-sm text-gray-500">Loading...</p>
          </div>
        </Show>

        <Show when={!props.isLoading && props.users.length === 0}>
          <div class="py-16 text-center text-gray-400">
            <p>{props.emptyMessage}</p>
          </div>
        </Show>

        <Show when={!props.isLoading && props.users.length > 0}>
          <table class="w-full border-collapse text-left text-sm">
            <thead>
              <tr class="border-b border-gray-200 dark:border-gray-700">
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
                      class={`px-3 py-2 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400 ${
                        col.sortable
                          ? 'cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200'
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
                  <tr class="border-b border-gray-100 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800">
                    <td class="px-3 py-2 align-top">
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
                        <td class="px-3 py-2 align-top">
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
