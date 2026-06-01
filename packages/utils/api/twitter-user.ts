import { Endpoint, TimelineInstructions, getEndpoint } from '../types'
import { flatten, request } from './twitter-base'
import {
  COMMON_FEATURES,
  FOLLOWERS_FEATURES,
  FOLLOWERS_FIELD_TOGGLES,
} from './twitter-features'
import {
  getCapturedGraphQLRequestTemplate,
  getCapturedQueryId,
  parseGraphQLRequestTemplate,
  type GraphQLRequestTemplate,
} from '../storage'

/**
 * Resolve the endpoint URL for a GraphQL operation, preferring the query id
 * captured live from x.com (Twitter rotates these ids, breaking hardcoded
 * values). Falls back to the hardcoded `Endpoint` value when nothing has been
 * captured yet.
 */
async function resolveEndpoint(
  operationName: string,
  fallback: Endpoint,
): Promise<string> {
  const captured = await getCapturedQueryId(operationName)
  return captured ? getEndpoint(captured, operationName) : fallback
}

async function buildUserListRequest(
  operationName: 'Followers' | 'Following',
  fallback: Endpoint,
  userId: string,
  cursor?: string,
): Promise<string> {
  const template =
    (await getSuccessfulPageRequestTemplate(operationName)) ??
    (await getCapturedGraphQLRequestTemplate(operationName))
  const endpoint = template
    ? getEndpoint(template.queryId, operationName)
    : await resolveEndpoint(operationName, fallback)

  const query = flatten({
    variables: buildUserListVariables(template, userId, cursor),
    features: template?.features ?? FOLLOWERS_FEATURES,
    ...(template
      ? template.fieldToggles
        ? { fieldToggles: template.fieldToggles }
        : {}
      : { fieldToggles: FOLLOWERS_FIELD_TOGGLES }),
  })

  return `${endpoint}?${query}`
}

async function getSuccessfulPageRequestTemplate(
  operationName: 'Followers' | 'Following',
): Promise<GraphQLRequestTemplate | undefined> {
  if (!chrome?.scripting || !chrome?.tabs) {
    return undefined
  }

  const tabs = await chrome.tabs.query({
    url: ['https://x.com/*', 'https://*.x.com/*'],
    currentWindow: true,
  })
  const tab =
    tabs.find((item) => item.active && item.url?.includes(`/${operationName.toLowerCase()}`)) ??
    tabs.find((item) => item.url?.includes(`/${operationName.toLowerCase()}`)) ??
    tabs.find((item) => item.active) ??
    tabs[0]

  if (!tab?.id) {
    return undefined
  }

  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      args: [operationName],
      func: (name: 'Followers' | 'Following') => {
        return performance
          .getEntriesByType('resource')
          .filter((entry) => entry.name.includes(`/i/api/graphql/`) && entry.name.includes(`/${name}?`))
          .map((entry: PerformanceResourceTiming) => ({
            name: entry.name,
            startTime: entry.startTime,
            responseStatus: (entry as any).responseStatus,
            transferSize: entry.transferSize,
            encodedBodySize: entry.encodedBodySize,
          }))
          .filter((entry) => entry.responseStatus !== 404)
          .filter((entry) => entry.responseStatus === undefined || entry.responseStatus === 200)
          .filter((entry) => entry.transferSize > 0 || entry.encodedBodySize > 0)
          .sort((a, b) => b.startTime - a.startTime)
          .at(0)?.name
      },
    })

    if (!result) {
      return undefined
    }

    const match = result.match(/\/i\/api\/graphql\/([^/]+)\/([^/?]+)/)
    if (!match) {
      return undefined
    }

    const [, queryId, capturedOperationName] = match
    if (capturedOperationName !== operationName) {
      return undefined
    }

    return parseGraphQLRequestTemplate(result, queryId, capturedOperationName) ?? undefined
  } catch (err) {
    console.warn('Failed to read x.com GraphQL performance entries', err)
    return undefined
  }
}

function buildUserListVariables(
  template: GraphQLRequestTemplate | undefined,
  userId: string,
  cursor?: string,
) {
  const variables = {
    ...(template?.variables ?? {
      count: 100,
      includePromotedContent: false,
    }),
    userId,
  }

  if (cursor) {
    variables.cursor = cursor
  } else {
    delete variables.cursor
  }

  return variables
}

export interface UserDataResponse {
  data: {
    user: {
      result: {
        timeline: {
          timeline: {
            instructions: TimelineInstructions
          }
        }
        __typename: 'User'
      }
    }
  }
}

export interface FollowersResponse {
  data: {
    user: {
      result: {
        timeline: {
          timeline: {
            instructions: TimelineInstructions
          }
        }
        __typename: 'User'
      }
    }
  }
}

export async function getPosts(userId: string, cursor?: string) {
  const variables = {
    userId,
    count: 100,
    cursor: '',
    includePromotedContent: true,
    withQuickPromoteEligibilityTweetFields: true,
    withVoice: true,
    withV2Timeline: true,
  }
  if (cursor) {
    variables.cursor = cursor
  }
  const query = flatten({
    variables,
    features: COMMON_FEATURES,
    fieldToggles: { withArticlePlainText: false },
  })
  const json = await request(`${Endpoint.USER_TWEETS}?${query}`, {
    body: null,
    method: 'GET',
  })

  return json as UserDataResponse
}

