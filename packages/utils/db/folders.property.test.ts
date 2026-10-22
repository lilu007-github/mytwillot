import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

import {
  createFolder,
  deleteFolder,
  getFoldersByScope,
  renameFolder,
  reorderFolders,
} from './folders'
import {
  FOLDERS_TABLE_NAME,
  TWEETS_TABLE_NAME_V2,
  USERS_TABLE_NAME,
} from './index'
import {
  DuplicateFolderError,
  EntityScope,
  InvalidFolderNameError,
} from '../types/folder'
import { NUM_RUNS, getAllRaw, makePost, putRaw, resetEnv } from '../test-utils'

const OWNER = '111'
const OTHER_OWNER = '999'
const SCOPES: EntityScope[] = ['bookmark', 'user']

const arbScope = fc.constantFrom<EntityScope>(...SCOPES)

/** Valid, already-trimmed folder name (1–50 chars). */
const arbName = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => s.trim() === s && s.length > 0)

/** Small name pool so generated sequences collide often. */
const arbPoolName = fc.constantFrom('a', 'b', 'c', 'd', 'Work', 'work')

const arbWhitespace = fc.stringOf(fc.constantFrom(' ', '\t', '\n'), {
  maxLength: 4,
})

function otherScope(scope: EntityScope): EntityScope {
  return scope === 'bookmark' ? 'user' : 'bookmark'
}

function entityStore(scope: EntityScope) {
  return scope === 'bookmark' ? TWEETS_TABLE_NAME_V2 : USERS_TABLE_NAME
}

