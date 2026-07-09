export type EntityScope = 'bookmark' | 'user'

export interface Folder {
  /** Composite key: `${owner_id}_${scope}_${name}` */
  id: string
  owner_id: string
  name: string
  scope: EntityScope
  sort_order: number
  created_at: number
  /**
   * Name of the parent folder (same scope/owner), or null/undefined for a
   * top-level folder. Nesting is unlimited; cycles are rejected at write time.
   */
  parent_id?: string | null
}

export class DuplicateFolderError extends Error {
  constructor(name: string, scope: EntityScope) {
    super(`A folder with name "${name}" already exists in scope "${scope}"`)
    this.name = 'DuplicateFolderError'
  }
}

export class InvalidFolderNameError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'InvalidFolderNameError'
  }
}

export class FolderNotFoundError extends Error {
  constructor(name: string, scope: EntityScope) {
    super(`Folder "${name}" not found in scope "${scope}"`)
    this.name = 'FolderNotFoundError'
  }
}
