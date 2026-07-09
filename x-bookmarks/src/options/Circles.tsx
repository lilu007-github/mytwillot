import { createMemo, createResource, createSignal, For, Show } from 'solid-js'
import { A } from '@solidjs/router'

import {
  getUsersByRelationship,
  getFollowEdgesAmong,
  type StoredUser,
} from 'utils/db/users'
import {
  type Circle,
  type CircleKind,
  type CircleMember,
  mutualCircle,
  clusterByLocation,
  clusterByTopic,
  graphCircles,
} from 'utils/circles'

interface CircleData {
  following: StoredUser[]
  followerIds: Set<string>
  edges: Array<[string, string]>
}

async function loadCircleData(): Promise<CircleData> {
  const [following, followers] = await Promise.all([
    getUsersByRelationship('following'),
    getUsersByRelationship('follower'),
  ])
  const followingIds = new Set(following.map((u) => u.rest_id))
  const edges = await getFollowEdgesAmong(followingIds)
  return {
    following,
    followerIds: new Set(followers.map((u) => u.rest_id)),
    edges,
  }
}

const DIMENSIONS: { kind: CircleKind; label: string }[] = [
  { kind: 'mutual', label: 'Mutuals' },
  { kind: 'topic', label: 'Topics' },
  { kind: 'location', label: 'Location' },
  { kind: 'graph', label: 'Follow graph' },
]

function MemberAvatars(props: { members: CircleMember[] }) {
  const [expanded, setExpanded] = createSignal(false)
  const shown = createMemo(() =>
    expanded() ? props.members : props.members.slice(0, 14),
  )
  return (
    <div>
      <Show
        when={expanded()}
        fallback={
          <div class="flex flex-wrap items-center gap-1.5">
            <For each={shown()}>
              {(u) => (
                <a
                  href={`https://x.com/${u.screen_name}`}
                  target="_blank"
                  title={`${u.name} @${u.screen_name}`}
                >
                  <img
                    class="h-8 w-8 rounded-full ring-1 ring-gray-200 dark:ring-gray-700"
                    src={u.profile_image_url_https}
                    alt={u.screen_name}
                    loading="lazy"
                  />
                </a>
              )}
            </For>
            <Show when={props.members.length > 14}>
              <button
                class="text-xs text-blue-500 hover:underline"
                onClick={() => setExpanded(true)}
              >
                +{props.members.length - 14} more
              </button>
            </Show>
          </div>
        }
      >
        <div class="space-y-2">
          <For each={props.members}>
            {(u) => (
              <a
                href={`https://x.com/${u.screen_name}`}
                target="_blank"
                class="flex items-start gap-2 rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <img
                  class="h-9 w-9 rounded-full"
                  src={u.profile_image_url_https}
                  alt={u.screen_name}
                  loading="lazy"
                />
                <div class="min-w-0 flex-1">
                  <div class="truncate text-sm font-medium">
                    {u.name}{' '}
                    <span class="font-normal text-gray-500">
                      @{u.screen_name}
                    </span>
                  </div>
                  <Show when={u.description}>
                    <div class="truncate text-xs text-gray-500">
                      {u.description}
                    </div>
                  </Show>
                </div>
              </a>
            )}
          </For>
          <button
            class="text-xs text-blue-500 hover:underline"
            onClick={() => setExpanded(false)}
          >
            Show less
          </button>
        </div>
      </Show>
    </div>
  )
}

export default function Circles() {
  const [data] = createResource(loadCircleData)
  const [dimension, setDimension] = createSignal<CircleKind>('mutual')

  const circles = createMemo<Circle[]>(() => {
    const d = data()
    if (!d) return []
    switch (dimension()) {
      case 'mutual': {
        const c = mutualCircle(d.following, d.followerIds)
        return c.members.length ? [c] : []
      }
      case 'topic':
        return clusterByTopic(d.following)
      case 'location':
        return clusterByLocation(d.following)
      case 'graph':
        return graphCircles(d.following, d.edges)
    }
  })

  return (
    <div class="mx-auto my-4 w-full flex-1 px-3 text-base text-gray-700 lg:w-[48rem] lg:px-0 dark:text-white">
      <div class="mb-1 flex items-center gap-2">
        <h2 class="text-xl font-semibold">Circles</h2>
        <Show when={data()}>
          <span class="text-sm opacity-60">
            {data()!.following.length} following · {data()!.edges.length} internal
            follow edges
          </span>
        </Show>
      </div>
      <p class="mb-4 text-sm text-gray-500">
        Groups the people you follow. “Follow graph” uses mutual-follow links
        captured passively as you browse Following/Followers pages on x.com —
        the more you browse, the sharper it gets.
      </p>

      {/* Dimension selector */}
      <div class="mb-5 inline-flex rounded-lg border border-gray-200 p-0.5 dark:border-gray-700">
        <For each={DIMENSIONS}>
          {(d) => (
            <button
              class={`rounded-md px-3 py-1.5 text-sm transition ${
                dimension() === d.kind
                  ? 'bg-blue-500 text-white'
                  : 'hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
              onClick={() => setDimension(d.kind)}
            >
              {d.label}
            </button>
          )}
        </For>
      </div>

      <Show
        when={!data.loading}
        fallback={<p class="my-16 text-center text-gray-400">Loading…</p>}
      >
        <Show
          when={data() && data()!.following.length > 0}
          fallback={
            <div class="my-16 text-center text-gray-400">
              <p>No following synced yet.</p>
              <A href="/users" class="text-blue-500 hover:underline">
                Go to Users to sync your following →
              </A>
            </div>
          }
        >
          <Show
            when={circles().length > 0}
            fallback={
              <p class="my-16 text-center text-gray-400">
                <Show
                  when={dimension() === 'graph'}
                  fallback="No circles for this dimension yet."
                >
                  No follow-graph circles yet. Open a few Following pages on
                  x.com (of people you follow) to capture their links, then come
                  back.
                </Show>
              </p>
            }
          >
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <For each={circles()}>
                {(circle) => (
                  <div class="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
                    <div class="mb-3 flex items-center">
                      <span class="flex-1 truncate font-medium" title={circle.label}>
                        {circle.label}
                      </span>
                      <span class="ms-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-800">
                        {circle.members.length}
                      </span>
                    </div>
                    <MemberAvatars members={circle.members} />
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  )
}
