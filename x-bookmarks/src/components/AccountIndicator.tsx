import { createSignal, Show } from 'solid-js'

export interface AccountIndicatorProps {
  userId: string
  screenName: string
  profileImageUrl: string
  syncStatus: 'idle' | 'syncing' | 'error'
  syncProgress?: number
}

function truncateScreenName(name: string, maxLength = 20): string {
  if (name.length <= maxLength) return name
  return name.slice(0, maxLength) + '…'
}

function UserPlaceholderIcon() {
  return (
    <svg
      class="h-8 w-8 rounded-full bg-gray-200 p-1 text-gray-500 dark:bg-gray-700 dark:text-gray-400"
      fill="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12Zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8Z" />
    </svg>
  )
}

export default function AccountIndicator(props: AccountIndicatorProps) {
  const [imgError, setImgError] = createSignal(false)

  return (
    <Show
      when={props.userId}
      fallback={
        <div class="flex items-center gap-2 px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
          <UserPlaceholderIcon />
          <span>Log in to X/Twitter</span>
        </div>
      }
    >
      <div class="flex items-center gap-2 px-3 py-2">
        <Show
          when={!imgError() && props.profileImageUrl}
          fallback={<UserPlaceholderIcon />}
        >
          <img
            src={props.profileImageUrl}
            alt={`@${props.screenName}`}
            class="h-8 w-8 rounded-full object-cover"
            width={32}
            height={32}
            onError={() => setImgError(true)}
          />
        </Show>
        <span class="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
          {truncateScreenName(props.screenName)}
        </span>
        <Show when={props.syncStatus === 'syncing'}>
          <span class="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900 dark:text-blue-300">
            <svg
              class="h-3 w-3 animate-spin"
              fill="none"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle
                class="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                stroke-width="4"
              />
              <path
                class="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4Z"
              />
            </svg>
            <Show when={props.syncProgress !== undefined}>
              {props.syncProgress}
            </Show>
          </span>
        </Show>
      </div>
    </Show>
  )
}
