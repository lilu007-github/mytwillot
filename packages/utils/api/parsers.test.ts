/**
 * Parser tests against real captured GraphQL responses in docs/req-res/.
 * Expected counts/ids were derived from the samples independently of the
 * parser code (see each test). If X changes its response shape, refresh the
 * sample and these tests show exactly what broke.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

import { parseTimelineToRecords } from './timeline-parse'
import {
  getUserListRelationship,
  parseUserListToRecords,
  timelineUserToStoredUser,
} from './user-parse'
import { Tweet } from '../types'

const SAMPLES = resolve(__dirname, '../../../docs/req-res')

/** The sample's request URL and its JSON response body. */
function loadSample(name: string): { url: string; json: any } {
  const md = readFileSync(resolve(SAMPLES, `${name}.md`), 'utf8')
  const url = md.match(/'(https:\/\/x\.com\/i\/api\/graphql\/[^']*)'/)![1]
  const json = JSON.parse(md.match(/```json\n([\s\S]*?)\n```/)![1])
  return { url, json }
}

/** All samples were captured on this account's own profile. */
const OWNER = '2751923820'

function expectWellFormedTweets(docs: Tweet[], category: string) {
  const now = Date.now() / 1000
  for (const doc of docs) {
    expect(doc.tweet_id).toMatch(/^\d+$/)
    expect(doc.owner_id).toBe(OWNER)
    expect(doc.category_name).toBe(category)
    expect(doc.screen_name).toBeTruthy()
    expect(typeof doc.full_text).toBe('string')
    // X launched in 2006; anything else means a bad date parse.
    expect(doc.created_at).toBeGreaterThan(1_140_000_000)
    expect(doc.created_at).toBeLessThan(now)
    expect(doc.sort_index).toBe(String(doc.created_at))
  }
  expect(new Set(docs.map((d) => d.id)).size).toBe(docs.length)
}

describe('parseTimelineToRecords (real samples)', () => {
  it('Likes: every liked tweet, namespaced ids, bottom cursor', () => {
    const { json } = loadSample('likes')
    const { docs, cursor } = parseTimelineToRecords(json, 'likes', OWNER)

    expect(docs).toHaveLength(20)
    expectWellFormedTweets(docs, 'likes')
    expect(docs[0]).toMatchObject({
      id: `likes_${OWNER}_1811044379643293932`,
      tweet_id: '1811044379643293932',
      screen_name: 'javayhu',
    })
    expect(cursor).toBeTruthy()
  })

  it('Bookmarks: same entries keep the historical owner_tweet id', () => {
    // No Bookmarks sample is captured; the instructions have the same shape,
    // so re-home the Likes instructions under the bookmarks key path.
    const { json } = loadSample('likes')
    const bookmarksJson = {
      data: {
        bookmark_timeline_v2: json.data.user.result.timeline_v2,
      },
    }
    const { docs } = parseTimelineToRecords(bookmarksJson, 'bookmarks', OWNER)

    expect(docs).toHaveLength(20)
    expectWellFormedTweets(docs, 'bookmarks')
    expect(docs[0].id).toBe(`${OWNER}_1811044379643293932`)
  })

  it('UserTweets: pinned tweet, plain entries and own tweets in conversation modules', () => {
    const { json } = loadSample('posts')
    const { docs, cursor } = parseTimelineToRecords(json, 'posts', OWNER)
    const ids = docs.map((d) => d.tweet_id)

    // 1 pinned + 16 timeline items + 5 own tweets inside conversation
    // modules (the first module is a "Who to follow" user module).
    expect(docs).toHaveLength(22)
    expectWellFormedTweets(docs, 'posts')
    expect(ids).toContain('1777325561947549814') // pinned
    expect(ids).toEqual(
      expect.arrayContaining([
        '1809532535006982417',
        '1809535792601264617',
        '1808749810960453835',
        '1808885668535488754',
        '1808887677519073736',
      ]),
    )
    expect(docs.every((d) => d.user_id === OWNER)).toBe(true)
    expect(cursor).toBeTruthy()
  })

  it('replies: keeps only the owner’s replies', () => {
    const { json } = loadSample('posts')
    const { docs } = parseTimelineToRecords(json, 'replies', OWNER)

    expect(docs.map((d) => d.tweet_id).sort()).toEqual([
      '1808885668535488754',
      '1808887677519073736',
      '1809535792601264617',
    ])
    expect(docs.every((d) => d.is_reply && d.user_id === OWNER)).toBe(true)
  })

  it('drops tweets by other accounts inside conversation modules', () => {
    const { json } = loadSample('posts')
    // Pretend the profile belongs to someone else: module tweets by OWNER
    // are now "other people's" context tweets and must not be attributed.
    const { docs } = parseTimelineToRecords(json, 'replies', '999')
    expect(docs).toEqual([])
  })

  it('returns nothing (and does not throw) for unexpected payloads', () => {
    for (const json of [null, {}, { data: {} }, { errors: [{}] }]) {
      expect(parseTimelineToRecords(json, 'likes', OWNER)).toEqual({
        docs: [],
        cursor: '',
      })
    }
  })
})

