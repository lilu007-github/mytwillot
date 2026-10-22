import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { run } from './cli'
import { createDatasetLoader, loadDataset, pickAccount } from './data'
import { at, folder, storedTweet, writeMirror } from './fixture.test-helper'

let mirror: string

beforeEach(() => {
  process.env.TWILLOT_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'twillot-cfg-'))
  delete process.env.TWILLOT_DATA
  mirror = writeMirror([
    {
      ownerId: 'other',
      screenName: 'Alt',
      tweets: [storedTweet({ full_text: 'alt account tweet' })],
      now: new Date('2026-01-01T00:00:00Z'),
    },
    {
      ownerId: 'me',
      screenName: 'Me',
      tweets: [
        storedTweet({
          tweet_id: '11',
          full_text: 'Claude agents in practice',
          folder: 'LLM',
          created_at: at('2026-03-01T00:00:00Z'),
        }),
        storedTweet({
          tweet_id: '12',
          full_text: 'Gardening tips',
          created_at: at('2026-02-01T00:00:00Z'),
        }),
      ],
      folders: [folder('AI'), folder('LLM', 'AI', 1)],
      folderCounts: { LLM: 1 },
      now: new Date('2026-06-01T00:00:00Z'),
    },
  ])
})

afterEach(() => {
  delete process.env.TWILLOT_CONFIG_DIR
})

describe('data loading', () => {
  it('defaults to the most recently mirrored account', () => {
    const ds = loadDataset(mirror)
    expect(ds.account.screen_name).toBe('Me')
    expect(ds.tweets.map((t) => t.id)).toEqual(['11', '12'])
    expect(ds.folders.map((f) => f.path)).toEqual(['AI', 'AI/LLM'])
  })

  it('selects accounts by @name or id and lists choices on a miss', () => {
    const index = JSON.parse(readFileSync(join(mirror, 'index.json'), 'utf8'))
    expect(pickAccount(index, '@alt').owner_id).toBe('other')
    expect(pickAccount(index, 'me').owner_id).toBe('me')
    expect(() => pickAccount(index, 'nobody')).toThrow(/have: Alt, Me/)
  })

  it('refuses a mirror written by a newer schema', () => {
    writeFileSync(
      join(mirror, 'index.json'),
      JSON.stringify({ schema: 99, accounts: [] }),
    )
    expect(() => loadDataset(mirror)).toThrow(/newer than this CLI/)
  })

  it('reloads only after the extension rewrites the mirror', () => {
    const load = createDatasetLoader(mirror)
    const first = load()
    expect(load()).toBe(first)
    const index = join(mirror, 'index.json')
    writeFileSync(index, readFileSync(index, 'utf8') + ' ')
    expect(load()).not.toBe(first)
  })
})

describe('twillot CLI', () => {
  it('explains how to set up when no folder is configured', async () => {
    await expect(run(['search', 'x'])).rejects.toThrow(/twillot init/)
  })

  it('init remembers the folder for later commands', async () => {
    expect(await run(['init', mirror])).toMatch(/Found 2 mirrored accounts/)
    expect(await run(['search', 'claude'])).toContain(
      'Claude agents in practice',
    )
  })

  it('searches with filters in every output format', async () => {
    const base = ['--data', mirror]
    const text = await run(['search', 'agents', ...base])
    expect(text).toContain('@ada')
    expect(text).toContain('AI/LLM')
    expect(text).toMatch(/1-1 of 1$/)

    const json = JSON.parse(
      (await run(['search', '--folder', 'AI', '--json', ...base]))!,
    )
    expect(json.total).toBe(1)
    expect(json.items[0].id).toBe('11')

    const md = await run(['search', '--unsorted', '-f', 'md', ...base])
    expect(md).toContain('> Gardening tips')
    expect(md).toContain('[link](https://x.com/ada/status/12)')

    expect(await run(['search', '--account', 'alt', ...base])).toContain(
      'alt account tweet',
    )
  })

  it('shows, lists and summarizes', async () => {
    const base = ['--data', mirror]
    expect(
      await run(['show', 'https://x.com/ada/status/12', ...base]),
    ).toContain('Gardening tips')
    expect(await run(['folders', ...base])).toBe('0  AI\n1  AI/LLM')
    expect(await run(['stats', ...base])).toMatch(
      /^2 items, 2026-02-01 → 2026-03-01/,
    )
    expect(await run(['trends', '--period', 'year', ...base])).toContain(
      '2026  (2)',
    )
  })

  it('runs read-only SQL and reports the index', async () => {
    const base = ['--data', mirror]
    expect(
      await run(['sql', 'SELECT id, folder FROM tweets ORDER BY id', ...base]),
    ).toBe('id  folder\n--  ------\n11  AI/LLM\n12\n\n2 rows')
    const json = JSON.parse(
      (await run([
        'sql',
        'SELECT count(*) AS n FROM tweets',
        '--json',
        ...base,
      ]))!,
    )
    expect(json).toEqual({ columns: ['n'], rows: [{ n: 2 }], truncated: false })
    expect(
      await run(['sql', 'SELECT id FROM tweets', '--limit', '1', ...base]),
    ).toMatch(/1 row \(truncated; raise --limit\)$/)
    expect(await run(['sql', 'SELECT 1 WHERE 0', ...base])).toBe('(no rows)')
    expect(await run(['sql', '--schema', ...base])).toContain('fts_query')
    await expect(run(['sql', 'DELETE FROM tweets', ...base])).rejects.toThrow(
      /readonly/,
    )
    await expect(run(['sql', ...base])).rejects.toThrow(/Usage: twillot sql/)
    expect(await run(['index', '--rebuild', ...base])).toMatch(/Rows:\s+2/)
  })

  it('rejects bad option values as usage errors', async () => {
    const base = ['--data', mirror]
    await expect(run(['search', '--sort', 'random', ...base])).rejects.toThrow(
      /--sort must be one of/,
    )
    await expect(run(['search', '--limit', '-1', ...base])).rejects.toThrow()
    await expect(run(['frobnicate', ...base])).rejects.toThrow(
      /Unknown command/,
    )
    await expect(run(['search', '--nope'])).rejects.toThrow()
  })

  it('prints help without needing a mirror', async () => {
    expect(await run([])).toContain('Usage: twillot <command>')
    expect(await run(['--version'])).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
