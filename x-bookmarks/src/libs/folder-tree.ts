import { type Folder } from 'utils/types'

/**
 * Shared folder-tree helpers for FolderPanel (sidebar) and Collections (card
 * grid). Both views must render the same hierarchy — keep the tree building
 * and count roll-up in one place so they can't drift.
 */

export interface FolderTreeNode {
  folder: Folder
  depth: number
  children: FolderTreeNode[]
}

/** Build a nested tree from the flat parent_id list (parent_id = folder name). */
export function buildFolderTree(folders: Folder[]): FolderTreeNode[] {
  const byParent = new Map<string, Folder[]>()
  for (const f of folders) {
    const key = f.parent_id || '__root__'
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push(f)
  }
  const build = (parentKey: string, depth: number): FolderTreeNode[] =>
    (byParent.get(parentKey) || [])
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((folder) => ({
        folder,
        depth,
        children: build(folder.name, depth + 1),
      }))
  return build('__root__', 0)
}

/**
 * Roll a folder's own count up with all of its descendants' counts so a
 * parent folder reflects everything filed under it.
 */
export function rolledCount(
  name: string,
  folders: Folder[],
  counts: Record<string, number>,
): number {
  let total = counts[name] ?? 0
  for (const f of folders) {
    if (f.parent_id === name) total += rolledCount(f.name, folders, counts)
  }
  return total
}
