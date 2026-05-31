import { type Component, For, Show } from 'solid-js'

interface PaginationControlProps {
  currentPage: number
  totalPages: number
  totalCount: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}

const PAGE_SIZE_OPTIONS = [20, 50, 100]

const PaginationControl: Component<PaginationControlProps> = (props) => {
  const isPrevDisabled = () => props.currentPage <= 1
  const isNextDisabled = () => props.currentPage >= props.totalPages

  return (
    <Show when={props.totalCount > 0}>
      <div class="flex items-center justify-between border-t border-gray-200 px-2 py-3">
        <div class="flex items-center gap-2">
          <label class="text-sm text-gray-600">Rows per page:</label>
          <select
            class="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            value={props.pageSize}
            onChange={(e) =>
              props.onPageSizeChange(Number(e.currentTarget.value))
            }
          >
            <For each={PAGE_SIZE_OPTIONS}>
              {(size) => <option value={size}>{size}</option>}
            </For>
          </select>
        </div>

        <div class="flex items-center gap-3">
          <span class="text-sm text-gray-600">
            Page {props.currentPage} of {props.totalPages}
          </span>
          <div class="flex items-center gap-1">
            <button
              type="button"
              class="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-500"
              disabled={isPrevDisabled()}
              onClick={() => props.onPageChange(props.currentPage - 1)}
              aria-label="Previous page"
            >
              <svg
                class="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
            <button
              type="button"
              class="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-500"
              disabled={isNextDisabled()}
              onClick={() => props.onPageChange(props.currentPage + 1)}
              aria-label="Next page"
            >
              <svg
                class="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </Show>
  )
}

export default PaginationControl
