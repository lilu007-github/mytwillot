import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

import { findRecords, getRecord, countRecords, getAllTweetIds } from './tweets'
import { TWEETS_TABLE_NAME_V2 } from './index'
import { setCurrentUserId } from '../storage'
import { NUM_RUNS, makePost, putRaw, resetEnv } from '../test-utils'

const OWNERS = ['111', '222', '333']

// Posts spread across accounts. Tweet ids are shared between owners on
// purpose: the same tweet bookmarked by two accounts is two records.
const arbPosts = fc
  .uniqueArray(
    fc.record({
      owner: fc.constantFrom(...OWNERS),
      tweetId: fc.integer({ min: 1, max: 60 }).map(String),
      folder: fc.constantFrom('', 'a', 'b'),
    }),
    { selector: (p) => `${p.owner}_${p.tweetId}`, maxLength: 60 },
  )
  .map((items) =>
    items.map((p) => makePost(p.owner, p.tweetId, { folder: p.folder })),
  )

describe('Feature: multi-account-support, Property 5: Data Isolation on Query', () => {
  it('queries only ever return the active account’s records', async () => {
    await fc.assert(
      fc
        .asyncProperty(
          arbPosts,
          fc.constantFrom(...OWNERS),
          async (posts, active) => {
            await setCurrentUserId(active)
            await putRaw(TWEETS_TABLE_NAME_V2, posts)
            const own = posts.filter((p) => p.owner_id === active)

            const found = await findRecords('', '', '', '', 1000, '')
            expect(found.every((t) => t.owner_id === active)).toBe(true)
            expect(found.map((t) => t.id).sort()).toEqual(
              own.map((t) => t.id).sort(),
            )

            const ids = await getAllTweetIds()
            expect(ids.sort()).toEqual(own.map((t) => t.tweet_id).sort())

            const counts = await countRecords()
            expect(counts.total).toBe(own.length)
            expect(counts.unsorted).toBe(own.filter((t) => !t.folder).length)

            for (const post of posts) {
              const record = await getRecord(post.tweet_id)
              if (record) {
                expect(record.owner_id).toBe(active)
              }
            }
          },
        )
        .beforeEach(() => resetEnv()),
      { numRuns: NUM_RUNS },
    )
  })
})
