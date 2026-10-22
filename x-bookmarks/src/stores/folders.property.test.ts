import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

import {
  NUM_RUNS,
  getAllRaw,
  makePost,
  putRaw,
  resetEnv,
} from 'utils/test-utils'
import { createFolder as dbCreateFolder } from 'utils/db/folders'
import { TWEETS_TABLE_NAME_V2, USERS_TABLE_NAME } from 'utils/db/index'
import type { EntityScope } from 'utils/types'
import { folderState, initFolders, moveEntitiesToFolder } from './folders'

const OWNER = '111'
const OTHER_OWNER = '999'
const FOLDERS = ['a', 'b', 'c']

const arbScope = fc.constantFrom<EntityScope>('bookmark', 'user')
/** Previous folder value of an entity, including unassigned forms. */
const arbPrevFolder = fc.constantFrom<string | undefined>(
  undefined,
  '',
  ...FOLDERS,
)

function entityStore(scope: EntityScope) {
  return scope === 'bookmark' ? TWEETS_TABLE_NAME_V2 : USERS_TABLE_NAME
}

function makeEntity(
  scope: EntityScope,
  owner: string,
  n: number,
  folder: string | undefined,
) {
  return scope === 'bookmark'
    ? makePost(owner, String(n), { folder })
    : {
        id: `${owner}_follower_${n}`,
        owner_id: owner,
        rest_id: String(n),
        relationship: 'follower',
        folder,
      }
}

/** Seed folders + entities for the active owner and a foreign owner. */
async function seed(scope: EntityScope, prevFolders: (string | undefined)[]) {
  for (const name of FOLDERS) {
    await dbCreateFolder(name, scope)
  }
  const own = prevFolders.map((f, i) => makeEntity(scope, OWNER, i + 1, f))
  const foreign = prevFolders.map((f, i) =>
    makeEntity(scope, OTHER_OWNER, i + 1, f),
  )
  await putRaw(entityStore(scope), [...own, ...foreign])
  await initFolders(scope)
  return { own, foreign }
}

async function folderById(scope: EntityScope) {
  const records = await getAllRaw(entityStore(scope))
  return Object.fromEntries(records.map((r) => [r.id, r.folder]))
}

const reset = () => resetEnv(OWNER)

/** Entities with previous folders plus a subset (by index) to move. */
const arbMoveCase = fc
  .array(arbPrevFolder, { minLength: 1, maxLength: 15 })
  .chain((prev) =>
    fc.tuple(
      fc.constant(prev),
      fc.uniqueArray(fc.integer({ min: 0, max: prev.length - 1 }), {
        minLength: 1,
      }),
    ),
  )

describe('Feature: universal-folders, Property 11: Entity assignment replaces previous folder', () => {
  it('sets the target folder on every moved entity regardless of its previous value', async () => {
    await fc.assert(
      fc
        .asyncProperty(
          arbScope,
          arbMoveCase,
          fc.constantFrom(...FOLDERS),
          async (scope, [prev, picks], target) => {
            const { own } = await seed(scope, prev)
            const before = await folderById(scope)
            const ids = picks.map((i) => own[i].id)

            const result = await moveEntitiesToFolder(ids, target)

            expect(result.succeeded.sort()).toEqual([...ids].sort())
            expect(result.failed).toEqual([])
            const after = await folderById(scope)
            for (const [id, folder] of Object.entries(before)) {
              expect(after[id]).toBe(ids.includes(id) ? target : folder)
            }
          },
        )
        .beforeEach(reset),
      { numRuns: NUM_RUNS },
    )
  })

  it('reports exactly the missing and foreign ids as failed, touching only owned ones', async () => {
    await fc.assert(
      fc
        .asyncProperty(
          arbScope,
          arbMoveCase,
          fc.integer({ min: 1, max: 4 }),
          fc.constantFrom(...FOLDERS),
          async (scope, [prev, picks], missingCount, target) => {
            const { own, foreign } = await seed(scope, prev)
            const before = await folderById(scope)
            const owned = picks.map((i) => own[i].id)
            const bad = [
              ...picks.map((i) => foreign[i].id),
              ...Array.from(
                { length: missingCount },
                (_, i) => makeEntity(scope, OWNER, 1000 + i, '').id,
              ),
            ]
            // Interleave so failures don't sit neatly at the end.
            const ids = owned.flatMap((id, i) => [id, bad[i]]).filter(Boolean)
            ids.push(...bad.slice(owned.length))

            const result = await moveEntitiesToFolder(ids, target)

            expect(result.succeeded.sort()).toEqual([...owned].sort())
            expect(result.failed.sort()).toEqual([...bad].sort())
            const after = await folderById(scope)
            for (const [id, folder] of Object.entries(before)) {
              expect(after[id]).toBe(owned.includes(id) ? target : folder)
            }
          },
        )
        .beforeEach(reset),
      { numRuns: NUM_RUNS },
    )
  })
})

describe('Feature: universal-folders, Property 12: Non-existent folder assignment rejected', () => {
  it('rejects the move without modifying any entity', async () => {
    await fc.assert(
      fc
        .asyncProperty(
          arbScope,
          arbMoveCase,
          fc
            .string({ minLength: 1, maxLength: 20 })
            .filter((n) => !FOLDERS.includes(n)),
          async (scope, [prev, picks], missingFolder) => {
            const { own } = await seed(scope, prev)
            const before = await folderById(scope)
            const ids = picks.map((i) => own[i].id)

            const result = await moveEntitiesToFolder(ids, missingFolder)

            expect(result).toEqual({ succeeded: [], failed: ids })
            expect(await folderById(scope)).toEqual(before)
          },
        )
        .beforeEach(reset),
      { numRuns: NUM_RUNS },
    )
  })

  it('rejects a folder that only exists in the other scope', async () => {
    await fc.assert(
      fc
        .asyncProperty(arbScope, arbMoveCase, async (scope, [prev, picks]) => {
          const { own } = await seed(scope, prev)
          const other: EntityScope = scope === 'bookmark' ? 'user' : 'bookmark'
          await dbCreateFolder('only-elsewhere', other)
          const before = await folderById(scope)
          const ids = picks.map((i) => own[i].id)

          const result = await moveEntitiesToFolder(ids, 'only-elsewhere')

          expect(result.succeeded).toEqual([])
          expect(await folderById(scope)).toEqual(before)
        })
        .beforeEach(reset),
      { numRuns: NUM_RUNS },
    )
  })
})

describe('Feature: universal-folders, Property 14: Unsorted count correctness', () => {
  it('equals the number of the active account’s entities with an empty or null folder', async () => {
    await fc.assert(
      fc
        .asyncProperty(arbScope, arbMoveCase, async (scope, [prev, picks]) => {
          const { own } = await seed(scope, prev)
          const unsorted = (folders: (string | undefined)[]) =>
            folders.filter((f) => !f).length

          expect(folderState.unsortedCount).toBe(unsorted(prev))

          // Stays correct after a move refreshes the counts.
          await moveEntitiesToFolder(
            picks.map((i) => own[i].id),
            FOLDERS[0],
          )
          const moved = prev.map((f, i) => (picks.includes(i) ? FOLDERS[0] : f))
          expect(folderState.unsortedCount).toBe(unsorted(moved))
        })
        .beforeEach(reset),
      { numRuns: NUM_RUNS },
    )
  })
})
