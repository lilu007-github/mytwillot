import { describe, it, expect } from 'vitest'
import { obsidianNote } from './exporter'
import { createZipBytes } from './zip'
import { buildObsidianUri } from './obsidian-rest'

describe('obsidianNote', () => {
  it('builds frontmatter, wikilinks, thread quotes and file path', () => {
    const { path, content } = obsidianNote({
      screen_name: 'paulg',
      username: 'Paul Graham',
      tweet_id: '123',
      created_at: 1740787200, // 2025-03-01 (UTC)
      full_text: 'Startups are hard.',
      folder: 'Reading',
      tags: ['startups', 'essays'],
      conversations: [{ full_text: 'But worth it.' }],
      media_items: [{ media_url_https: 'https://pbs.twimg.com/x.jpg' }],
    })

    expect(path).toBe('Reading/2025-03-01-paulg-123.md')
    expect(content).toContain('author: Paul Graham')
    expect(content).toContain('handle: paulg')
    expect(content).toContain('url: "https://x.com/paulg/status/123"')
    expect(content).toContain('date: 2025-03-01')
    expect(content).toContain('tags: [startups, essays]')
    expect(content).toContain('[[@paulg]]')
    expect(content).toContain('> But worth it.')
    expect(content).toContain('![](https://pbs.twimg.com/x.jpg)')
    expect(content).toContain('[View on X](https://x.com/paulg/status/123)')
  })

  it('falls back to Unsorted folder and sanitizes illegal chars', () => {
    const { path } = obsidianNote({
      screen_name: 'a/b',
      tweet_id: '9',
      full_text: 'hi',
    })
    expect(path.startsWith('Unsorted/')).toBe(true)
    expect(path).not.toContain('a/b')
  })
})

describe('buildObsidianUri', () => {
  it('encodes vault, file (no .md) and content', () => {
    const uri = buildObsidianUri(
      { screen_name: 'paulg', tweet_id: '5', full_text: 'hi', folder: 'Reading' },
      'MyVault',
    )
    expect(uri.startsWith('obsidian://new?')).toBe(true)
    const params = new URLSearchParams(uri.slice('obsidian://new?'.length))
    expect(params.get('vault')).toBe('MyVault')
    expect(params.get('file')).toBe('Reading/paulg-5')
    expect(params.get('content')).toContain('hi')
  })

  it('caps overly long content', () => {
    const uri = buildObsidianUri(
      { screen_name: 'a', tweet_id: '1', full_text: 'x'.repeat(9000) },
      '',
    )
    const params = new URLSearchParams(uri.slice('obsidian://new?'.length))
    expect(params.has('vault')).toBe(false)
    expect(params.get('content')!.length).toBeLessThan(6100)
    expect(params.get('content')).toContain('truncated')
  })
})

describe('createZip', () => {
  it('produces a valid local-file-header signature', () => {
    const bytes = createZipBytes([
      { name: 'a/x.md', data: new TextEncoder().encode('hello') },
    ])
    expect(bytes.length).toBeGreaterThan(0)
    // Local file header magic: PK\x03\x04
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04])
    // EOCD magic at the tail: PK\x05\x06
    expect([bytes[bytes.length - 22], bytes[bytes.length - 21]]).toEqual([0x50, 0x4b])
  })
})
