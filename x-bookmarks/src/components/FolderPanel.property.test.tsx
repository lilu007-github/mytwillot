import { describe, it, expect } from 'vitest'
import { render, cleanup } from '@solidjs/testing-library'
import fc from 'fast-check'

import { NUM_RUNS, resetEnv } from 'utils/test-utils'
import {
  createFolder as dbCreateFolder,
  reorderFolders as dbReorderFolders,
} from 'utils/db/folders'
import type { EntityScope } from 'utils/types'
import { initFolders } from '../stores/folders'
import FolderPanel from './FolderPanel'

const SCOPES: EntityScope[] = ['bookmark', 'user']

const arbName = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter((s) => s.trim() === s && s.length > 0)

/** Unique names per scope plus a persisted (shuffled) order for each. */
const arbScopeFolders = fc
  .uniqueArray(arbName, { maxLength: 6 })
  .chain((names) =>
    fc.tuple(
      fc.constant(names),
      fc.shuffledSubarray(names, {
        minLength: names.length,
        maxLength: names.length,
      }),
    ),
  )

describe('Feature: universal-folders, Property 13: Context-aware folder display', () => {
  it('shows exactly the active scope’s folders in persisted sort order', async () => {
    await fc.assert(
      fc
        .asyncProperty(
          fc.record({ bookmark: arbScopeFolders, user: arbScopeFolders }),
          fc.constantFrom(...SCOPES),
          async (byScope, scope) => {
            for (const s of SCOPES) {
              const [names, order] = byScope[s]
              for (const n of names) {
                await dbCreateFolder(n, s)
              }
              await dbReorderFolders(order, s)
            }
            await initFolders(scope)

            const { container } = render(() => (
              <FolderPanel
                scope={scope}
                unsortedCount={0}
                isOpen={true}
                onToggle={() => {}}
              />
            ))
            const shown = [
              ...container.querySelectorAll('li span.truncate'),
            ].map((el) => el.textContent)
            expect(shown).toEqual(byScope[scope][1])
          },
        )
        .beforeEach(async () => {
          cleanup()
          await resetEnv('111')
        })
        .afterEach(() => cleanup()),
      { numRuns: NUM_RUNS },
    )
  })
})
