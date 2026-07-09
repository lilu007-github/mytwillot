import { For, Show } from 'solid-js'
import { A } from '@solidjs/router'

import { Content } from './Tweet'
import { Host, type Tweet } from 'utils/types'
import { IconBookmark, IconExpand, IconQuote } from './Icons'
import FolderSelect from './FolderSelect'
import TagSelect from './TagSelect'
import { removeBookmark } from '../options/handlers'
import dataStore from '../options/store'

interface TweetListProps {
  tweets: Tweet[]
  keyword?: string
  isSidePanel?: boolean
  /** Show the un-bookmark action (bookmarks view only). */
  showBookmarkAction?: boolean
}

/**
 * Shared renderer for a list of tweet cards. Used by the bookmarks Home view
 * and the per-category (likes/posts/replies/media) views.
 */
export default function TweetList(props: TweetListProps) {
  const [, setStore] = dataStore
  return (
    <For each={props.tweets}>
      {(tweet, index) => (
        <div class="rounded-md p-2 hover:bg-[#121212] hover:bg-opacity-5">
          <div class="flex flex-shrink-0 pb-0">
            <div class="flex w-full items-start">
              <div class="mr-2">
                <A href={`/?q=from:${tweet.screen_name}`}>
                  <img
                    class="inline-block h-10 w-10 rounded-full"
                    src={tweet.avatar_url.replace('_normal', '_x96')}
                    alt="avatar"
                  />
                </A>
              </div>
              <p class="flex-1 cursor-pointer overflow-hidden overflow-ellipsis whitespace-nowrap text-base font-bold leading-6">
                <span data-text={`${Host}/${tweet.screen_name}/`}>
                  {tweet.username}&nbsp;
                </span>
                <span class="ml-1 text-sm font-normal leading-5 text-[rgb(83,100,113)] dark:text-gray-500">
                  <span data-text={`${Host}/${tweet.screen_name}/`}>
                    @{tweet.screen_name} ·{' '}
                  </span>
                  <span
                    class="dark:text-gray-500"
                    data-text={`${Host}/${tweet.screen_name}/status/${tweet.tweet_id}`}
                  >
                    {new Date(tweet.created_at * 1000).toLocaleString()}
                  </span>
                </span>
              </p>
              <Show when={!props.isSidePanel}>
                <div class="flex items-center justify-end gap-4 *:cursor-pointer">
                  <span
                    title="Read in Zen mode"
                    onClick={(e) => {
                      e.stopPropagation()
                      setStore('selectedTweet', index())
                    }}
                  >
                    <IconExpand />
                  </span>
                  <span>
                    <TagSelect tweet={tweet} />
                  </span>
                  <span>
                    <FolderSelect tweet={tweet} />
                  </span>
                  <Show when={props.showBookmarkAction}>
                    <span onClick={() => removeBookmark(tweet.tweet_id)}>
                      <IconBookmark cls="h-5 w-5" />
                    </span>
                  </Show>
                </div>
              </Show>
            </div>
          </div>
          <div class="-mt-2 pl-12 text-[rgb(15,20,25)] dark:text-white">
            <Content tweet={tweet} keyword={props.keyword} />
            <Show when={tweet.conversations}>
              <For each={tweet.conversations}>
                {(conversation) => (
                  <Show when={conversation}>
                    <Content tweet={conversation} />
                  </Show>
                )}
              </For>
            </Show>
            <Show when={tweet.quoted_tweet}>
              <div class="relative inline-flex w-full items-center justify-center">
                <hr class="my-8 h-1 w-64 rounded border-0 bg-gray-200 dark:bg-gray-700" />
                <div class="absolute left-1/2 -translate-x-1/2 px-4">
                  <IconQuote />
                </div>
              </div>
              <Content tweet={tweet.quoted_tweet} isQuoted={true} />
            </Show>
          </div>
        </div>
      )}
    </For>
  )
}
