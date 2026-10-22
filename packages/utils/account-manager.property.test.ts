import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

import {
  AccountEntry,
  getAccountRegistry,
  upsertAccountEntry,
} from './account-manager'
import { NUM_RUNS, resetEnv } from './test-utils'

const MAX_REGISTRY_SIZE = 20

const arbTimestamp = fc.integer({ min: 1, max: 2_000_000_000 })

function arbEntry(userIds: fc.Arbitrary<string>): fc.Arbitrary<AccountEntry> {
  return fc.record({
    user_id: userIds,
    screen_name: fc.string({ maxLength: 15 }),
    profile_image_url: fc.webUrl(),
    first_seen_at: arbTimestamp,
    last_active_at: arbTimestamp,
  })
}

async function seedRegistry(entries: AccountEntry[]) {
  // fake-browser storage keeps references (real chrome.storage clones), so
  // clone to keep fast-check's generated values from being mutated.
  await chrome.storage.local.set({ account_registry: structuredClone(entries) })
}

describe('Feature: multi-account-support, Property 3: Registry Upsert Correctness', () => {
  it('adds a new entry with all provided fields', async () => {
    await fc.assert(
      fc
        .asyncProperty(
          fc.uniqueArray(arbEntry(fc.stringMatching(/^\d{1,6}$/)), {
            selector: (e) => e.user_id,
            maxLength: MAX_REGISTRY_SIZE - 1,
          }),
          arbEntry(fc.stringMatching(/^n\d{1,6}$/)),
          async (initial, entry) => {
            await seedRegistry(initial)
            await upsertAccountEntry({ ...entry })
            const registry = await getAccountRegistry()

            expect(registry).toHaveLength(initial.length + 1)
            expect(registry.find((e) => e.user_id === entry.user_id)).toEqual(
              entry,
            )
          },
        )
        .beforeEach(() => resetEnv()),
      { numRuns: NUM_RUNS },
    )
  })

  it('updates an existing entry but preserves first_seen_at', async () => {
    await fc.assert(
      fc
        .asyncProperty(
          fc.uniqueArray(arbEntry(fc.stringMatching(/^\d{1,6}$/)), {
            selector: (e) => e.user_id,
            minLength: 1,
            maxLength: MAX_REGISTRY_SIZE,
          }),
          fc.nat(),
          arbEntry(fc.constant('')),
          async (initial, pick, update) => {
            const target = initial[pick % initial.length]
            await seedRegistry(initial)
            await upsertAccountEntry({ ...update, user_id: target.user_id })
            const registry = await getAccountRegistry()

            expect(registry).toHaveLength(initial.length)
            expect(registry.find((e) => e.user_id === target.user_id)).toEqual({
              user_id: target.user_id,
              screen_name: update.screen_name,
              profile_image_url: update.profile_image_url,
              last_active_at: update.last_active_at,
              first_seen_at: target.first_seen_at,
            })
          },
        )
        .beforeEach(() => resetEnv()),
      { numRuns: NUM_RUNS },
    )
  })
})

describe('Feature: multi-account-support, Property 4: Registry Invariants (Sorted and Bounded)', () => {
  it('stays sorted desc, bounded at 20, and evicts the least recently active', async () => {
    await fc.assert(
      fc
        .asyncProperty(
          // Small id pool so sequences mix inserts and updates.
          fc.array(arbEntry(fc.integer({ min: 0, max: 30 }).map(String)), {
            maxLength: 45,
          }),
          async (ops) => {
            for (const op of ops) {
              const before = await getAccountRegistry()
              await upsertAccountEntry({ ...op })
              const after = await getAccountRegistry()

              expect(after.length).toBeLessThanOrEqual(MAX_REGISTRY_SIZE)
              for (let i = 1; i < after.length; i++) {
                expect(after[i - 1].last_active_at).toBeGreaterThanOrEqual(
                  after[i].last_active_at,
                )
              }

              const isNew = !before.some((e) => e.user_id === op.user_id)
              if (isNew && before.length === MAX_REGISTRY_SIZE) {
                // Exactly one entry was evicted, and it was the oldest.
                const candidates = [...before, op]
                const kept = new Set(after.map((e) => e.user_id))
                const evicted = candidates.filter((e) => !kept.has(e.user_id))
                expect(evicted).toHaveLength(1)
                const minActive = Math.min(
                  ...candidates.map((e) => e.last_active_at),
                )
                expect(evicted[0].last_active_at).toBe(minActive)
              }
            }
          },
        )
        .beforeEach(() => resetEnv()),
      { numRuns: NUM_RUNS },
    )
  })
})
