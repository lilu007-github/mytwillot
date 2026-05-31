import type { StoredUser } from 'utils/db/users'

export type Relationship = 'followers' | 'following'

export interface ColumnDef {
  key: string
  label: string
  sortable: boolean
  defaultVisible: boolean
}

export interface SortState {
  column: string
  direction: 'asc' | 'desc'
}

export interface GridState {
  relationship: Relationship
  keyword: string
  page: number
  pageSize: number
  sort: SortState | null
  selectedIds: string[]
  columnVisibility: Record<string, boolean>
  users: StoredUser[]
  totalCount: number
  isLoading: boolean
  error: string | null
  /** Bumped to force a data re-fetch (e.g. after a sync completes). */
  dataVersion: number
}

export const DEFAULT_COLUMNS: ColumnDef[] = [
  { key: 'avatar', label: 'Avatar', sortable: false, defaultVisible: true },
  { key: 'name', label: 'Name', sortable: true, defaultVisible: true },
  {
    key: 'screen_name',
    label: 'Username',
    sortable: true,
    defaultVisible: true,
  },
  {
    key: 'followers_count',
    label: 'Followers',
    sortable: true,
    defaultVisible: true,
  },
  {
    key: 'friends_count',
    label: 'Following',
    sortable: true,
    defaultVisible: true,
  },
  {
    key: 'statuses_count',
    label: 'Posts',
    sortable: true,
    defaultVisible: true,
  },
  {
    key: 'is_blue_verified',
    label: 'Verified',
    sortable: true,
    defaultVisible: true,
  },
  {
    key: 'description',
    label: 'Bio',
    sortable: false,
    defaultVisible: true,
  },
  {
    key: 'created_at',
    label: 'Joined',
    sortable: true,
    defaultVisible: true,
  },
]

export const COLUMN_PREF_KEY = 'user_grid_column_visibility'
