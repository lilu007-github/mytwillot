import { type Component, Show } from 'solid-js'

export interface BulkActionToolbarProps {
  selectedCount: number
  onMoveToFolder: () => void
  onUnfollow: () => void
}

const BulkActionToolbar: Component<BulkActionToolbarProps> = (props) => {
  return (
    <Show when={props.selectedCount > 0}>
      <div class="flex items-center gap-3 rounded-md border border-gray-200 bg-gray-50 px-4 py-2 dark:border-gray-700 dark:bg-gray-800">
        <span class="text-sm font-medium text-gray-700 dark:text-gray-200">
          {props.selectedCount} selected
        </span>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600"
            onClick={() => props.onMoveToFolder()}
          >
            Move to Folder
          </button>
          <button
            type="button"
            class="inline-flex items-center rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
            onClick={() => props.onUnfollow()}
          >
            Unfollow
          </button>
        </div>
      </div>
    </Show>
  )
}

export default BulkActionToolbar
