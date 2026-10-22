import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'

import { makePost, putRaw, resetEnv } from 'utils/test-utils'
import { TWEETS_TABLE_NAME_V2 } from 'utils/db/index'
import { createFolder } from 'utils/db/folders'
import { upsertAccountEntry } from 'utils/account-manager'

import { autoMirror, getLastMirror, mirrorNow } from './agent-mirror'

// Real directory handles are structured-cloneable into IndexedDB; the fake
// one has methods, so serve the saved handle from here instead.
let savedHandle: any
vi.mock('./vault', async (importOriginal) => {
  const actual: any = await importOriginal()
  return {
    ...actual,
    metaGet: async (key: string) =>
      key === 'agent_mirror_handle' ? savedHandle : actual.metaGet(key),
  }
})

const OWNER = '111'

/** In-memory stand-in for a File System Access directory handle. */
function fakeDir(name = 'mirror', files = new Map<string, string>()) {
  const writes: string[] = []
  let permission = 'granted'
  const dir = (prefix: string): any => ({
    name,
    async getDirectoryHandle(child: string) {
      return dir(`${prefix}${child}/`)
    },
    async getFileHandle(file: string, opts?: { create?: boolean }) {
      const path = prefix + file
      if (!files.has(path) && !opts?.create) {
        throw Object.assign(new Error('missing'), { name: 'NotFoundError' })
      }
      return {
        async getFile() {
          return { text: async () => files.get(path) ?? '' }
        },
        async createWritable() {
          let content = ''
          return {
            async write(chunk: string) {
              content += chunk
            },
            async close() {
              files.set(path, content)
              writes.push(path)
            },
          }
        },
      }
    },
    async queryPermission() {
      return permission
    },
    async requestPermission() {
      return permission
    },
  })
  return {
    handle: dir(''),
    files,
    writes,
    deny: () => (permission = 'prompt'),
    grant: () => (permission = 'granted'),
  }
}

afterEach(() => {
  vi.useRealTimers()
})

beforeEach(async () => {
  savedHandle = undefined
  await resetEnv(OWNER)
  await upsertAccountEntry({
    user_id: OWNER,
    screen_name: 'me',
  })
  await putRaw(TWEETS_TABLE_NAME_V2, [
    makePost(OWNER, '1', { folder: 'AI', created_at: 1_700_000_100 }),
    makePost(OWNER, '2', { category_name: 'likes' }),
    makePost('999', '3'), // another account: never mirrored here
  ])
  await createFolder('AI', 'bookmark')
})

describe('agent mirror', () => {
  it('writes the account snapshot, index and README', async () => {
    const fs = fakeDir()
    const res = await mirrorNow(fs.handle)

    expect(res).toMatchObject({ owner_id: OWNER, total: 2 })
    expect([...fs.files.keys()].sort()).toEqual([
      'README.md',
      `accounts/${OWNER}/folders.json`,
      `accounts/${OWNER}/meta.json`,
      `accounts/${OWNER}/tags.json`,
      `accounts/${OWNER}/tweets.jsonl`,
      'index.json',
    ])
    const lines = fs.files
      .get(`accounts/${OWNER}/tweets.jsonl`)!
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
    expect(lines.map((t) => [t.id, t.category, t.folder])).toEqual([
      ['1', 'bookmarks', 'AI'],
      ['2', 'likes', null],
    ])
    expect(JSON.parse(fs.files.get(`accounts/${OWNER}/folders.json`)!)).toEqual(
      [{ name: 'AI', path: 'AI', parent: null, count: 1 }],
    )
    const index = JSON.parse(fs.files.get('index.json')!)
    expect(index.accounts.map((a: any) => [a.owner_id, a.screen_name])).toEqual(
      [[OWNER, 'me']],
    )
    expect(await getLastMirror()).toEqual(res)
  })

  it('rewrites only changed files and keeps other accounts in the index', async () => {
    const files = new Map([
      [
        'index.json',
        JSON.stringify({
          schema: 1,
          accounts: [{ owner_id: '999', screen_name: 'alt' }],
        }),
      ],
    ])
    const fs = fakeDir('mirror', files)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    await mirrorNow(fs.handle)
    fs.writes.length = 0

    vi.setSystemTime(new Date('2026-01-01T00:15:00Z'))
    await mirrorNow(fs.handle)
    // Data unchanged: only meta.json / index.json (new exported_at).
    expect(fs.writes.sort()).toEqual([
      `accounts/${OWNER}/meta.json`,
      'index.json',
    ])
    const index = JSON.parse(files.get('index.json')!)
    expect(index.accounts.map((a: any) => a.owner_id)).toEqual(['999', OWNER])
  })

  it('auto-mirrors only with a saved folder and granted permission', async () => {
    expect(await autoMirror()).toBeNull()

    const fs = fakeDir()
    savedHandle = fs.handle
    fs.deny()
    expect(await autoMirror()).toBeNull()
    expect(fs.writes).toEqual([])

    fs.grant()
    expect(await autoMirror()).toMatchObject({ total: 2 })
    expect(fs.writes.length).toBeGreaterThan(0)
  })
})
