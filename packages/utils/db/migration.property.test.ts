import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

import {
  DB_NAME,
  CONFIGS_TABLE_NAME_V2,
  FOLDERS_TABLE_NAME,
  TWEETS_TABLE_NAME_V2,
  USERS_TABLE_NAME,
  getFolderId,
} from './index'
import { Folder } from '../types'
import { NUM_RUNS, getAllRaw, makePost, resetEnv } from '../test-utils'

const OWNERS = ['111', '222']

const arbLegacyName = fc.string({ minLength: 1, maxLength: 20 })

const arbLegacyState = fc.record({
  // Legacy OptionName.FOLDER config per owner (unique names, as the old UI enforced).
  legacy: fc.record({
    '111': fc.uniqueArray(arbLegacyName, { maxLength: 8 }),
    '222': fc.uniqueArray(arbLegacyName, { maxLength: 8 }),
  }),
  posts: fc.uniqueArray(
    fc.record({
      owner: fc.constantFrom(...OWNERS),
      tweetId: fc.integer({ min: 1, max: 50 }).map(String),
      folder: fc.option(arbLegacyName, { nil: undefined }),
    }),
    { selector: (p) => `${p.owner}_${p.tweetId}`, maxLength: 20 },
  ),
  users: fc.uniqueArray(
    fc.record({
      owner: fc.constantFrom(...OWNERS),
      restId: fc.integer({ min: 1, max: 50 }).map(String),
      folder: fc.constantFrom(undefined, '', 'Friends', 'Work', 'AI', 'news'),
    }),
    { selector: (u) => `${u.owner}_${u.restId}`, maxLength: 20 },
  ),
})

type LegacyState =
  typeof arbLegacyState extends fc.Arbitrary<infer T> ? T : never

/**
 * Create a pre-v22 database (no folders store yet). The next openDb() call
 * (via getAllRaw) upgrades it through the real upgradeDb, which runs
 * migrateToV22 inside onupgradeneeded.
 */
async function seedLegacyDb(state: LegacyState) {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 21)
    request.onupgradeneeded = () => {
      const db = request.result
      const settings = db.createObjectStore(CONFIGS_TABLE_NAME_V2, {
        keyPath: 'id',
      })
      const posts = db.createObjectStore(TWEETS_TABLE_NAME_V2, {
        keyPath: 'id',
      })
      const users = db.createObjectStore(USERS_TABLE_NAME, { keyPath: 'id' })
      for (const owner of OWNERS) {
        settings.put({
          id: `${owner}_folder`,
          owner_id: owner,
          option_name: 'folder',
          option_value: state.legacy[owner],
          updated_at: 0,
        })
      }
      state.posts.forEach((p) =>
        posts.put(makePost(p.owner, p.tweetId, { folder: p.folder })),
      )
      state.users.forEach((u) =>
        users.put({
          id: `${u.owner}_follower_${u.restId}`,
          owner_id: u.owner,
          rest_id: u.restId,
          relationship: 'follower',
          folder: u.folder,
        }),
      )
    }
    request.onsuccess = () => {
      request.result.close()
      resolve()
    }
    request.onerror = () => reject(request.error)
  })
}

const reset = () => resetEnv('111')

describe('Feature: universal-folders, Property 4: Migration maps legacy folders to bookmark scope', () => {
  it('creates one bookmark folder per legacy name with sort_order = index', async () => {
    await fc.assert(
      fc
        .asyncProperty(arbLegacyState, async (state) => {
          await seedLegacyDb(state)
          const folders = await getAllRaw<Folder>(FOLDERS_TABLE_NAME)

          for (const owner of OWNERS) {
            const migrated = folders
              .filter((f) => f.owner_id === owner && f.scope === 'bookmark')
              .sort((a, b) => a.sort_order - b.sort_order)
            expect(
              migrated.map(({ id, name, sort_order }) => ({
                id,
                name,
                sort_order,
              })),
            ).toEqual(
              state.legacy[owner].map((name, i) => ({
                id: getFolderId(owner, 'bookmark', name),
                name,
                sort_order: i,
              })),
            )
          }
        })
        .beforeEach(reset),
      { numRuns: NUM_RUNS },
    )
  })
})

describe('Feature: universal-folders, Property 16: Migration preserves post folder fields', () => {
  it('leaves every post’s folder field identical', async () => {
    await fc.assert(
      fc
        .asyncProperty(arbLegacyState, async (state) => {
          await seedLegacyDb(state)
          const posts = await getAllRaw(TWEETS_TABLE_NAME_V2)
          const byId = Object.fromEntries(posts.map((p) => [p.id, p.folder]))

          expect(posts).toHaveLength(state.posts.length)
          state.posts.forEach((p) => {
            expect(byId[`${p.owner}_${p.tweetId}`]).toBe(p.folder)
          })
        })
        .beforeEach(reset),
      { numRuns: NUM_RUNS },
    )
  })
})

describe('Feature: universal-folders, Property 17: Migration creates user-scoped folders from user records', () => {
  it('creates exactly one user folder per distinct non-empty folder value', async () => {
    await fc.assert(
      fc
        .asyncProperty(arbLegacyState, async (state) => {
          await seedLegacyDb(state)
          const folders = await getAllRaw<Folder>(FOLDERS_TABLE_NAME)

          for (const owner of OWNERS) {
            const expected = new Set(
              state.users
                .filter((u) => u.owner === owner && u.folder)
                .map((u) => u.folder),
            )
            const migrated = folders.filter(
              (f) => f.owner_id === owner && f.scope === 'user',
            )
            expect(migrated.map((f) => f.name).sort()).toEqual(
              [...expected].sort(),
            )
            expect(new Set(migrated.map((f) => f.sort_order)).size).toBe(
              migrated.length,
            )
          }
        })
        .beforeEach(reset),
      { numRuns: NUM_RUNS },
    )
  })
})
