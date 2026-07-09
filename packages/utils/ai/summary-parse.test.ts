import { describe, it, expect } from 'vitest'
import { parseSummaryResponse } from './classify'

describe('parseSummaryResponse', () => {
  it('parses a plain JSON object', () => {
    const r = parseSummaryResponse(
      '{"summary": "A note about startups.", "keywords": ["Startups", "YC"]}',
    )
    expect(r.summary).toBe('A note about startups.')
    expect(r.keywords).toEqual(['startups', 'yc'])
  })

  it('tolerates a ```json code fence', () => {
    const r = parseSummaryResponse(
      '```json\n{"summary":"Hi","keywords":["a","b"]}\n```',
    )
    expect(r.summary).toBe('Hi')
    expect(r.keywords).toEqual(['a', 'b'])
  })

  it('tagifies keywords: lowercase, spaces to hyphens, strip #, dedup', () => {
    const r = parseSummaryResponse(
      '{"summary":"x","keywords":["Machine Learning","#AI","machine learning"]}',
    )
    expect(r.keywords).toEqual(['machine-learning', 'ai'])
  })

  it('caps keywords at 6', () => {
    const r = parseSummaryResponse(
      JSON.stringify({
        summary: 's',
        keywords: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
      }),
    )
    expect(r.keywords).toHaveLength(6)
  })

  it('falls back to treating non-JSON as the summary', () => {
    const r = parseSummaryResponse('Just a plain sentence.')
    expect(r.summary).toBe('Just a plain sentence.')
    expect(r.keywords).toEqual([])
  })
})
