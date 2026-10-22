import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

import {
  NUM_RUNS,
  getAllRaw,
  makePost,
  putRaw,
  resetEnv,
} from 'utils/test-utils'
import {
  TWEETS_TABLE_NAME_V2,
  USERS_TABLE_NAME,
  FOLDERS_TABLE_NAME,
} from 'utils/db/index'
import { StorageKeys, getStorageKey, setCurrentUserId } from 'utils/storage'
import {
  detectAndSetActiveAccount,
  getAccountRegistry,
} from 'utils/account-manager'
import { startFullSync, type SyncState } from 'utils/sync-engine'
import { findRecords } from 'utils/db/tweets'

const A = '111'
const B = '222'

/**
 * Fresh environment with the background script loaded. fake-browser's reset()
 * drops listeners, so the module is re-imported to re-register them.
 */
async function bootBackground(activeUserId = '') {
  await resetEnv(activeUserId)
  // Events fake-browser doesn't implement; irrelevant to account switching.
  const noopEvent = { addListener: () => {} }
  const c = chrome as any
  c.action = { ...c.action, onClicked: noopEvent }
  c.omnibox = { ...c.omnibox, onInputEntered: noopEvent }
  c.webRequest = { onSendHeaders: noopEvent, onCompleted: noopEvent }
  vi.resetModules()
  await import('./index')
}

async function syncState(userId: string): Promise<SyncState | undefined> {
  const key = getStorageKey('sync_state', userId)
  return (await chrome.storage.local.get(key))[key]
}

async function cursor(userId: string) {
  const key = getStorageKey(StorageKeys.Bookmark_Cursor, userId)
  return (await chrome.storage.local.get(key))[key]
}

/** The onChanged handler is async and not awaited; wait for its effect. */
async function waitForSyncing(userId: string) {
  await vi.waitFor(async () => {
    expect((await syncState(userId))?.status).toBe('syncing')
  })
}

async function userKeys(userId: string) {
  const all = await chrome.storage.local.get()
  return Object.fromEntries(
    Object.entries(all).filter(([k]) => k.startsWith(`user:${userId}:`)),
  )
}

describe('Feature: multi-account-support, Property 9: Account Switch Preserves Previous Data', () => {
  it('leaves every record of the previous account unchanged', async () => {
    await fc.assert(
      fc
        .asyncProperty(
          fc.uniqueArray(fc.integer({ min: 1, max: 99 }).map(String), {
            maxLength: 20,
          }),
          fc.constantFrom('', 'a', 'b'),
          fc.option(fc.stringMatching(/^c\d{1,4}$/), { nil: undefined }),
          fc.boolean(),
          async (tweetIds, folder, savedCursor, wasSyncing) => {
            // Account A's IndexedDB data (plus some of B's).
            await putRaw(TWEETS_TABLE_NAME_V2, [
              ...tweetIds.map((t) => makePost(A, t, { folder })),
              ...tweetIds.map((t) => makePost(B, t)),
            ])
            await putRaw(
              USERS_TABLE_NAME,
              tweetIds.map((r) => ({
                id: `${A}_follower_${r}`,
                owner_id: A,
                rest_id: r,
                relationship: 'follower',
                folder,
              })),
            )
            await putRaw(FOLDERS_TABLE_NAME, [
              {
                id: `${A}_bookmark_a`,
                owner_id: A,
                name: 'a',
                scope: 'bookmark',
                sort_order: 0,
                created_at: 0,
              },
            ])
            // Account A's namespaced storage.
            if (wasSyncing) {
              await startFullSync(A)
            }
            if (savedCursor !== undefined) {
              await chrome.storage.local.set({
                [getStorageKey(StorageKeys.Bookmark_Cursor, A)]: savedCursor,
                [getStorageKey(StorageKeys.Token, A)]: 'token-a',
              })
            }

            const before = structuredClone({
              posts: await getAllRaw(TWEETS_TABLE_NAME_V2),
              users: await getAllRaw(USERS_TABLE_NAME),
              folders: await getAllRaw(FOLDERS_TABLE_NAME),
              storage: await userKeys(A),
            })

            await setCurrentUserId(B)
            await waitForSyncing(B)

            expect(await getAllRaw(TWEETS_TABLE_NAME_V2)).toEqual(before.posts)
            expect(await getAllRaw(USERS_TABLE_NAME)).toEqual(before.users)
            expect(await getAllRaw(FOLDERS_TABLE_NAME)).toEqual(before.folders)

            // Only A's sync status may change (syncing → idle on cancel);
            // its cursor and all other keys are preserved for resuming.
            const after = await userKeys(A)
            const syncKey = getStorageKey('sync_state', A)
            const { [syncKey]: stateBefore, ...restBefore } = before.storage
            const { [syncKey]: stateAfter, ...restAfter } = after
            expect(restAfter).toEqual(restBefore)
            if (stateBefore) {
              expect(stateAfter).toEqual({ ...stateBefore, status: 'idle' })
            } else {
              expect(stateAfter).toBeUndefined()
            }
          },
        )
        .beforeEach(() => bootBackground(A)),
      { numRuns: NUM_RUNS },
    )
  })
})

