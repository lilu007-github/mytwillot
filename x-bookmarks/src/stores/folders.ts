import { createSignal } from 'solid-js'
import { createStore, unwrap } from 'solid-js/store'

import {
  type EntityScope,
  type Folder,
  type TimelineAddEntriesInstruction,
  type TimelineInstructions,
  type TimelineTimelineCursor,
  type TimelineTweet,
  type TimelineEntry,
  type TimelineTimelineItem,
} from 'utils/types'
import {
  createFolder as dbCreateFolder,
  renameFolder as dbRenameFolder,
  deleteFolder as dbDeleteFolder,
  reorderFolders as dbReorderFolders,
  setFolderParent as dbSetFolderParent,
  getFoldersByScope,
  getFolderCounts,
  folderExists,
} from 'utils/db/folders'
import { updateFolder, upsertRecords, getPostId } from 'utils/db/tweets'
import { updateUserFolder } from 'utils/db/users'
import { getFolderTweets, getTweet } from 'utils/api/twitter'
import { getCurrentUserId } from 'utils/storage'
import dataStore, { mutateStore } from '../options/store'

// ---------------------------------------------------------------------------
// Reactive state
// ---------------------------------------------------------------------------

interface FolderStoreState {
  folders: Folder[]
  activeScope: EntityScope
  activeFolder: string | null
  folderCounts: Record<string, number>
}

const [state, setState] = createStore<FolderStoreState>({
  folders: [],
  activeScope: 'bookmark',
  activeFolder: null,
  folderCounts: {},
})

const [error, setError] = createSignal<string | null>(null)

const ERROR_TIMEOUT_MS = 5000

