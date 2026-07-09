import { getCurrentUserId, getStorageKey, StorageKeys } from './storage'

export interface SyncState {
  status: 'idle' | 'syncing' | 'error'
  progress: number
  total: number | null
  owner_id: string
  error_message?: string
}

const DEFAULT_SYNC_STATE: SyncState = {
  status: 'idle',
  progress: 0,
  total: null,
  owner_id: '',
}

function syncStateKey(userId: string): string {
  return getStorageKey('sync_state', userId)
}

function bookmarkCursorKey(userId: string): string {
  return getStorageKey(StorageKeys.Bookmark_Cursor, userId)
}

/**
 * Start a full sync for the given account.
 * Resets the bookmark cursor and sets sync state to syncing.
 */
export async function startFullSync(userId: string): Promise<void> {
  if (!userId) {
    throw new Error('Cannot start sync without a valid user ID')
  }

  // Reset bookmark cursor to empty string so sync starts from the beginning
  await chrome.storage.local.set({
    [bookmarkCursorKey(userId)]: '',
  })

  // Set sync state to syncing with progress 0
  const state: SyncState = {
    status: 'syncing',
    progress: 0,
    total: null,
    owner_id: userId,
  }

  await chrome.storage.local.set({
    [syncStateKey(userId)]: state,
  })
}

/**
 * Cancel the current sync, persisting the current cursor position.
 * Sets sync state to idle. The cursor is already persisted by the
 * fetching loop, so we only need to update the status.
 */
export async function cancelCurrentSync(): Promise<void> {
  const userId = await getCurrentUserId()
  if (!userId) {
    return
  }

  const state = await readSyncState(userId)
  if (state.status !== 'syncing') {
    return
  }

  const updatedState: SyncState = {
    ...state,
    status: 'idle',
  }

  await chrome.storage.local.set({
    [syncStateKey(userId)]: updatedState,
  })
}

/**
 * Resume sync from the last saved cursor position.
 * Reads the persisted cursor and sets sync state to syncing.
 */
export async function resumeSync(userId: string): Promise<void> {
  if (!userId) {
    throw new Error('Cannot resume sync without a valid user ID')
  }

  const cursorKey = bookmarkCursorKey(userId)
  const result = await chrome.storage.local.get(cursorKey)
  const cursor = result[cursorKey]

  // If no cursor exists, there's nothing to resume — start fresh
  if (cursor === undefined || cursor === null) {
    await startFullSync(userId)
    return
  }

  // Read existing state to preserve progress count
  const existingState = await readSyncState(userId)

  const state: SyncState = {
    status: 'syncing',
    progress: existingState.progress,
    total: existingState.total,
    owner_id: userId,
  }

  await chrome.storage.local.set({
    [syncStateKey(userId)]: state,
  })
}

/**
 * Get the current sync state for the active account.
 * Reads from Chrome Storage using the per-account key.
 */
export async function getSyncState(): Promise<SyncState> {
  const userId = await getCurrentUserId()
  if (!userId) {
    return { ...DEFAULT_SYNC_STATE }
  }

  return readSyncState(userId)
}

/**
 * Internal helper to read sync state for a specific user ID.
 */
async function readSyncState(userId: string): Promise<SyncState> {
  const key = syncStateKey(userId)
  const result = await chrome.storage.local.get(key)
  const state = result[key]

  if (!state) {
    return { ...DEFAULT_SYNC_STATE, owner_id: userId }
  }

  return state as SyncState
}
