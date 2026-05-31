import type { Component } from 'solid-js'

import type { Relationship } from './types'

interface RelationshipFilterProps {
  value: Relationship
  followingCount: number
  followersCount: number
  onChange: (value: Relationship) => void
}

const RelationshipFilter: Component<RelationshipFilterProps> = (props) => {
  const tabClass = (active: boolean) =>
    `pb-2 text-base font-medium ${
      active
        ? 'border-b-2 border-blue-500 text-blue-500'
        : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
    }`

  const badgeClass =
    'ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-800'

  return (
    <div class="flex gap-4 border-b border-gray-200 dark:border-gray-700">
      <button
        type="button"
        class={tabClass(props.value === 'following')}
        onClick={() => props.onChange('following')}
      >
        Following
        <span class={badgeClass}>{props.followingCount}</span>
      </button>
      <button
        type="button"
        class={tabClass(props.value === 'followers')}
        onClick={() => props.onChange('followers')}
      >
        Followers
        <span class={badgeClass}>{props.followersCount}</span>
      </button>
    </div>
  )
}

export default RelationshipFilter
