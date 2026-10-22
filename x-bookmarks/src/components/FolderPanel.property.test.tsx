import { describe, it, expect } from 'vitest'
import { render, cleanup } from '@solidjs/testing-library'
import fc from 'fast-check'

import { NUM_RUNS, makePost, putRaw, resetEnv } from 'utils/test-utils'
import { TWEETS_TABLE_NAME_V2, USERS_TABLE_NAME } from 'utils/db/index'
import {
  createFolder as dbCreateFolder,
  reorderFolders as dbReorderFolders,
} from 'utils/db/folders'
import type { EntityScope } from 'utils/types'
import { initFolders, setActiveScope, folderState } from '../stores/folders'
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

  // Deterministic regressions (fast-check only sometimes generates these).
  const PROTO_NAMES = ['valueOf', 'constructor', 'toString', 'hasOwnProperty']

  function renderPanel(scope: EntityScope) {
    return render(() => (
      <FolderPanel
        scope={scope}
        unsortedCount={0}
        isOpen={true}
        onToggle={() => {}}
      />
    ))
  }

  function shownCounts(container: HTMLElement) {
    return [...container.querySelectorAll('li > div')].map((row) => [
      row.querySelector('span.truncate')?.textContent,
      row.querySelector('span.text-right')?.textContent,
    ])
  }

  it('renders folders named after Object.prototype members with count 0', async () => {
    cleanup()
    await resetEnv('111')
    for (const n of PROTO_NAMES) {
      await dbCreateFolder(n, 'bookmark')
    }
    await initFolders('bookmark')
    const { container } = renderPanel('bookmark')
    expect(shownCounts(container)).toEqual(PROTO_NAMES.map((n) => [n, '0']))
    cleanup()
  })

  it('does not show the previous scope’s counts after switching scope', async () => {
    cleanup()
    await resetEnv('111')
    await dbCreateFolder('shared', 'bookmark')
    await dbCreateFolder('shared', 'user')
    await putRaw(TWEETS_TABLE_NAME_V2, [
      makePost('111', '1', { folder: 'shared' }),
      makePost('111', '2', { folder: 'shared' }),
    ])
    await putRaw(USERS_TABLE_NAME, [])
    await initFolders('bookmark')
    expect(folderState.folderCounts).toEqual({ shared: 2 })

    setActiveScope('user')
    await new Promise((r) => setTimeout(r, 50))
    const { container } = renderPanel('user')
    expect(shownCounts(container)).toEqual([['shared', '0']])
    cleanup()
  })
})
