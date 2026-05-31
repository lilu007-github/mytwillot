import type { Component } from 'solid-js'
import { onCleanup } from 'solid-js'
import debounce from 'lodash.debounce'

import { truncateKeyword } from './gridLogic'

interface SearchInputProps {
  value: string
  onSearch: (keyword: string) => void
}

const SearchInput: Component<SearchInputProps> = (props) => {
  const debouncedSearch = debounce((raw: string) => {
    const truncated = truncateKeyword(raw)
    props.onSearch(truncated.trim())
  }, 300)

  onCleanup(() => {
    debouncedSearch.cancel()
  })

  return (
    <div class="relative">
      <svg
        class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        stroke-width="2"
        stroke="currentColor"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
        />
      </svg>
      <input
        type="text"
        placeholder="Search users..."
        value={props.value}
        onInput={(e) => debouncedSearch(e.currentTarget.value)}
        maxLength={100}
        class="h-9 w-64 rounded-md border border-gray-300 bg-transparent py-1.5 pl-8 pr-3 text-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
    </div>
  )
}

export default SearchInput
