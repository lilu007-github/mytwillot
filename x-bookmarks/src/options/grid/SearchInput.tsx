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
    <input
      type="text"
      placeholder="Search by name, handle, or bio..."
      value={props.value}
      maxLength={100}
      onInput={(e) => debouncedSearch(e.currentTarget.value)}
      class="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
    />
  )
}

export default SearchInput