export async function getReplies(userId: string, cursor?: string) {
  const variables = {
    userId,
    count: 100,
    cursor: '',
    includePromotedContent: true,
    withCommunity: true,
    withVoice: true,
    withV2Timeline: true,
  }
  if (cursor) {
    variables.cursor = cursor
  }
  const query = flatten({
    variables,
    features: {
      rweb_tipjar_consumption_enabled: true,
      responsive_web_graphql_exclude_directive_enabled: true,
      verified_phone_label_enabled: false,
      creator_subscriptions_tweet_preview_api_enabled: true,
      responsive_web_graphql_timeline_navigation_enabled: true,
      responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
      communities_web_enable_tweet_community_results_fetch: true,
      c9s_tweet_anatomy_moderator_badge_enabled: true,
      articles_preview_enabled: true,
      responsive_web_edit_tweet_api_enabled: true,
      graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
      view_counts_everywhere_api_enabled: true,
      longform_notetweets_consumption_enabled: true,
      responsive_web_twitter_article_tweet_consumption_enabled: true,
      tweet_awards_web_tipping_enabled: false,
      creator_subscriptions_quote_tweet_preview_enabled: false,
      freedom_of_speech_not_reach_fetch_enabled: true,
      standardized_nudges_misinfo: true,
      tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled:
        true,
      rweb_video_timestamps_enabled: true,
      longform_notetweets_rich_text_read_enabled: true,
      longform_notetweets_inline_media_enabled: true,
      responsive_web_enhance_cards_enabled: false,
    },
    fieldToggles: { withArticlePlainText: false },
  })
  const json = await request(`${Endpoint.USER_TWEETS_AND_REPLIES}?${query}`, {
    body: null,
    method: 'GET',
  })

  return json as UserDataResponse
}

export async function getMedia(userId: string, cursor?: string) {
  const variables = {
    userId,
    count: 100,
    cursor: '',
    includePromotedContent: false,
    withClientEventToken: false,
    withBirdwatchNotes: false,
    withVoice: true,
    withV2Timeline: true,
  }
  if (cursor) {
    variables.cursor = cursor
  }
  const query = flatten({
    variables,
    features: {
      rweb_tipjar_consumption_enabled: true,
      responsive_web_graphql_exclude_directive_enabled: true,
      verified_phone_label_enabled: false,
      creator_subscriptions_tweet_preview_api_enabled: true,
      responsive_web_graphql_timeline_navigation_enabled: true,
      responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
      communities_web_enable_tweet_community_results_fetch: true,
      c9s_tweet_anatomy_moderator_badge_enabled: true,
      articles_preview_enabled: true,
      responsive_web_edit_tweet_api_enabled: true,
      graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
      view_counts_everywhere_api_enabled: true,
      longform_notetweets_consumption_enabled: true,
      responsive_web_twitter_article_tweet_consumption_enabled: true,
      tweet_awards_web_tipping_enabled: false,
      creator_subscriptions_quote_tweet_preview_enabled: false,
      freedom_of_speech_not_reach_fetch_enabled: true,
      standardized_nudges_misinfo: true,
      tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled:
        true,
      rweb_video_timestamps_enabled: true,
      longform_notetweets_rich_text_read_enabled: true,
      longform_notetweets_inline_media_enabled: true,
      responsive_web_enhance_cards_enabled: false,
    },
    fieldToggles: { withArticlePlainText: false },
  })
  const json = await request(`${Endpoint.USER_MEDIA}?${query}`, {
    body: null,
    method: 'GET',
  })

  return json as UserDataResponse
}

export async function getLikes(userId: string, cursor?: string) {
  const variables = {
    userId,
    count: 100,
    cursor: '',
    includePromotedContent: false,
    withClientEventToken: false,
    withBirdwatchNotes: false,
    withVoice: true,
    withV2Timeline: true,
  }
  if (cursor) {
    variables.cursor = cursor
  }
  const query = flatten({
    variables,
    features: COMMON_FEATURES,
    fieldToggles: { withArticlePlainText: false },
  })
  const json = await request(`${Endpoint.LIKES}?${query}`, {
    body: null,
    method: 'GET',
  })

  return json as UserDataResponse
}

export async function getFollowers(userId: string, cursor?: string) {
  const url = await buildUserListRequest(
    'Followers',
    Endpoint.FOLLOWERS,
    userId,
    cursor,
  )
  const json = await request(url, {
    body: null,
    method: 'GET',
  }, {
    useXPageContext: true,
  })

  return json as FollowersResponse
}

export async function getFollowing(userId: string, cursor?: string) {
  const url = await buildUserListRequest(
    'Following',
    Endpoint.FOLLOWING,
    userId,
    cursor,
  )
  const json = await request(url, {
    body: null,
    method: 'GET',
  }, {
    useXPageContext: true,
  })

  return json as FollowersResponse
}
