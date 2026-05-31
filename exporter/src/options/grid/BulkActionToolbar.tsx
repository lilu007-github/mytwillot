import { type Component, createSignal, Show } from 'solid-js'

import UnfollowDialog from './UnfollowDialog'

export interface BulkActionToolbarProps {
  selectedCount: number
  selectedUserIds: string[]
  onMoveToFolder: () => void
  onUnfollowComplete: (failedIds: string[]) => void
}

const BulkActionToolbar: Component<BulkActionToolbarProps> = (props) => {
  const [unfollowDialogOpen, setUnfollowDialogOpen] = createSignal(false)

  return (
    <Show when={props.selectedCount > 0}>
      <div class="flex items-center gap-3 rounded-md border border-gray-200 bg-gray-50 px-4 py-2">
        <span class="text-sm font-medium text-gray-700">
          {props.selectedCount} selected
        </span>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
            onClick={() => props.onMoveToFolder()}
          >
            Move to Folder
          </button>
          <button
            type="button"
            class="inline-flex items-center rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 shadow-sm hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1"
            onClick={() => setUnfollowDialogOpen(true)}
          >
            Unfollow
          </button>
        </div>
      </div>
      <UnfollowDialog
        open={unfollowDialogOpen()}
        selectedUserIds={props.selectedUserIds}
        onOpenChange={setUnfollowDialogOpen}
        onComplete={props.onUnfollowComplete}
      />
    </Show>
  )
}

export default BulkActionToolbar
