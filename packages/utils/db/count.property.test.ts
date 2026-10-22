import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

import { countRecords } from './tweets'
import { countUnsorted } from './folders'
import { TWEETS_TABLE_NAME_V2 } from './index'
import { NUM_RUNS, makePost, putRaw, resetEnv } from '../test-utils'

const OWNER = '111'

// Passive capture stores likes/posts/replies/media next to bookmarks in the
// same store. Records without category_name predate v23 and are bookmarks.
const arbCategory = fc.constantFrom<string | undefined>(
  undefined,
  'bookmarks',
  'likes',
  'posts',
  'replies',
  'media',
)

const arbPosts = fc
  .array(
    fc.record({
      category: arbCategory,
      folder: fc.constantFrom<string | undefined>(undefined, '', 'a'),
      has_image: fc.boolean(),
      has_video: fc.boolean(),
      is_long_text: fc.boolean(),
    }),
    { maxLength: 40 },
  )
  .map((items) =>
    items.map(({ category, ...rest }, i) => {
      const post = makePost(OWNER, String(i + 1), rest)
      // makePost defaults to bookmarks; model legacy records without one.
      if (category === undefined) {
        delete post.category_name
      } else {
        post.category_name = category as any
      }
      return post
    }),
  )

const isBookmark = (p: { category_name?: string }) =>
  (p.category_name || 'bookmarks') === 'bookmarks'

describe('Bookmark counts ignore other captured categories', () => {
  it('countRecords counts only bookmark records', async () => {
    await fc.assert(
      fc
        .asyncProperty(arbPosts, async (posts) => {
          await putRaw(TWEETS_TABLE_NAME_V2, posts)
          const bookmarks = posts.filter(isBookmark)

          const counts = await countRecords()
          expect(counts.total).toBe(bookmarks.length)
          expect(counts.unsorted).toBe(
            bookmarks.filter((p) => !p.folder).length,
          )
          expect(counts.image).toBe(bookmarks.filter((p) => p.has_image).length)
          expect(counts.video).toBe(bookmarks.filter((p) => p.has_video).length)
          expect(counts.long_text).toBe(
            bookmarks.filter((p) => p.is_long_text).length,
          )
        })
        .beforeEach(() => resetEnv(OWNER)),
      { numRuns: NUM_RUNS },
    )
  })

  it('countUnsorted("bookmark") agrees with countRecords().unsorted', async () => {
    await fc.assert(
      fc
        .asyncProperty(arbPosts, async (posts) => {
          await putRaw(TWEETS_TABLE_NAME_V2, posts)
          expect(await countUnsorted('bookmark')).toBe(
            (await countRecords()).unsorted,
          )
        })
        .beforeEach(() => resetEnv(OWNER)),
      { numRuns: NUM_RUNS },
    )
  })
})
