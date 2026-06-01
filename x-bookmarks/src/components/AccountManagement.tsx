import { createSignal, For, onMount, Show } from 'solid-js'

import { getAccountRegistry, getActiveAccountId, type AccountEntry } from 'utils/account-manager'
import { canDelete, deleteAccountData, type AccountCleanupResult } from 'utils/account-cleanup'
import Modal from './Modal'

export default function AccountManagement() {
  const [accounts, setAccounts] = createSignal<AccountEntry[]>([])
  const [activeId, setActiveId] = createSignal('')
  const [confirmTarget, setConfirmTarget] = createSignal<AccountEntry | null>(null)
  const [isDeleting, setIsDeleting] = createSignal(false)
  const [errorMessage, setErrorMessage] = createSignal('')

  async function loadAccounts() {
    const [registry, currentId] = await Promise.all([
      getAccountRegistry(),
      getActiveAccountId(),
    ])
    setAccounts(registry)
    setActiveId(currentId)
  }

  onMount(() => {
    loadAccounts()
  })

  function handleDeleteClick(account: AccountEntry) {
    setErrorMessage('')
    if (account.user_id === activeId()) {
      setErrorMessage('Cannot delete the currently active account. Switch to a different account first.')
      return
    }
    setConfirmTarget(account)
  }

  function handleCancelDelete() {
    setConfirmTarget(null)
  }

  async function handleConfirmDelete() {
    const target = confirmTarget()
    if (!target) return

    setConfirmTarget(null)
    setIsDeleting(true)
    setErrorMessage('')

    try {
      const allowed = await canDelete(target.user_id)
      if (!allowed) {
        setErrorMessage('Cannot delete the currently active account. Switch to a different account first.')
        setIsDeleting(false)
        return
      }

      const result: AccountCleanupResult = await deleteAccountData(target.user_id)

      if (result.indexedDbDeleted && result.chromeStorageDeleted && result.registryRemoved) {
        alert(`Account @${target.screen_name || target.user_id} and all its data have been removed successfully.`)
      } else {
        const failures: string[] = []
        if (!result.indexedDbDeleted) failures.push('IndexedDB records')
        if (!result.chromeStorageDeleted) failures.push('Chrome Storage entries')
        if (!result.registryRemoved) failures.push('registry entry')
        setErrorMessage(
          `Partial failure: could not clean ${failures.join(', ')}. The account remains in the registry for retry.`,
        )
      }

      await loadAccounts()
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'An unexpected error occurred during deletion.',
      )
    } finally {
      setIsDeleting(false)
    }
  }

  function formatDate(timestamp: number): string {
    return new Date(timestamp * 1000).toLocaleDateString()
  }

  return (
    <div class="container mx-auto p-4 text-base">
      <div class="mb-4 rounded-md border border-gray-200 p-4 dark:border-gray-700">
        <div class="w-full border-b pb-4 pt-2 text-lg font-bold text-gray-900 outline-none dark:border-gray-600 dark:border-b-[#121212] dark:bg-[#121212] dark:text-white">
          Account Management
        </div>

        <Show when={errorMessage()}>
          <div class="mt-4 flex rounded-lg bg-red-50 p-4 text-sm text-red-700 dark:bg-gray-800 dark:text-red-400" role="alert">
            <svg class="me-3 mt-[2px] inline h-4 w-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 .5a9.5 9.5 0 1 0 9.5 9.5A9.51 9.51 0 0 0 10 .5ZM9.5 4a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM12 15H8a1 1 0 0 1 0-2h1v-3H8a1 1 0 0 1 0-2h2a1 1 0 0 1 1 1v4h1a1 1 0 0 1 0 2Z" />
            </svg>
            <span>{errorMessage()}</span>
          </div>
        </Show>

        <div class="relative mt-4 overflow-x-auto sm:rounded-lg">
          <table class="w-full text-left text-gray-500 rtl:text-right dark:text-gray-400">
            <thead class="bg-gray-50 text-gray-700 dark:bg-gray-700 dark:text-gray-400">
              <tr>
                <th scope="col" class="w-1/12 px-6 py-3">Avatar</th>
                <th scope="col" class="w-3/12 px-6 py-3">Account</th>
                <th scope="col" class="w-2/12 px-6 py-3">First Seen</th>
                <th scope="col" class="w-2/12 px-6 py-3">Last Active</th>
                <th scope="col" class="w-2/12 px-6 py-3">Status</th>
                <th scope="col" class="w-2/12 px-6 py-3">Action</th>
              </tr>
            </thead>
            <tbody class="text-sm">
              <For
                each={accounts()}
                fallback={
                  <tr>
                    <td colspan="6">
                      <div class="flex justify-center p-8 text-base text-gray-500 dark:text-gray-400">
                        No accounts registered yet. Log in to X/Twitter to get started.
                      </div>
                    </td>
                  </tr>
                }
              >
                {(account) => {
                  const isActive = () => account.user_id === activeId()
                  return (
                    <tr class="border-b bg-white last:border-b-0 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-600">
                      <td class="px-6 py-4">
                        <Show
                          when={account.profile_image_url}
                          fallback={
                            <div class="h-8 w-8 rounded-full bg-gray-200 dark:bg-gray-600" />
                          }
                        >
                          <img
                            src={account.profile_image_url}
                            alt={`@${account.screen_name}`}
                            class="h-8 w-8 rounded-full object-cover"
                            width={32}
                            height={32}
                          />
                        </Show>
                      </td>
                      <td class="whitespace-nowrap px-6 py-4 font-medium text-gray-900 dark:text-white">
                        <Show when={account.screen_name} fallback={account.user_id}>
                          @{account.screen_name}
                        </Show>
                      </td>
                      <td class="px-6 py-4">{formatDate(account.first_seen_at)}</td>
                      <td class="px-6 py-4">{formatDate(account.last_active_at)}</td>
                      <td class="px-6 py-4">
                        <Show when={isActive()}>
                          <span class="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900 dark:text-green-300">
                            Active
                          </span>
                        </Show>
                      </td>
                      <td class="px-6 py-4">
                        <Show
                          when={!isActive()}
                          fallback={
                            <span class="text-xs text-gray-400">—</span>
                          }
                        >
                          <button
                            class="font-medium text-red-600 hover:underline disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-500"
                            disabled={isDeleting()}
                            onClick={() => handleDeleteClick(account)}
                          >
                            Delete
                          </button>
                        </Show>
                      </td>
                    </tr>
                  )
                }}
              </For>
            </tbody>
          </table>
        </div>
      </div>

      {/* Confirmation Modal */}
      <Modal
        title="Delete Account Data"
        visible={!!confirmTarget()}
        okText="Delete"
        cancelText="Cancel"
        onOk={handleConfirmDelete}
        onCancel={handleCancelDelete}
      >
        <p>
          Are you sure you want to delete all data for account{' '}
          <strong>
            {confirmTarget()?.screen_name
              ? `@${confirmTarget()!.screen_name}`
              : confirmTarget()?.user_id}
          </strong>
          ?
        </p>
        <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
          This will permanently remove all bookmarks, settings, and cached data
          associated with this account. This action cannot be undone.
        </p>
      </Modal>
    </div>
  )
}
