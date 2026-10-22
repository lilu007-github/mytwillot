import { parseTwidCookie } from 'utils/cookie-parser'
import { detectAndSetActiveAccount } from 'utils/account-manager'
import { getLocal } from 'utils/storage'
import {
  createTweet,
  getTweetConversations,
  getTweetDetails,
  likeTweet,
  repostTweet,
  toRecord,
} from 'utils/api/twitter'

//@ts-ignore
import mainWorld from './inject?script&module'
import {
  Host,
  TaskType,
  TimelineEntry,
  TimelineTimelineItem,
  TimelineTweet,
} from 'utils/types'
import { ProductTaskType } from '~/lib/types'
import { AUTOMATION_WEBHOOK_MESSAGE } from '~/lib/webhook'

interface Payload {
  variables: {
    tweet_id: string
    queryId: string
  }
}

function addRandomZeroWidthSpaces(text: string, count: number): string {
  const zeroWidthSpace = '\u200B'
  const spaces = zeroWidthSpace.repeat(count)
  return Math.random() < 0.5 ? `${spaces}${text}` : `${text}${spaces}`
}

const cookies = document.cookie.split(';')
const twidCookie = cookies.find((c) => c.trim().startsWith('twid='))
const twidValue = twidCookie?.split('=').slice(1).join('=')?.trim()
const userId = parseTwidCookie(twidValue)

detectAndSetActiveAccount(userId)

/**
 * NOTE:HMR 无效
 */
const script = document.createElement('script')
script.src = chrome.runtime.getURL(mainWorld)
script.type = 'module'
document.head.prepend(script)

window.addEventListener('message', async (event) => {
  if (event.origin !== Host || event.source !== window) {
    return
  }

  const { data } = event
  if (data.type === ProductTaskType.CreateBookmark) {
    const {
      like,
      repost,
      reply,
      reply_text,
      webhook,
      webhook_url,
      webhook_token,
    } = await getLocal([
      'like',
      'repost',
      'reply',
      'reply_text',
      'webhook',
      'webhook_url',
      'webhook_token',
    ])
    const payload: Payload = data.payload
    const tweet_id = payload.variables.tweet_id
    // true or undefined, default to true
    try {
      if (like !== false) {
        await likeTweet(tweet_id)
      }
      if (repost !== false) {
        await repostTweet(tweet_id)
      }
      if (reply && reply_text) {
        // Avoid being detected as spam
        const modifiedReplyText = addRandomZeroWidthSpaces(reply_text, 5)
        await createTweet({
          text: modifiedReplyText,
          replyTweetId: tweet_id,
        })
      }
      if (webhook && webhook_url && webhook_token) {
        const json = await getTweetDetails(tweet_id)
        const tweet = toRecord(
          json.data.threaded_conversation_with_injections_v2.instructions[0].entries.find(
            (
              i: TimelineEntry<
                TimelineTweet,
                TimelineTimelineItem<TimelineTweet>
              >,
            ) => i.entryId.includes(tweet_id),
          ).content.itemContent as TimelineTweet,
          '',
        )
        const threads = await getTweetConversations(tweet_id, json)
        tweet.conversations = threads
        // Posted by the background worker: it holds the (optional) host
        // permission for the user's endpoint and is not bound by x.com CORS.
        const res = await chrome.runtime.sendMessage({
          type: AUTOMATION_WEBHOOK_MESSAGE,
          url: webhook_url,
          token: webhook_token,
          data: tweet,
        })
        if (!res?.ok) {
          console.error('Twillot webhook failed:', res?.error)
        }
      }
    } catch (error) {
      console.error('Twillot webhook error:', error)
    }
  }
})
