import { type Component, For, Show, createSignal } from 'solid-js'

import Modal from '~/components/Modal'
import {
  folderState,
  moveEntitiesToFolder,
} from '~/stores/folders'

export interface MoveToFolderDialogProps {
  open: boolean
  selectedIds: string[]
  onOpenChange: (open: boolean) => void
  onComplete: (result: { succeeded: string[]; failed: string[] }) => void
}

const MoveToFolderDialog: Component<MoveToFolderDialogProps> = (props) => {
  const [isMoving, setIsMoving] = createSignal(false)

  const handleSelectFolder = async (folder: string) => {
    setIsMoving(true)
    try {
      const result = await moveEntitiesToFolder(props.selectedIds, folder)
      const successCount = result.succeeded.length
      const failCount = result.failed.length

      if (failCount === 0 && successCount > 0) {
        alert(`${successCount} item(s) moved to "${folder}".`)
      } else if (successCount === 0 && failCount > 0) {
        // Check if it was a folder-not-found case (all failed, no partial)
        alert(`Failed to move ${failCount} item(s).`)
      } else if (successCount > 0 && failCount > 0) {
        alert(`${successCount} moved, ${failCount} failed.`)
      }

      props.onComplete(result)
      props.onOpenChange(false)
    } catch (err) {
      console.error(err)
      alert('An unexpected error occurred while moving items.')
    } finally {
      setIsMoving(false)
    }
  }

  const scopeLabel = () =>
    folderState.activeScope === 'bookmark' ? 'bookmark' : 'user'

  return (
    <Modal
      visible={props.open}
      title="Move to Folder"
      cancelText="Cancel"
      onCancel={() => {
        if (!isMoving()) props.onOpenChange(false)
      }}
    >
      <p class="mb-3 text-sm text-gray-500 dark:text-gray-400">
        Select a folder for {props.selectedIds.length} {scopeLabel()}
        {props.selectedIds.length !== 1 ? 's' : ''}
      </p>
      <div class="max-h-64 overflow-y-auto">
        <Show
          when={folderState.folders.length > 0}
          fallback={
            <p class="py-4 text-center text-sm text-gray-500">
              No folders available. Create a folder first.
            </p>
          }
        >
          <ul class="divide-y divide-gray-100 dark:divide-gray-700">
            <For each={folderState.folders}>
              {(folder) => (
                <li>
                  <button
                    type="button"
                    class="w-full px-3 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-200 dark:hover:bg-gray-700"
                    disabled={isMoving()}
                    onClick={() => handleSelectFolder(folder.name)}
                  >
                    {folder.name}
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </Modal>
  )
}

export default MoveToFolderDialog