function makeEntity(
  scope: EntityScope,
  owner: string,
  n: number,
  folder: string,
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

/** Entities in both scopes for the active owner and a foreign owner. */
async function seedEntities(
  scope: EntityScope,
  owner: string,
  folders: string[],
) {
  await putRaw(
    entityStore(scope),
    folders.map((f, i) => makeEntity(scope, owner, i + 1, f)),
  )
}

/** Expected id → folder map for entities seeded by seedEntities. */
function expectedFolders(scope: EntityScope, folders: string[], owner = OWNER) {
  return Object.fromEntries(
    folders.map((f, i) => [makeEntity(scope, owner, i + 1, f).id, f]),
  )
}

async function entityFolders(scope: EntityScope, owner = OWNER) {
  const records = await getAllRaw(entityStore(scope))
  return Object.fromEntries(
    records
      .filter((r) => r.owner_id === owner)
      .map((r) => [r.id, r.folder ?? '']),
  )
}

async function ownerState(owner = OWNER) {
  const folders = (await getAllRaw(FOLDERS_TABLE_NAME)).filter(
    (f) => f.owner_id === owner,
  )
  folders.sort((a, b) => a.id.localeCompare(b.id))
  return {
    folders,
    bookmark: await entityFolders('bookmark', owner),
    user: await entityFolders('user', owner),
  }
}

/** A foreign account with identically named folders/entities in both scopes. */
async function seedForeignAccount(names: string[]) {
  await putRaw(
    FOLDERS_TABLE_NAME,
    SCOPES.flatMap((scope) =>
      names.map((name, i) => ({
        id: `${OTHER_OWNER}_${scope}_${name}`,
        owner_id: OTHER_OWNER,
        name,
        scope,
        sort_order: i,
        created_at: 0,
      })),
    ),
  )
  for (const scope of SCOPES) {
    await seedEntities(scope, OTHER_OWNER, names)
  }
}

const reset = () => resetEnv(OWNER)

describe('Feature: universal-folders, Property 1: Folder structural integrity', () => {
  it('reads back the trimmed name, the scope and a non-negative integer sort order', async () => {
    await fc.assert(
      fc
        .asyncProperty(arbName, arbScope, async (name, scope) => {
          await createFolder(name, scope)
          const [folder] = await getFoldersByScope(scope)
          expect(folder.name).toBe(name)
          expect(folder.scope).toBe(scope)
          expect(folder.owner_id).toBe(OWNER)
          expect(Number.isInteger(folder.sort_order)).toBe(true)
          expect(folder.sort_order).toBeGreaterThanOrEqual(0)
        })
        .beforeEach(reset),
      { numRuns: NUM_RUNS },
    )
  })
})

describe('Feature: universal-folders, Property 2: Uniqueness within scope', () => {
  it('rejects duplicates in the same scope but allows them across scopes', async () => {
    await fc.assert(
      fc
        .asyncProperty(arbName, arbScope, async (name, scope) => {
          await createFolder(name, scope)
          await expect(createFolder(name, scope)).rejects.toBeInstanceOf(
            DuplicateFolderError,
          )
          await expect(
            createFolder(name, otherScope(scope)),
          ).resolves.toMatchObject({ name, scope: otherScope(scope) })
          expect(await getFoldersByScope(scope)).toHaveLength(1)
        })
        .beforeEach(reset),
      { numRuns: NUM_RUNS },
    )
  })
})

describe('Feature: universal-folders, Property 3: Scope-filtered query correctness', () => {
  it('returns only the queried scope, ordered with contiguous sort orders', async () => {
    const arbOp = fc.oneof(
      fc.record({
        kind: fc.constant('create'),
        name: arbPoolName,
        scope: arbScope,
      }),
      fc.record({
        kind: fc.constant('delete'),
        name: arbPoolName,
        scope: arbScope,
      }),
    )
    await fc.assert(
      fc
        .asyncProperty(fc.array(arbOp, { maxLength: 25 }), async (ops) => {
          await seedForeignAccount(['a', 'b'])
          const model: Record<EntityScope, string[]> = {
            bookmark: [],
            user: [],
          }
          for (const op of ops) {
            const names = model[op.scope]
            if (op.kind === 'create' && !names.includes(op.name)) {
              await createFolder(op.name, op.scope)
              names.push(op.name)
            } else if (op.kind === 'delete' && names.includes(op.name)) {
              await deleteFolder(op.name, op.scope)
              names.splice(names.indexOf(op.name), 1)
            }
          }

          for (const scope of SCOPES) {
            const folders = await getFoldersByScope(scope)
            expect(folders.every((f) => f.scope === scope)).toBe(true)
            expect(folders.every((f) => f.owner_id === OWNER)).toBe(true)
            expect(folders.map((f) => f.name)).toEqual(model[scope])
            expect(folders.map((f) => f.sort_order)).toEqual(
              folders.map((_, i) => i),
            )
          }
        })
        .beforeEach(reset),
      { numRuns: NUM_RUNS },
    )
  })
})

describe('Feature: universal-folders, Property 5: Whitespace trimming on create', () => {
  it('stores the trimmed name and appends it to the end of the scope', async () => {
    await fc.assert(
      fc
        .asyncProperty(
          fc.uniqueArray(arbName, { maxLength: 5 }),
          arbName,
          arbWhitespace,
          arbWhitespace,
          arbScope,
          async (existing, name, lead, trail, scope) => {
            fc.pre(!existing.includes(name) && (lead + trail).length > 0)
            for (const n of existing) {
              await createFolder(n, scope)
            }
            const folder = await createFolder(lead + name + trail, scope)
            expect(folder.name).toBe(name)

            const folders = await getFoldersByScope(scope)
            expect(folders[folders.length - 1].name).toBe(name)
            expect(folder.sort_order).toBe(existing.length)
          },
        )
        .beforeEach(reset),
      { numRuns: NUM_RUNS },
    )
  })
})

describe('Feature: universal-folders, Property 6: Delete cascade clears entity references', () => {
  it('removes the folder and clears it on every entity of that scope', async () => {
    await fc.assert(
      fc
        .asyncProperty(
          arbScope,
          fc.array(fc.constantFrom('a', 'b', ''), {
            minLength: 1,
            maxLength: 15,
          }),
          async (scope, assignments) => {
            await seedForeignAccount(['a', 'b'])
            await createFolder('a', scope)
            await createFolder('b', scope)
            await seedEntities(scope, OWNER, assignments)
            const foreignBefore = await ownerState(OTHER_OWNER)

            await deleteFolder('a', scope)

            const names = (await getFoldersByScope(scope)).map((f) => f.name)
            expect(names).toEqual(['b'])
            expect(await entityFolders(scope)).toEqual(
              expectedFolders(
                scope,
                assignments.map((f) => (f === 'a' ? '' : f)),
              ),
            )
            expect(await ownerState(OTHER_OWNER)).toEqual(foreignBefore)
          },
        )
        .beforeEach(reset),
      { numRuns: NUM_RUNS },
    )
  })
})

describe('Feature: universal-folders, Property 7: Reorder persists permutation', () => {
  it('sets each folder’s sort order to its index in the new order', async () => {
    await fc.assert(
      fc
        .asyncProperty(
          fc
            .uniqueArray(arbName, { minLength: 1, maxLength: 8 })
            .chain((names) =>
              fc.tuple(
                fc.constant(names),
                fc.shuffledSubarray(names, {
                  minLength: names.length,
                  maxLength: names.length,
                }),
              ),
            ),
          arbScope,
          async ([names, permutation], scope) => {
            for (const n of names) {
              await createFolder(n, scope)
            }
            await reorderFolders(permutation, scope)
            const folders = await getFoldersByScope(scope)
            expect(folders.map((f) => f.name)).toEqual(permutation)
            expect(folders.map((f) => f.sort_order)).toEqual(
              permutation.map((_, i) => i),
            )
          },
        )
        .beforeEach(reset),
      { numRuns: NUM_RUNS },
    )
  })
})

describe('Feature: universal-folders, Property 8: Invalid names are rejected', () => {
  const arbInvalid = (existing: string[]) =>
    fc.oneof(
      arbWhitespace.map((ws) => ({ name: ws, error: InvalidFolderNameError })),
      fc
        .tuple(fc.string({ minLength: 51, maxLength: 80 }), arbWhitespace)
        .filter(([s]) => s.trim().length > 50)
        .map(([s, ws]) => ({ name: s + ws, error: InvalidFolderNameError })),
      fc
        .tuple(fc.constantFrom(...existing), arbWhitespace)
        .map(([n, ws]) => ({ name: ws + n + ws, error: DuplicateFolderError })),
    )

  const arbCase = fc
    .tuple(fc.uniqueArray(arbName, { minLength: 2, maxLength: 5 }), arbScope)
    .chain(([existing, scope]) =>
      fc.tuple(fc.constant(existing), fc.constant(scope), arbInvalid(existing)),
    )

  it('rejects invalid names on create and leaves the store unchanged', async () => {
    await fc.assert(
      fc
        .asyncProperty(arbCase, async ([existing, scope, invalid]) => {
          for (const n of existing) {
            await createFolder(n, scope)
          }
          await seedEntities(scope, OWNER, existing)
          const before = await ownerState()

          await expect(
            createFolder(invalid.name, scope),
          ).rejects.toBeInstanceOf(invalid.error)
          expect(await ownerState()).toEqual(before)
        })
        .beforeEach(reset),
      { numRuns: NUM_RUNS },
    )
  })

  it('rejects invalid names on rename and leaves the store unchanged', async () => {
    await fc.assert(
      fc
        .asyncProperty(arbCase, async ([existing, scope, invalid]) => {
          for (const n of existing) {
            await createFolder(n, scope)
          }
          await seedEntities(scope, OWNER, existing)
          // Rename a folder other than the duplicate target.
          const source = existing.find((n) => n !== invalid.name.trim())!
          const before = await ownerState()

          await expect(
            renameFolder(source, invalid.name, scope),
          ).rejects.toBeInstanceOf(invalid.error)
          expect(await ownerState()).toEqual(before)
        })
        .beforeEach(reset),
      { numRuns: NUM_RUNS },
    )
  })
})

describe('Feature: universal-folders, Property 9: Delete isolation across scopes', () => {
  it('leaves the other scope’s folders and assignments unchanged', async () => {
    await fc.assert(
      fc
        .asyncProperty(
          arbScope,
          fc.uniqueArray(arbPoolName, { minLength: 1, maxLength: 4 }),
          fc.array(arbPoolName, { maxLength: 10 }),
          async (scope, names, assignments) => {
            const other = otherScope(scope)
            for (const s of SCOPES) {
              for (const n of names) {
                await createFolder(n, s)
              }
            }
            await seedEntities(scope, OWNER, assignments)
            await seedEntities(other, OWNER, assignments)
            const otherFoldersBefore = await getFoldersByScope(other)
            const otherEntitiesBefore = await entityFolders(other)

            await deleteFolder(names[0], scope)

            expect(await getFoldersByScope(other)).toEqual(otherFoldersBefore)
            expect(await entityFolders(other)).toEqual(otherEntitiesBefore)
          },
        )
        .beforeEach(reset),
      { numRuns: NUM_RUNS },
    )
  })
})

describe('Feature: universal-folders, Property 10: Rename cascade updates entity references', () => {
  it('renames the folder and every assigned entity in the same scope', async () => {
    await fc.assert(
      fc
        .asyncProperty(
          arbScope,
          fc.array(fc.constantFrom('a', 'b', ''), {
            minLength: 1,
            maxLength: 15,
          }),
          arbName.filter((n) => n !== 'a' && n !== 'b'),
          arbWhitespace,
          async (scope, assignments, newName, ws) => {
            await seedForeignAccount(['a', 'b'])
            await createFolder('a', scope)
            await createFolder('b', scope)
            await seedEntities(scope, OWNER, assignments)
            await seedEntities(otherScope(scope), OWNER, assignments)
            const otherScopeBefore = await entityFolders(otherScope(scope))
            const foreignBefore = await ownerState(OTHER_OWNER)

            await renameFolder('a', ws + newName + ws, scope)

            const folders = await getFoldersByScope(scope)
            expect(folders.map((f) => f.name)).toEqual([newName, 'b'])
            expect(await entityFolders(scope)).toEqual(
              expectedFolders(
                scope,
                assignments.map((f) => (f === 'a' ? newName : f)),
              ),
            )
            expect(await entityFolders(otherScope(scope))).toEqual(
              otherScopeBefore,
            )
            expect(await ownerState(OTHER_OWNER)).toEqual(foreignBefore)
          },
        )
        .beforeEach(reset),
      { numRuns: NUM_RUNS },
    )
  })
})
