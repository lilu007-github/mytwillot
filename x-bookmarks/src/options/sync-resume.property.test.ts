import { describe, it, expect, vi } from 'vitest'
import fc from 'fast-check'

import {
  NUM_RUNS,
  getAllRaw,
  makePost,
  putRaw,
  resetEnv,
} from 'utils/test-utils'
import { getBookmarks } from 'utils/api/twitter'
import { TWEETS_TABLE_NAME_V2 } from 'utils/db/index'
import { StorageKeys, getStorageKey } from 'utils/storage'
import { resumeSync } from 'utils/sync-engine'
import { syncAllBookmarks } from './sync-bookmarks'

vi.mock('utils/api/twitter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('utils/api/twitter')>()),
  getBookmarks: vi.fn(),
  toRecord: (itemContent: { tweet_id: string }) =>
    makePost('', itemContent.tweet_id),
}))

const OWNER = '111'
const mockedGetBookmarks = vi.mocked(getBookmarks)

/** Page k of the server timeline: `size` tweets followed by cursor `c{k}`. */
function page(k: number, size: number) {
  const items = Array.from({ length: size }, (_, i) => ({
    sortIndex: String(1e6 - k * 100 - i),
    content: {
      entryType: 'TimelineTimelineItem',
      itemContent: { tweet_id: `${k}${String(i).padStart(2, '0')}` },
    },
  }))
  return {
    data: {
      bookmark_timeline_v2: {
        timeline: {
          instructions: [
            {
              type: 'TimelineAddEntries',
              entries: [
                ...items,
                {
                  content: {
                    entryType: 'TimelineTimelineCursor',
                    value: `c${k}`,
                  },
                },
              ],
            },
          ],
        },
      },
    },
  }
}

/** Serve pages by cursor ('' / undefined → page 0); optionally fail one page. */
function serveTimeline(pageSizes: number[], failAtPage = -1) {
  const requested: (string | undefined)[] = []
  mockedGetBookmarks.mockImplementation(async (cursor?: string) => {
    requested.push(cursor)
    const k = cursor ? Number(cursor.slice(1)) + 1 : 0
    if (k === failAtPage) {
      throw new Error('network interrupted')
    }
    return page(k, pageSizes[k] ?? 0) as any
  })
  return requested
}

async function drain(gen: AsyncGenerator<unknown>) {
  for await (const _ of gen) {
    // consume
  }
}

async function persistedCursor() {
  const key = getStorageKey(StorageKeys.Bookmark_Cursor, OWNER)
  return (await chrome.storage.local.get(key))[key]
}

describe('Feature: multi-account-support, Property 8: Sync Resume from Last Cursor', () => {
  const arbCase = fc
    .array(fc.integer({ min: 1, max: 5 }), { minLength: 2, maxLength: 8 })
    .chain((sizes) =>
      fc.tuple(
        fc.constant(sizes),
        fc.integer({ min: 1, max: sizes.length - 1 }),
      ),
    )

  it('persists the cursor of page N-1 and resumes from it, not from the start', async () => {
    await fc.assert(
      fc
        .asyncProperty(arbCase, async ([sizes, n]) => {
          serveTimeline(sizes, n)
          await expect(drain(syncAllBookmarks(true))).rejects.toThrow(
            'network interrupted',
          )
          expect(await persistedCursor()).toBe(`c${n - 1}`)

          await resumeSync(OWNER)
          expect(await persistedCursor()).toBe(`c${n - 1}`)

          const requested = serveTimeline(sizes)
          await drain(syncAllBookmarks(true))
          expect(requested[0]).toBe(`c${n - 1}`)
          expect(requested).not.toContain(undefined)
        })
        .beforeEach(() => resetEnv(OWNER)),
      { numRuns: NUM_RUNS },
    )
  })

  it('keeps bookmarks fetched before the interruption after the resumed run', async () => {
    await fc.assert(
      fc
        .asyncProperty(arbCase, async ([sizes, n]) => {
          serveTimeline(sizes, n)
          await expect(drain(syncAllBookmarks(true))).rejects.toThrow()
          serveTimeline(sizes)
          await drain(syncAllBookmarks(true))

          const stored = await getAllRaw(TWEETS_TABLE_NAME_V2)
          const total = sizes.reduce((a, b) => a + b, 0)
          expect(stored).toHaveLength(total)
        })
        .beforeEach(() => resetEnv(OWNER)),
      { numRuns: NUM_RUNS },
    )
  })

  it('still removes server-deleted bookmarks after a full sync from the start', async () => {
    await fc.assert(
      fc
        .asyncProperty(
          arbCase,
          fc.integer({ min: 1, max: 5 }),
          async ([sizes], staleCount) => {
            const stale = Array.from({ length: staleCount }, (_, i) =>
              makePost(OWNER, `9${i}99`),
            )
            await putRaw(TWEETS_TABLE_NAME_V2, stale)
            serveTimeline(sizes)
            await drain(syncAllBookmarks(true))

            const ids = (await getAllRaw(TWEETS_TABLE_NAME_V2)).map((t) => t.id)
            expect(ids).toHaveLength(sizes.reduce((a, b) => a + b, 0))
            stale.forEach((t) => expect(ids).not.toContain(t.id))
          },
        )
        .beforeEach(() => resetEnv(OWNER)),
      { numRuns: NUM_RUNS },
    )
  })
})
