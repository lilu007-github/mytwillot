import { type Component, createSignal, For, Show, onMount } from 'solid-js'

import { OptionName } from 'utils/types'
import { readConfig } from 'utils/db/configs'
import { updateUserFolder } from 'utils/db/users'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '~/components/ui/dialog'
import { showToast } from '~/components/ui/toast'

export interface MoveToFolderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedIds: string[]
  onComplete: (result: { succeeded: string[]; failed: string[] }) => void
}

const MoveToFolderDialog: Component<MoveToFolderDialogProps> = (props) => {
  const [folders, setFolders] = createSignal<string[]>([])
  const [isLoading, setIsLoading] = createSignal(false)
  const [isMoving, setIsMoving] = createSignal(false)

  onMount(async () => {
    await loadFolders()
  })

  const loadFolders = async () => {
    setIsLoading(true)
    try {
      const config = await readConfig(OptionName.FOLDER)
      const folderList = (config?.option_value as string[]) || []
      setFolders(folderList.filter((f) => f))
    } catch (err) {
      console.error('Failed to load folders:', err)
      setFolders([])
    } finally {
      setIsLoading(false)
    }
  }

  const handleSelectFolder = async (folder: string) => {
    setIsMoving(true)
    try {
      const result = await updateUserFolder(props.selectedIds, folder)
      const successCount = result.succeeded.length
      const failCount = result.failed.length

      if (failCount === 0) {
        showToast({
          title: 'Moved to folder',
          description: `${successCount} user${successCount !== 1 ? 's' : ''} moved to "${folder}"`,
          variant: 'success',
        })
      } else if (successCount === 0) {
        showToast({
          title: 'Move failed',
          description: `Failed to move ${failCount} user${failCount !== 1 ? 's' : ''}`,
          variant: 'error',
        })
      } else {
        showToast({
          title: 'Partially moved',
          description: `${successCount} moved, ${failCount} failed`,
          variant: 'warning',
        })
      }

      props.onComplete(result)
      props.onOpenChange(false)
    } catch (err) {
      showToast({
        title: 'Move failed',
        description: 'An unexpected error occurred',
        variant: 'error',
      })
    } finally {
      setIsMoving(false)
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent class="w-10/12 max-w-md">
        <DialogHeader>
          <DialogTitle>Move to Folder</DialogTitle>
          <DialogDescription>
            Select a folder for {props.selectedIds.length} user
            {props.selectedIds.length !== 1 ? 's' : ''}
          </DialogDescription>
        </DialogHeader>
        <div class="max-h-64 overflow-y-auto">
          <Show
            when={!isLoading()}
            fallback={
              <p class="py-4 text-center text-sm text-gray-500">
                Loading folders...
              </p>
            }
          >
            <Show
              when={folders().length > 0}
              fallback={
                <p class="py-4 text-center text-sm text-gray-500">
                  No folders available. Create a folder in the bookmarks
                  extension first.
                </p>
              }
            >
              <ul class="divide-y divide-gray-100">
                <For each={folders()}>
                  {(folder) => (
                    <li>
                      <button
                        type="button"
                        class="w-full px-3 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={isMoving()}
                        onClick={() => handleSelectFolder(folder)}
                      >
                        {folder}
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </Show>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default MoveToFolderDialog
