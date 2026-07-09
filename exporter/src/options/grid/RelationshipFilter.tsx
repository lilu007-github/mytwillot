import type { Component } from 'solid-js'

interface RelationshipFilterProps {
  value: 'follower' | 'following'
  onChange: (value: 'follower' | 'following') => void
}

const RelationshipFilter: Component<RelationshipFilterProps> = (props) => {
  return (
    <div class="inline-flex rounded-lg bg-gray-100 p-1">
      <button
        type="button"
        class={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
          props.value === 'follower'
            ? 'bg-white text-gray-900 shadow-sm'
            : 'text-gray-500 hover:text-gray-700'
        }`}
        onClick={() => props.onChange('follower')}
      >
        Followers
      </button>
      <button
        type="button"
        class={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
          props.value === 'following'
            ? 'bg-white text-gray-900 shadow-sm'
            : 'text-gray-500 hover:text-gray-700'
        }`}
        onClick={() => props.onChange('following')}
      >
        Following
      </button>
    </div>
  )
}

export default RelationshipFilter
