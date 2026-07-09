import { createStore, produce } from 'solid-js/store'

import { type Tag } from 'utils/types'
import {
  getTags,
  getTagCounts,
  createTag as dbCreateTag,
  renameTag as dbRenameTag,
  deleteTag as dbDeleteTag,
  setTagColor as dbSetTagColor,
  setTweetTags as dbSetTweetTags,
} from 'utils/db/tags'

interface TagStoreState {
  tags: Tag[]
  counts: Record<string, number>
}

const [state, setState] = createStore<TagStoreState>({
  tags: [],
  counts: {},
})

export { state as tagState }

export async function initTags() {
  try {
    const [tags, counts] = await Promise.all([getTags(), getTagCounts()])
    setState('tags', tags)
    setState('counts', counts)
  } catch (err) {
    console.error('initTags error:', err)
  }
}

export function tagColor(name: string): string {
  return state.tags.find((t) => t.name === name)?.color || '#64748b'
}

export async function createTag(name: string, color?: string) {
  const tag = await dbCreateTag(name, color)
  setState('tags', [...state.tags, tag])
  return tag
}

export async function renameTag(oldName: string, newName: string) {
  await dbRenameTag(oldName, newName)
  await initTags()
}

export async function deleteTag(name: string) {
  await dbDeleteTag(name)
  setState(
    'tags',
    state.tags.filter((t) => t.name !== name),
  )
  await refreshCounts()
}

export async function setTagColor(name: string, color: string) {
  await dbSetTagColor(name, color)
  setState(
    produce((s) => {
      const t = s.tags.find((x) => x.name === name)
      if (t) t.color = color
    }),
  )
}

export async function refreshCounts() {
  try {
    setState('counts', await getTagCounts())
  } catch {
    // non-critical
  }
}

/**
 * Toggle a tag on a tweet record (by stored id) and persist. Returns the new
 * tag list for the tweet.
 */
export async function toggleTweetTag(
  tweetStoredId: string,
  currentTags: string[] | undefined,
  tag: string,
): Promise<string[]> {
  const set = new Set(currentTags || [])
  if (set.has(tag)) {
    set.delete(tag)
  } else {
    set.add(tag)
  }
  const next = Array.from(set)
  await dbSetTweetTags(tweetStoredId, next)
  await refreshCounts()
  return next
}
