/**
 * AI batch actions: auto-organize bookmarks into folders (smartTagging) and
 * generate summaries + keyword tags (smartSummarize). Both call the user's
 * own LLM provider directly (key stored locally), cap work per run, persist
 * empty results as "tried" sentinels, and survive a transient rate limit.
 */
import { iterate, upsertRecords } from 'utils/db/tweets'
import { getCurrentUserId } from 'utils/storage'
import { classifyTweet, summarizeTweet, getAISettings } from 'utils/ai/classify'

import dataStore, { mutateStore } from './store'
import { folderState, refreshFolderCounts } from '~/stores/folders'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const BATCH_SIZE = 20 // 每20个请求为一个等级

/**
 * Run an AI call, waiting out a single rate-limit hit before giving up.
 * A transient 429 shouldn't abort a whole batch run; a second one in a row
 * propagates so the caller can stop cleanly.
 */
async function withRateLimitRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error: any) {
    if (error?.name !== 'RateLimitedError') {
      throw error
    }
    console.warn('AI provider rate limited; retrying once in 30s')
    await sleep(30_000)
    return await fn()
  }
}

export async function smartTagging() {
  const [store, setStore] = dataStore

  const uid = await getCurrentUserId()
  if (!uid) {
    alert('Please login to use AI auto organizing')
    return
  }

  const settings = await getAISettings()
  if (!settings.apiKey) {
    alert(
      'Add your AI API key in Settings to use AI auto organizing. ' +
        'Your key is stored locally and sent directly to your chosen provider.',
    )
    location.hash = '#/settings'
    return
  }

  // Folders live in folderState (stores/folders), not the legacy global store.
  const folders = folderState.folders.map((i) => i.name)
  if (folders.length < 3) {
    alert('Please create at least 3 folders to use AI auto organizing')
    return
  }

  if (store.isTagging) {
    return
  }

  // Cap a single run so a huge library doesn't spend unboundedly.
  const maxTweets = 1000
  let offset = 0
  let processed = 0
  setStore('isTagging', true)

  while (processed < maxTweets && store.isTagging) {
    let tweets: typeof store.tweets
    try {
      // 只查询 null 或 undefined，设置为空表示 ai 分类过但是找不到对应文件夹
      tweets = await iterate(
        (t) => typeof t.folder !== 'string',
        BATCH_SIZE,
        offset,
      )
    } catch (error) {
      console.error('Error fetching unclassified tweets:', error)
      break
    }

    if (tweets.length === 0) {
      console.log('No more unclassified tweets')
      break
    }
    offset += tweets.length

    for (const tweet of tweets) {
      if (!store.isTagging) {
        break
      }

      try {
        const text = tweet.quoted_tweet
          ? tweet.full_text + '\n' + tweet.quoted_tweet.full_text
          : tweet.full_text

        const folder = await withRateLimitRetry(() =>
          classifyTweet({ text, folders, settings }),
        )
        // Persist even when '' so we don't re-classify tweets that fit nowhere.
        tweet.folder = folder
        await upsertRecords([tweet], true)
        if (folder) {
          mutateStore((state) => {
            if (state.totalCount) {
              state.totalCount.unsorted -= 1
            }
          })
        }
        console.log(`Tweet ${tweet.tweet_id} classified into ${folder || '—'}`)
      } catch (error: any) {
        if (error?.name === 'RateLimitedError') {
          setStore('isTagging', false)
          await refreshFolderCounts()
          alert('Your AI provider is rate limiting requests. Try again later.')
          return
        }
        if (error?.message === 'missing-api-key') {
          setStore('isTagging', false)
          await refreshFolderCounts()
          location.hash = '#/settings'
          return
        }
        console.error(`Error classifying tweet ${tweet.tweet_id}:`, error)
      }

      processed += 1
      await sleep(400)
    }
  }

  setStore('isTagging', false)
  await refreshFolderCounts()
}

/**
 * Generate a one-line AI summary for each bookmark that lacks one and persist
 * it onto the record (`ai_summary`). All Obsidian export paths then include it
 * in note frontmatter. Mirrors smartTagging: capped per run, rate-limit aware,
 * prompts for a key when missing.
 */
export async function smartSummarize() {
  const [store, setStore] = dataStore
  const settings = await getAISettings()
  if (!settings.apiKey) {
    alert(
      'Add your AI API key in Settings to generate summaries. ' +
        'Your key is stored locally and sent directly to your chosen provider.',
    )
    location.hash = '#/settings'
    return
  }

  if (store.isSummarizing) {
    return
  }

  const maxTweets = 1000
  let offset = 0
  let processed = 0
  setStore('isSummarizing', true)

  while (processed < maxTweets && store.isSummarizing) {
    let tweets: typeof store.tweets
    try {
      // Only tweets without a summary yet (undefined). '' means "tried, empty".
      tweets = await iterate(
        (t) => typeof t.ai_summary !== 'string',
        BATCH_SIZE,
        offset,
      )
    } catch (error) {
      console.error('Error fetching un-summarized tweets:', error)
      break
    }

    if (tweets.length === 0) {
      break
    }
    offset += tweets.length

    for (const tweet of tweets) {
      if (!store.isSummarizing) {
        break
      }

      try {
        const text = tweet.quoted_tweet
          ? tweet.full_text + '\n' + tweet.quoted_tweet.full_text
          : tweet.full_text

        const { summary, keywords } = await withRateLimitRetry(() =>
          summarizeTweet({ text, settings }),
        )
        // Persist even '' so we don't retry tweets the model returned nothing for.
        tweet.ai_summary = summary
        tweet.ai_tags = keywords
        await upsertRecords([tweet], true)
        // Reflect into the live list so the UI can show it immediately.
        mutateStore((state) => {
          const item = state.tweets.find((t) => t.tweet_id === tweet.tweet_id)
          if (item) {
            item.ai_summary = summary
            item.ai_tags = keywords
          }
        })
      } catch (error: any) {
        if (error?.name === 'RateLimitedError') {
          setStore('isSummarizing', false)
          alert('Your AI provider is rate limiting requests. Try again later.')
          return
        }
        if (error?.message === 'missing-api-key') {
          setStore('isSummarizing', false)
          location.hash = '#/settings'
          return
        }
        console.error(`Error summarizing tweet ${tweet.tweet_id}:`, error)
      }

      processed += 1
      await sleep(400)
    }
  }

  setStore('isSummarizing', false)
}