describe('user lists (real samples)', () => {
  it.each([
    ['followers', 'follower', 50, '878285982092546048', 'Qonyyyy'],
    ['following', 'following', 50, '1490557435706179585', '100xTools'],
    [
      'followers-verified',
      'follower',
      20,
      '1752346519758405632',
      'pacovermeulen',
    ],
  ] as const)(
    '%s → %s records',
    (sample, relationship, count, firstRestId, firstScreenName) => {
      const { url, json } = loadSample(sample)
      expect(getUserListRelationship(url)).toBe(relationship)

      const docs = parseUserListToRecords(json, relationship, OWNER, 1000)
      expect(docs).toHaveLength(count)
      expect(new Set(docs.map((d) => d.id)).size).toBe(count)
      expect(docs[0]).toMatchObject({
        id: `${OWNER}_${relationship}_${firstRestId}`,
        rest_id: firstRestId,
        screen_name: firstScreenName,
        owner_id: OWNER,
        relationship,
        synced_at: 1000,
      })
      for (const doc of docs) {
        expect(doc.rest_id).toMatch(/^\d+$/)
        expect(doc.screen_name).toBeTruthy()
        expect(doc.profile_image_url_https).toMatch(/^https:\/\//)
        expect(typeof doc.followers_count).toBe('number')
      }
    },
  )

  it('ignores operations that are not follower/following lists', () => {
    expect(getUserListRelationship(loadSample('likes').url)).toBeNull()
    expect(getUserListRelationship(loadSample('posts').url)).toBeNull()
  })

  it('returns nothing for unexpected payloads', () => {
    for (const json of [null, {}, { data: {} }]) {
      expect(parseUserListToRecords(json, 'follower', OWNER, 0)).toEqual([])
    }
  })
})

describe('timelineUserToStoredUser', () => {
  const legacy = {
    name: 'Legacy Name',
    screen_name: 'legacy_sn',
    profile_image_url_https: 'https://img/legacy.jpg',
    created_at: 'Mon Jan 01 00:00:00 +0000 2018',
    description: 'bio',
    followers_count: 1,
    friends_count: 2,
    statuses_count: 3,
    location: '',
  }

  it('reads the newer core/avatar shape first', () => {
    const user = timelineUserToStoredUser(
      {
        user_results: {
          result: {
            rest_id: '7',
            is_blue_verified: true,
            core: {
              name: 'Core Name',
              screen_name: 'core_sn',
              created_at: 'Tue Jan 02 00:00:00 +0000 2018',
            },
            avatar: { image_url: 'https://img/core.jpg' },
            legacy,
          },
        },
      } as any,
      OWNER,
      'following',
      5,
    )
    expect(user).toMatchObject({
      name: 'Core Name',
      screen_name: 'core_sn',
      profile_image_url_https: 'https://img/core.jpg',
      created_at: 'Tue Jan 02 00:00:00 +0000 2018',
      is_blue_verified: true,
    })
  })

  it('falls back to legacy fields for older responses', () => {
    const user = timelineUserToStoredUser(
      { user_results: { result: { rest_id: '7', legacy } } } as any,
      OWNER,
      'follower',
      5,
    )
    expect(user).toMatchObject({
      name: 'Legacy Name',
      screen_name: 'legacy_sn',
      profile_image_url_https: 'https://img/legacy.jpg',
      is_blue_verified: false,
    })
  })

  it('returns null for unavailable users', () => {
    expect(
      timelineUserToStoredUser(
        { user_results: { result: { __typename: 'UserUnavailable' } } } as any,
        OWNER,
        'follower',
        5,
      ),
    ).toBeNull()
  })
})
