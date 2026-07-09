export interface Tag {
  /** Composite key: `${owner_id}_${name}` */
  id: string
  owner_id: string
  name: string
  /** Hex color, e.g. `#f59e0b`. Used to render the tag chip. */
  color: string
  sort_order: number
  created_at: number
}

export class DuplicateTagError extends Error {
  constructor(name: string) {
    super(`A tag with name "${name}" already exists`)
    this.name = 'DuplicateTagError'
  }
}

export class InvalidTagNameError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'InvalidTagNameError'
  }
}

/** Default palette offered in the tag color picker. */
export const TAG_COLORS = [
  '#ef4444', // red
  '#f59e0b', // amber
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#3b82f6', // blue
  '#6366f1', // indigo
  '#a855f7', // purple
  '#ec4899', // pink
  '#64748b', // slate
]
