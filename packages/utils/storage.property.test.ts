import { describe, it } from 'vitest'
import fc from 'fast-check'

import { getStorageKey, StorageKeys } from './storage'
import { NUM_RUNS } from './test-utils'

describe('Feature: multi-account-support, Property 2: Storage Key Namespacing', () => {
  it('namespaces every key except current_user_id as user:{uid}:{key}', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string().filter((k) => k !== StorageKeys.Current_UID),
        (uid, key) => getStorageKey(key, uid) === `user:${uid}:${key}`,
      ),
      { numRuns: NUM_RUNS },
    )
  })

  it('returns the key unchanged for an empty user id', () => {
    fc.assert(
      fc.property(fc.string(), (key) => getStorageKey(key, '') === key),
      { numRuns: NUM_RUNS },
    )
  })

  it('never namespaces current_user_id', () => {
    fc.assert(
      fc.property(fc.string(), (uid) => {
        return (
          getStorageKey(StorageKeys.Current_UID, uid) ===
          StorageKeys.Current_UID
        )
      }),
      { numRuns: NUM_RUNS },
    )
  })
})
