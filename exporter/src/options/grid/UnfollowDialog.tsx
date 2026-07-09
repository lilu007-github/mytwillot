import { type Component, createSignal } from 'solid-js'

import { unfollowUser } from 'utils/api/twitter'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { showToast } from '~/components/ui/toast'

export interface UnfollowDialogProps {
  open: boolean
  selectedUserIds: string[]
  onOpenChange: (open: boolean) => void
  onComplete: (failedIds: string[]) => void
}

const UnfollowDialog: Component<UnfollowDialogProps> = (props) => {
  const [isProcessing, setIsProcessing] = createSignal(false)

  const handleConfirm = async () => {
    setIsProcessing(true)
    const failedIds: string[] = []
    let successCount = 0

    for (const userId of props.selectedUserIds) {
      try {
        await unfollowUser(userId)
        successCount++
      } catch {
        failedIds.push(userId)
      }
    }

    setIsProcessing(false)
    props.onOpenChange(false)

    if (failedIds.length === 0) {
      showToast({
        title: 'Unfollow complete',
        description: `Successfully unfollowed ${successCount} user${successCount > 1 ? 's' : ''}.`,
        variant: 'success',
      })
    } else if (successCount === 0) {
      showToast({
        title: 'Unfollow failed',
        description: `Failed to unfollow ${failedIds.length} user${failedIds.length > 1 ? 's' : ''}.`,
        variant: 'error',
      })
    } else {
      showToast({
        title: 'Partial unfollow',
        description: `Unfollowed ${successCount} user${successCount > 1 ? 's' : ''}, ${failedIds.length} failed.`,
        variant: 'warning',
      })
    }

    props.onComplete(failedIds)
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm Unfollow</DialogTitle>
          <DialogDescription>
            Are you sure you want to unfollow{' '}
            <span class="font-semibold">{props.selectedUserIds.length}</span>{' '}
            user{props.selectedUserIds.length > 1 ? 's' : ''}? This action
            cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button
            type="button"
            class="inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
            onClick={() => props.onOpenChange(false)}
            disabled={isProcessing()}
          >
            Cancel
          </button>
          <button
            type="button"
            class="inline-flex items-center rounded-md border border-transparent bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 disabled:opacity-50"
            onClick={handleConfirm}
            disabled={isProcessing()}
          >
            {isProcessing() ? 'Unfollowing...' : 'Unfollow'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default UnfollowDialog