function surfaceError(message: string) {
  setError(message)
  setTimeout(() => setError(null), ERROR_TIMEOUT_MS)
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

export async function initFolders(scope: EntityScope) {
  try {
    setState('activeScope', scope)
    const [folders, counts] = await Promise.all([
      getFoldersByScope(scope),
      getFolderCounts(scope),
    ])
    setState('folders', folders)
    setState('folderCounts', counts)
  } catch (err) {
    console.error('initFolders error:', err)
    surfaceError('Failed to load folders')
  }
}

// ---------------------------------------------------------------------------
// Scope & filter management
// ---------------------------------------------------------------------------

export function setActiveScope(scope: EntityScope) {
  setState('activeScope', scope)
  setState('activeFolder', null)
  // Reload folders and counts for the new scope
  Promise.all([getFoldersByScope(scope), getFolderCounts(scope)])
    .then(([folders, counts]) => {
      setState('folders', folders)
      setState('folderCounts', counts)
    })
    .catch((err) => {
      console.error('setActiveScope error:', err)
      surfaceError('Failed to load folders')
    })
}

export function setActiveFolder(name: string | null) {
  setState('activeFolder', name)
}

/** Refresh folder counts for the current scope */
export async function refreshFolderCounts() {
  try {
    const counts = await getFolderCounts(state.activeScope)
    setState('folderCounts', counts)
  } catch {
    // Non-critical, silently fail
  }
}

// ---------------------------------------------------------------------------
// CRUD operations (scoped to activeScope)
// ---------------------------------------------------------------------------

export async function createFolder(
  name: string,
  parentId: string | null = null,
) {
  try {
    const folder = await dbCreateFolder(name, state.activeScope, parentId)
    setState('folders', [...state.folders, folder])
  } catch (err: any) {
    console.error('createFolder error:', err)
    surfaceError(err.message || 'Failed to create folder')
    throw err
  }
}

/** Re-parent a folder (null = move to top level). */
export async function setFolderParent(
  name: string,
  parentName: string | null,
) {
  try {
    await dbSetFolderParent(name, state.activeScope, parentName)
    const folders = await getFoldersByScope(state.activeScope)
    setState('folders', folders)
  } catch (err: any) {
    console.error('setFolderParent error:', err)
    surfaceError(err.message || 'Failed to move folder')
    throw err
  }
}

export async function renameFolder(oldName: string, newName: string) {
  try {
    await dbRenameFolder(oldName, newName, state.activeScope)
    // Reload folders to get updated state
    const [folders, counts] = await Promise.all([
      getFoldersByScope(state.activeScope),
      getFolderCounts(state.activeScope),
    ])
    setState('folders', folders)
    setState('folderCounts', counts)
    // If the active folder was the renamed one, update it
    if (state.activeFolder === oldName) {
      setState('activeFolder', newName.trim())
    }
  } catch (err: any) {
    console.error('renameFolder error:', err)
    surfaceError(err.message || 'Failed to rename folder')
    throw err
  }
}

export async function deleteFolder(name: string) {
  try {
    await dbDeleteFolder(name, state.activeScope)
    setState(
      'folders',
      state.folders.filter((f) => f.name !== name),
    )
    // Clear active folder if it was the deleted one
    if (state.activeFolder === name) {
      setState('activeFolder', null)
    }
    // Refresh counts since entities were unassigned
    await refreshFolderCounts()
  } catch (err: any) {
    console.error('deleteFolder error:', err)
    surfaceError(err.message || 'Failed to delete folder')
    throw err
  }
}

export async function reorderFolders(orderedNames: string[]) {
  try {
    await dbReorderFolders(orderedNames, state.activeScope)
    // Update local state to reflect new order
    const reordered = orderedNames
      .map((name, index) => {
        const folder = state.folders.find((f) => f.name === name)
        return folder ? { ...folder, sort_order: index } : null
      })
      .filter((f): f is Folder => f !== null)
    setState('folders', reordered)
  } catch (err: any) {
    console.error('reorderFolders error:', err)
    surfaceError(err.message || 'Failed to reorder folders')
    throw err
  }
}

// ---------------------------------------------------------------------------
// Entity assignment
// ---------------------------------------------------------------------------

export async function moveEntitiesToFolder(
  entityIds: string[],
  folderName: string,
) {
  try {
    // Validate folder exists
    const exists = await folderExists(folderName, state.activeScope)
    if (!exists) {
      surfaceError('Target folder no longer exists')
      return { succeeded: [], failed: entityIds }
    }

    if (state.activeScope === 'bookmark') {
      const count = await updateFolder(entityIds, folderName)
      // updateFolder returns count of succeeded updates
      const succeeded = entityIds.slice(0, count)
      const failed = entityIds.slice(count)
      if (failed.length > 0) {
        surfaceError(
          `Moved ${succeeded.length} items. ${failed.length} items failed to update.`,
        )
      }
      await refreshFolderCounts()
      return { succeeded, failed }
    } else {
      const result = await updateUserFolder(entityIds, folderName)
      if (result.failed.length > 0) {
        surfaceError(
          `Moved ${result.succeeded.length} items. ${result.failed.length} items failed to update.`,
        )
      }
      await refreshFolderCounts()
      return result
    }
  } catch (err: any) {
    console.error('moveEntitiesToFolder error:', err)
    surfaceError(err.message || 'Failed to move entities to folder')
    return { succeeded: [], failed: entityIds }
  }
}

// ---------------------------------------------------------------------------
// X/Twitter folder sync (preserves legacy sync behavior)
// ---------------------------------------------------------------------------

export const syncXFolders = async (
  folders: { name: string; id: string }[],
) => {
  if (!folders.length) {
    console.log('no shared folders')
    return
  }

  const user_id = await getCurrentUserId()
  for (const folder of folders) {
    let cursor = ''
    while (true) {
      try {
        const json = await getFolderTweets(folder.id, cursor)
        const instructions = json.data.bookmark_collection_timeline.timeline
          .instructions as TimelineInstructions
        const entry = instructions.filter(
          (i) => i.type === 'TimelineAddEntries',
        )[0] as TimelineAddEntriesInstruction
        if (!entry) {
          break
        }
        const cursorEntry = entry.entries.filter(
          (i) => i.content.entryType === 'TimelineTimelineCursor',
        )[0] as TimelineEntry<TimelineTweet, TimelineTimelineCursor>
        const tweetsEntry = entry.entries.filter(
          (i) => i.content.entryType === 'TimelineTimelineItem',
        ) as TimelineEntry<
          TimelineTweet,
          TimelineTimelineItem<TimelineTweet>
        >[]
        if (tweetsEntry.length === 0) {
          break
        }
        const ids = tweetsEntry
          .map((e) => {
            const tweet = getTweet(e.content.itemContent.tweet_results.result)
            return tweet && getPostId(user_id, tweet.rest_id)
          })
          .filter((id) => id)
        await updateFolder(ids, folder.name)
        cursor = cursorEntry.content.value
      } catch (err) {
        console.error(`syncXFolders error:`, folder)
        console.error(err)
        break
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Legacy compatibility exports
// These maintain backward compatibility with existing UI components
// (AsideFolder, FolderDropDown, FolderSelect) until they are replaced
// by the new FolderPanel component in task 7.x.
// ---------------------------------------------------------------------------

const [legacyStore] = dataStore

/** @deprecated Use createFolder instead */
export const addFolder = async (folderName: string) => {
  if (!folderName) return
  try {
    await createFolder(folderName)
    // Also update the legacy store for backward compat
    mutateStore((s) => {
      if (!s.folders.some((f) => f.name === folderName)) {
        s.folders.push({ name: folderName.trim(), count: 0 })
      }
    })
  } catch {
    // Error already surfaced via error signal
  }
}

/** @deprecated Use deleteFolder instead */
export const removeFolder = async (folder: string) => {
  try {
    await deleteFolder(folder)
    // Also update the legacy store
    mutateStore((s) => {
      const index = s.folders.findIndex((f) => f.name === folder)
      if (index > -1) {
        s.folders.splice(index, 1)
      }
      s.tweets.forEach((t) => {
        if (t.folder === folder) {
          t.folder = ''
        }
      })
    })
  } catch {
    // Error already surfaced via error signal
  }
}

/** @deprecated Use moveEntitiesToFolder instead */
export const moveTweetToFolder = async (folder: string, tweet: any) => {
  const index = legacyStore.tweets.findIndex(
    (t) => t.tweet_id === tweet.tweet_id,
  )
  const folderIndex = legacyStore.folders.findIndex((f) => f.name === folder)
  const oldFolderIndex = tweet.folder
    ? legacyStore.folders.findIndex((f) => f.name === tweet.folder)
    : -1
  await upsertRecords([{ ...unwrap(tweet), folder }], true)
  mutateStore((s) => {
    s.tweets[index].folder = folder
    s.folders[folderIndex].count += 1
    if (oldFolderIndex > -1) {
      s.folders[oldFolderIndex].count -= 1
    } else if (s.totalCount) {
      s.totalCount.unsorted -= 1
    }
    if (legacyStore.folder && folder !== legacyStore.folder) {
      s.tweets.splice(index, 1)
    }
  })
}

/** @deprecated Use moveEntitiesToFolder instead */
export const moveTweetsToFolder = async (folder: string) => {
  try {
    const index = legacyStore.folders.findIndex((f) => f.name === folder)
    if (index === -1) return
    let tweets = unwrap(legacyStore.tweets)
      .filter((x) => !x.folder)
      .map((tweet) => ({
        ...tweet,
        folder,
      }))
    await upsertRecords(tweets, true)
    mutateStore((s) => {
      s.tweets.forEach((t) => {
        if (!t.folder) {
          t.folder = folder
        }
      })
      s.folders[index].count += tweets.length
    })
    alert(`${tweets.length} tweets has been moved to folder ${folder}`)
  } catch (err) {
    console.error(err)
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { state as folderState, error as folderError }
export default [state, setState] as const
