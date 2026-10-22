import { describe, it, expect } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

import { createServer } from './mcp'
import { at, folder, storedTweet, writeMirror } from './fixture.test-helper'

async function connect() {
  const mirror = writeMirror([
    {
      ownerId: 'me',
      screenName: 'Me',
      tweets: [
        storedTweet({
          tweet_id: '1',
          full_text: 'Claude agents ' + 'x'.repeat(600),
          folder: 'AI',
          created_at: at('2026-03-01T00:00:00Z'),
          conversations: [{ full_text: 'part two' }],
        }),
        storedTweet({
          tweet_id: '2',
          full_text: 'unsorted gardening',
          created_at: at('2026-02-01T00:00:00Z'),
        }),
      ],
      folders: [folder('AI')],
      folderCounts: { AI: 1 },
    },
  ])
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await createServer(mirror).connect(serverSide)
  const client = new Client({ name: 'test', version: '0' })
  await client.connect(clientSide)
  return client
}

async function call(client: Client, name: string, args = {}) {
  const res: any = await client.callTool({ name, arguments: args })
  expect(res.isError).toBeFalsy()
  return JSON.parse(res.content[0].text)
}

describe('MCP server', () => {
  it('exposes read-only tools and prompts', async () => {
    const client = await connect()
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([
      'get_tweets',
      'list_folders',
      'list_tags',
      'mirror_info',
      'search_tweets',
      'stats',
      'trends',
    ])
    expect(tools.every((t) => t.annotations?.readOnlyHint)).toBe(true)
    const { prompts } = await client.listPrompts()
    expect(prompts.map((p) => p.name).sort()).toEqual(['digest', 'organize'])
    const organize = await client.getPrompt({ name: 'organize', arguments: {} })
    expect(JSON.stringify(organize.messages)).toContain('unsorted=true')
  })

  it('searches with clipped text and returns full records on demand', async () => {
    const client = await connect()
    const hits = await call(client, 'search_tweets', { query: 'claude' })
    expect(hits).toMatchObject({ total: 1, returned: 1 })
    expect(hits.items[0]).toMatchObject({
      id: '1',
      folder: 'AI',
      thread_length: 1,
    })
    expect(hits.items[0].text.length).toBeLessThan(520)

    const unsorted = await call(client, 'search_tweets', { unsorted: true })
    expect(unsorted.items.map((t: any) => t.id)).toEqual(['2'])

    const [full] = await call(client, 'get_tweets', {
      ids: ['https://x.com/ada/status/1'],
    })
    expect(full.thread).toEqual(['part two'])
    expect(full.text.length).toBeGreaterThan(600)
  })

  it('serves folders, stats, trends and mirror info', async () => {
    const client = await connect()
    expect(await call(client, 'list_folders')).toEqual([
      { name: 'AI', path: 'AI', parent: null, count: 1 },
    ])
    expect((await call(client, 'stats')).total).toBe(2)
    expect(
      (await call(client, 'trends', { period: 'month' })).buckets,
    ).toHaveLength(2)
    expect((await call(client, 'mirror_info')).active_account.screen_name).toBe(
      'Me',
    )
  })

  it('reports bad input as a tool error, not a crash', async () => {
    const client = await connect()
    const res: any = await client.callTool({
      name: 'search_tweets',
      arguments: { since: 'yesterday-ish' },
    })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toMatch(/Bad date/)
  })
})
