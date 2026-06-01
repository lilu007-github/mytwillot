import { getCurrentUserId, setCurrentUserId } from './storage'

export interface AccountEntry {
  user_id: string
  screen_name: string
  profile_image_url: string
  first_seen_at: number // Unix timestamp (seconds)
  last_active_at: number // Unix timestamp (seconds)
}

const ACCOUNT_REGISTRY_KEY = 'account_registry'
const MAX_REGISTRY_SIZE = 20

/**
 * Reads the account registry from Chrome Storage,
 * returns entries sorted by last_active_at descending.
 */
export async function getAccountRegistry(): Promise<AccountEntry[]> {
  const result = await chrome.storage.local.get(ACCOUNT_REGISTRY_KEY)
  const entries: AccountEntry[] = result[ACCOUNT_REGISTRY_KEY] || []
  return entries.sort((a, b) => b.last_active_at - a.last_active_at)
}

/**
 * Adds a new entry or updates an existing one in the registry.
 * Preserves `first_seen_at` for existing entries.
 * Enforces 20-entry cap by evicting the entry with the oldest `last_active_at`.
 */
export async function upsertAccountEntry(
  entry: Partial<AccountEntry> & { user_id: string },
): Promise<void> {
  const registry = await getAccountRegistry()
  const existingIndex = registry.findIndex(
    (e) => e.user_id === entry.user_id,
  )

  if (existingIndex >= 0) {
    const existing = registry[existingIndex]
    registry[existingIndex] = {
      ...existing,
      screen_name: entry.screen_name ?? existing.screen_name,
      profile_image_url:
        entry.profile_image_url ?? existing.profile_image_url,
      last_active_at: entry.last_active_at ?? existing.last_active_at,
    }
  } else {
    const now = Math.floor(Date.now() / 1000)
    const newEntry: AccountEntry = {
      user_id: entry.user_id,
      screen_name: entry.screen_name ?? '',
      profile_image_url: entry.profile_image_url ?? '',
      first_seen_at: entry.first_seen_at ?? now,
      last_active_at: entry.last_active_at ?? now,
    }
    registry.push(newEntry)
  }

  // Enforce cap: evict oldest last_active_at entries
  while (registry.length > MAX_REGISTRY_SIZE) {
    let oldestIndex = 0
    for (let i = 1; i < registry.length; i++) {
      if (registry[i].last_active_at < registry[oldestIndex].last_active_at) {
        oldestIndex = i
      }
    }
    registry.splice(oldestIndex, 1)
  }

  // Sort by last_active_at descending before persisting
  registry.sort((a, b) => b.last_active_at - a.last_active_at)

  await chrome.storage.local.set({ [ACCOUNT_REGISTRY_KEY]: registry })
}

/**
 * Removes an account entry from the registry.
 * Rejects if the userId matches the currently active account.
 */
export async function removeAccount(userId: string): Promise<void> {
  const activeId = await getActiveAccountId()
  if (userId === activeId) {
    throw new Error('Cannot remove the currently active account')
  }

  const registry = await getAccountRegistry()
  const filtered = registry.filter((e) => e.user_id !== userId)
  await chrome.storage.local.set({ [ACCOUNT_REGISTRY_KEY]: filtered })
}

/**
 * Reads the current active account user ID from Chrome Storage.
 */
export async function getActiveAccountId(): Promise<string> {
  return getCurrentUserId()
}

/**
 * Detects the active account by comparing the provided user ID
 * with the stored current_user_id. If different, updates storage
 * and upserts the account entry.
 */
export async function detectAndSetActiveAccount(
  parsedUserId: string,
  screenName?: string,
  profileImageUrl?: string,
): Promise<void> {
  const currentId = await getActiveAccountId()

  if (parsedUserId !== currentId) {
    await setCurrentUserId(parsedUserId)
  }

  if (parsedUserId) {
    await upsertAccountEntry({
      user_id: parsedUserId,
      screen_name: screenName ?? '',
      profile_image_url: profileImageUrl ?? '',
      last_active_at: Math.floor(Date.now() / 1000),
    })
  }
}
