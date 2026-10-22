import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

import { NUM_RUNS, makePost, putRaw, resetEnv } from 'utils/test-utils'
import { findRecords } from 'utils/db/tweets'
import { TWEETS_TABLE_NAME_V2 } from 'utils/db/index'
import type { StoredUser } from 'utils/db/users'
import { filterByFolder } from './useGridData'

const OWNER = '111'

// Case variants on purpose: folder names are case-sensitive identities.
// ('Unsorted' is the filter sentinel and is excluded as a folder name.)
const FOLDER_NAMES = ['Work', 'work', 'AI', 'news']
const arbFolderField = fc.constantFrom<string | undefined | null>(
  undefined,
  null,
  '',
  ...FOLDER_NAMES,
)
const arbSelection = fc.constantFrom('Unsorted', ...FOLDER_NAMES)

function matches(folder: string | undefined | null, selection: string) {
  return selection === 'Unsorted' ? !folder : folder === selection
}

describe('Feature: universal-folders, Property 15: Folder filter correctness', () => {
  it('bookmark grid query returns exactly the entities matching the selection', async () => {
    await fc.assert(
      fc
        .asyncProperty(
          fc.array(arbFolderField, { maxLength: 30 }),
          arbSelection,
          async (folders, selection) => {
            const posts = folders.map((folder, i) =>
              makePost(OWNER, String(i + 1), { folder }),
            )
            await putRaw(TWEETS_TABLE_NAME_V2, posts)

            const found = await findRecords('', '', selection, '', 1000)

            expect(found.map((t) => t.id).sort()).toEqual(
              posts
                .filter((p) => matches(p.folder, selection))
                .map((p) => p.id)
                .sort(),
            )
          },
        )
        .beforeEach(() => resetEnv(OWNER)),
      { numRuns: NUM_RUNS },
    )
  })

  it('users grid filter returns exactly the entities matching the selection', () => {
    fc.assert(
      fc.property(
        fc.array(arbFolderField, { maxLength: 30 }),
        fc.option(arbSelection, { nil: null }),
        (folders, selection) => {
          const users = folders.map(
            (folder, i) => ({ id: String(i), folder }) as StoredUser,
          )
          const shown = filterByFolder(users, selection)
          expect(shown).toEqual(
            selection === null
              ? users
              : users.filter((u) => matches(u.folder, selection)),
          )
        },
      ),
      { numRuns: NUM_RUNS },
    )
  })
})
