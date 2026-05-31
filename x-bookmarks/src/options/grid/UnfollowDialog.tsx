import { type Component, createSignal } from 'solid-js'

import { unfollowUser } from 'utils/api/twitter'
import type { StoredUser } from 'utils/db/users'

import Modal from '~/components/Modal'

export interface UnfollowDialogProps {
  open: boolean
  selectedUsers: StoredUser[]
  onOpenChange: (open: boolean) => void
  onComplete: (failedIds: string[]) => void
}

const UnfollowDialog: Component<UnfollowDialogProps> = (props) => {
  const [isProcessing, setIsProcessing] = createSignal(false)

  const handleConfirm = async () => {
    setIsProcessing(true)
    const failedIds: string[] = []
    let successCount = 0

    for (const user of props.selectedUsers) {
      try {
        await unfollowUser(user.rest_id)
        successCount++
      } catch {
        failedIds.push(user.id)
      }
    }

    setIsProcessing(false)
    props.onOpenChange(false)

    if (failedIds.length === 0) {
      alert(`Successfully unfollowed ${successCount} user(s).`)
    } else if (successCount === 0) {
      alert(`Failed to unfollow ${failedIds.length} user(s).`)
    } else {
      alert(
        `Unfollowed ${successCount} user(s), ${failedIds.length} failed.`,
      )
    }

    props.onComplete(failedIds)
  }

  return (
    <Modal
      visible={props.open}
      title="Confirm Unfollow"
      okText={isProcessing() ? 'Unfollowing...' : 'Unfollow'}
      cancelText="Cancel"
      onOk={handleConfirm}
      onCancel={() => {
        if (!isProcessing()) props.onOpenChange(false)
      }}
    >
      <p>
        Are you sure you want to unfollow{' '}
        <span class="font-semibold">{props.selectedUsers.length}</span> user
        {props.selectedUsers.length !== 1 ? 's' : ''}? This action cannot be
        undone.
      </p>
    </Modal>
  )
}

export default UnfollowDialog
