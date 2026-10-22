import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

import {
  NoActiveAccountError,
  OwnershipMismatchError,
  requireActiveAccount,
  validateOwnership,
  withOwnershipCheck,
} from './context-guard'
import {
  upsertRecords,
  upsertCategoryRecords,
  findRecords,
  getRecord,
  deleteRecord,
} from './tweets'
import { upsertConfig, readConfig, deleteConfig } from './configs'
import { TWEETS_TABLE_NAME_V2 } from './index'
import { OptionName } from '../types'
import { setCurrentUserId } from '../storage'
import {
  NUM_RUNS,
  arbUserId,
  getAllRaw,
  makePost,
  putRaw,
  resetEnv,
} from '../test-utils'

/** Every guarded read/write entry point in the data layer. */
const guardedOperations: Record<string, () => Promise<unknown>> = {
  requireActiveAccount: () => requireActiveAccount(),
  withOwnershipCheck: () => withOwnershipCheck(async () => 'ran'),
  upsertRecords: () => upsertRecords([makePost('1', '100')]),
  upsertCategoryRecords: () =>
    upsertCategoryRecords([makePost('1', '100', { id: 'likes_1_100' })]),
  findRecords: () => findRecords(),
  getRecord: () => getRecord('100'),
  deleteRecord: () => deleteRecord('100'),
  upsertConfig: () =>
    upsertConfig({ option_name: OptionName.FOLDER, option_value: [] }),
  readConfig: () => readConfig(OptionName.FOLDER),
  deleteConfig: () => deleteConfig(OptionName.FOLDER),
}

describe('Feature: multi-account-support, Property 6: Empty Owner Rejects Operations', () => {
  it('rejects every guarded operation and writes nothing', async () => {
    await fc.assert(
      fc
        .asyncProperty(
          fc.constantFrom(...Object.keys(guardedOperations)),
          // Empty, explicitly blank, or never-set current_user_id.
          fc.constantFrom<'' | null | undefined>('', null, undefined),
          async (opName, emptyOwner) => {
            if (emptyOwner !== undefined) {
              await chrome.storage.local.set({ current_user_id: emptyOwner })
            }
            await expect(guardedOperations[opName]()).rejects.toBeInstanceOf(
              NoActiveAccountError,
            )
            expect(await getAllRaw(TWEETS_TABLE_NAME_V2)).toHaveLength(0)
          },
        )
        .beforeEach(() => resetEnv()),
      { numRuns: NUM_RUNS },
    )
  })
})

describe('Feature: multi-account-support, Property 7: Ownership Mismatch Rejects Writes', () => {
  const arbDistinctPair = fc
    .tuple(arbUserId, arbUserId)
    .filter(([a, b]) => a !== b)

  it('validateOwnership rejects a record owned by another account', async () => {
    await fc.assert(
      fc
        .asyncProperty(arbDistinctPair, async ([active, other]) => {
          await setCurrentUserId(active)
          await expect(validateOwnership(other)).rejects.toBeInstanceOf(
            OwnershipMismatchError,
          )
          await expect(validateOwnership(active)).resolves.toBeUndefined()
        })
        .beforeEach(() => resetEnv()),
      { numRuns: NUM_RUNS },
    )
  })

  it('explicit-key writes reject records owned by another account', async () => {
    await fc.assert(
      fc
        .asyncProperty(
          arbDistinctPair,
          fc.stringMatching(/^\d{1,19}$/),
          fc.boolean(),
          async ([active, other], tweetId, viaCategory) => {
            await setCurrentUserId(active)
            // Pre-existing record of the other account that must stay intact.
            const original = makePost(other, tweetId, { folder: 'theirs' })
            await putRaw(TWEETS_TABLE_NAME_V2, [original])

            const tampered = { ...original, folder: 'hijacked' }
            const write = viaCategory
              ? upsertCategoryRecords([tampered])
              : upsertRecords([tampered], true)
            await expect(write).rejects.toBeInstanceOf(OwnershipMismatchError)
            expect(await getAllRaw(TWEETS_TABLE_NAME_V2)).toEqual([original])
          },
        )
        .beforeEach(() => resetEnv()),
      { numRuns: NUM_RUNS },
    )
  })
})
