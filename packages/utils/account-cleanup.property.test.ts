import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

import { deleteAccountData } from './account-cleanup'
import { getAccountRegistry } from './account-manager'
import {
  TWEETS_TABLE_NAME_V2,
  CONFIGS_TABLE_NAME_V2,
  USERS_TABLE_NAME,
  FOLDERS_TABLE_NAME,
} from './db/index'
import { setCurrentUserId } from './storage'
import { NUM_RUNS, getAllRaw, makePost, putRaw, resetEnv } from './test-utils'

const OWNERS = ['111', '222', '333']
const STORES = [
  TWEETS_TABLE_NAME_V2,
  CONFIGS_TABLE_NAME_V2,
  USERS_TABLE_NAME,
  FOLDERS_TABLE_NAME,
]

/** Records, namespaced storage keys and registry entries for several accounts. */
const arbAccountData = fc.record({
  posts: fc.uniqueArray(
    fc.tuple(fc.constantFrom(...OWNERS), fc.integer({ min: 1, max: 40 })),
    { selector: ([o, t]) => `${o}_${t}`, maxLength: 30 },
  ),
  users: fc.uniqueArray(
    fc.tuple(fc.constantFrom(...OWNERS), fc.integer({ min: 1, max: 40 })),
    { selector: ([o, r]) => `${o}_${r}`, maxLength: 20 },
  ),
  folders: fc.uniqueArray(
    fc.tuple(fc.constantFrom(...OWNERS), fc.constantFrom('a', 'b', 'c')),
    { selector: ([o, n]) => `${o}_${n}`, maxLength: 9 },
  ),
  storageKeys: fc.uniqueArray(
    fc.tuple(
      fc.constantFrom(...OWNERS),
      fc.constantFrom('bookmark_cursor', 'sync_state', 'token', 'csrf'),
    ),
    { selector: ([o, k]) => `${o}_${k}`, maxLength: 12 },
  ),
})

type AccountData =
  typeof arbAccountData extends fc.Arbitrary<infer T> ? T : never

async function seed(data: AccountData) {
  await putRaw(
    TWEETS_TABLE_NAME_V2,
    data.posts.map(([o, t]) => makePost(o, String(t))),
  )
  await putRaw(
    USERS_TABLE_NAME,
    data.users.map(([o, r]) => ({
      id: `${o}_follower_${r}`,
      owner_id: o,
      rest_id: String(r),
      relationship: 'follower',
    })),
  )
  await putRaw(
    FOLDERS_TABLE_NAME,
    data.folders.map(([o, n], i) => ({
      id: `${o}_bookmark_${n}`,
      owner_id: o,
      name: n,
      scope: 'bookmark',
      sort_order: i,
      created_at: 0,
    })),
  )
  await putRaw(
    CONFIGS_TABLE_NAME_V2,
    OWNERS.map((o) => ({
      id: `${o}_folder`,
      owner_id: o,
      option_name: 'folder',
    })),
  )
  const items: Record<string, unknown> = {
    account_registry: OWNERS.map((o, i) => ({
      user_id: o,
      screen_name: o,
      profile_image_url: '',
      first_seen_at: i,
      last_active_at: i,
    })),
  }
  data.storageKeys.forEach(([o, k]) => {
    items[`user:${o}:${k}`] = k
  })
  await chrome.storage.local.set(items)
}

async function snapshot() {
  const stores: Record<string, unknown[]> = {}
  for (const name of STORES) {
    stores[name] = await getAllRaw(name)
  }
  return structuredClone({ stores, storage: await chrome.storage.local.get() })
}

const arbDistinctOwners = fc
  .tuple(fc.constantFrom(...OWNERS), fc.constantFrom(...OWNERS))
  .filter(([a, b]) => a !== b)

describe('Feature: multi-account-support, Property 10: Account Deletion Completeness', () => {
  it('removes every trace of the deleted account and nothing else', async () => {
    await fc.assert(
      fc
        .asyncProperty(
          arbAccountData,
          arbDistinctOwners,
          async (data, [active, target]) => {
            await setCurrentUserId(active)
            await seed(data)
            const before = await snapshot()

            const result = await deleteAccountData(target)
            expect(result).toEqual({
              indexedDbDeleted: true,
              chromeStorageDeleted: true,
              registryRemoved: true,
            })

            for (const name of STORES) {
              const records = await getAllRaw(name)
              expect(records.some((r) => r.owner_id === target)).toBe(false)
              // Other accounts' records are untouched.
              expect(records).toEqual(
                before.stores[name].filter((r: any) => r.owner_id !== target),
              )
            }
            const storage = await chrome.storage.local.get()
            expect(
              Object.keys(storage).some((k) => k.startsWith(`user:${target}:`)),
            ).toBe(false)
            const registry = await getAccountRegistry()
            expect(registry.map((e) => e.user_id)).not.toContain(target)
            expect(registry).toHaveLength(OWNERS.length - 1)
          },
        )
        .beforeEach(() => resetEnv()),
      { numRuns: NUM_RUNS },
    )
  })
})

describe('Feature: multi-account-support, Property 11: Active Account Cannot Be Deleted', () => {
  it('rejects deleting the active account and leaves all data unchanged', async () => {
    await fc.assert(
      fc
        .asyncProperty(
          arbAccountData,
          fc.constantFrom(...OWNERS),
          async (data, active) => {
            await setCurrentUserId(active)
            await seed(data)
            const before = await snapshot()

            await expect(deleteAccountData(active)).rejects.toThrow()
            expect(await snapshot()).toEqual(before)
          },
        )
        .beforeEach(() => resetEnv()),
      { numRuns: NUM_RUNS },
    )
  })
})