describe('Account switch flow (integration)', () => {
  beforeEach(() => bootBackground(A))

  it('detect new account → update storage → cancel old sync → start new sync', async () => {
    await startFullSync(A)
    await chrome.storage.local.set({
      [getStorageKey(StorageKeys.Bookmark_Cursor, A)]: 'cursor-a',
      [getStorageKey(StorageKeys.Bookmark_Cursor, B)]: 'stale-cursor-b',
    })

    await detectAndSetActiveAccount(B, 'bob', 'https://img/bob.jpg')
    await waitForSyncing(B)

    expect(
      (await chrome.storage.local.get('current_user_id')).current_user_id,
    ).toBe(B)
    expect((await getAccountRegistry()).map((e) => e.user_id)).toContain(B)
    // Old account's sync is cancelled, its cursor kept for later resume.
    expect((await syncState(A))?.status).toBe('idle')
    expect(await cursor(A)).toBe('cursor-a')
    // New account starts a full sync from the beginning.
    expect(await syncState(B)).toMatchObject({
      status: 'syncing',
      progress: 0,
      owner_id: B,
    })
    expect(await cursor(B)).toBe('')
  })

  it('switching back makes the previous account’s data immediately available', async () => {
    await putRaw(TWEETS_TABLE_NAME_V2, [
      makePost(A, '1'),
      makePost(A, '2'),
      makePost(B, '3'),
    ])

    await setCurrentUserId(B)
    await waitForSyncing(B)
    expect((await findRecords()).map((t) => t.id)).toEqual(['222_3'])

    await setCurrentUserId(A)
    // Queryable right away — before the background sync for A has started.
    expect((await findRecords()).map((t) => t.id).sort()).toEqual([
      '111_1',
      '111_2',
    ])
    await waitForSyncing(A)
    expect((await syncState(B))?.status).toBe('idle')
  })

  it('ignores unrelated changes and does not start a sync on logout', async () => {
    await startFullSync(A)
    await chrome.storage.local.set({ unrelated_key: 1 })
    await setCurrentUserId(A) // same id: no switch
    await new Promise((r) => setTimeout(r, 20))
    expect((await syncState(A))?.status).toBe('syncing')
    expect(await getAccountRegistry()).toEqual([])

    await setCurrentUserId('') // logged out
    await vi.waitFor(async () => {
      expect((await syncState(A))?.status).toBe('idle')
    })
    const keys = Object.keys(await chrome.storage.local.get())
    expect(keys.some((k) => k.startsWith('user::') || k === 'sync_state')).toBe(
      false,
    )
  })
})
