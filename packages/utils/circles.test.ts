import { describe, it, expect } from 'vitest'
import {
  type CircleMember,
  mutualCircle,
  normalizeLocation,
  clusterByLocation,
  extractTopicTokens,
  clusterByTopic,
  detectCommunities,
  graphCircles,
} from './circles'

function member(overrides: Partial<CircleMember>): CircleMember {
  return {
    rest_id: '0',
    name: 'Name',
    screen_name: 'handle',
    profile_image_url_https: '',
    description: '',
    location: '',
    is_blue_verified: false,
    ...overrides,
  }
}

describe('mutualCircle', () => {
  it('keeps only following that are also followers', () => {
    const following = [
      member({ rest_id: 'a' }),
      member({ rest_id: 'b' }),
      member({ rest_id: 'c' }),
    ]
    const circle = mutualCircle(following, new Set(['a', 'c', 'z']))
    expect(circle.members.map((m) => m.rest_id)).toEqual(['a', 'c'])
    expect(circle.kind).toBe('mutual')
  })
})

describe('normalizeLocation', () => {
  it('lowercases, trims, collapses whitespace', () => {
    expect(normalizeLocation('  San   Francisco ')).toBe('san francisco')
    expect(normalizeLocation('')).toBe('')
  })
})

describe('clusterByLocation', () => {
  it('groups by normalized location and drops singletons', () => {
    const following = [
      member({ rest_id: 'a', location: 'San Francisco' }),
      member({ rest_id: 'b', location: 'san francisco' }),
      member({ rest_id: 'c', location: 'Tokyo' }),
      member({ rest_id: 'd', location: '' }),
    ]
    const circles = clusterByLocation(following, 2)
    expect(circles).toHaveLength(1)
    expect(circles[0].label).toBe('San Francisco')
    expect(circles[0].members.map((m) => m.rest_id).sort()).toEqual(['a', 'b'])
  })
})

describe('extractTopicTokens', () => {
  it('pulls hashtags and non-stopword words, drops junk', () => {
    const toks = extractTopicTokens('AI researcher #crypto, love the web3')
    expect(toks).toContain('crypto')
    expect(toks).toContain('researcher')
    expect(toks).toContain('web')
    expect(toks).not.toContain('the')
    expect(toks).not.toContain('love')
  })
})

describe('clusterByTopic', () => {
  it('creates a circle per frequent token', () => {
    const following = [
      member({ rest_id: 'a', description: 'crypto trader' }),
      member({ rest_id: 'b', description: 'crypto founder' }),
      member({ rest_id: 'c', description: 'crypto degen' }),
      member({ rest_id: 'd', description: 'gardening enthusiast' }),
    ]
    const circles = clusterByTopic(following, { minSize: 3 })
    const crypto = circles.find((c) => c.label === '#crypto')
    expect(crypto).toBeTruthy()
    expect(crypto!.members).toHaveLength(3)
  })
})

describe('detectCommunities', () => {
  it('separates two disconnected cliques', () => {
    const nodes = ['a', 'b', 'c', 'x', 'y', 'z']
    const edges: Array<[string, string]> = [
      ['a', 'b'],
      ['b', 'c'],
      ['a', 'c'],
      ['x', 'y'],
      ['y', 'z'],
      ['x', 'z'],
    ]
    const communities = detectCommunities(nodes, edges)
    expect(communities).toHaveLength(2)
    expect(communities[0]).toHaveLength(3)
    // Deterministic across runs
    expect(detectCommunities(nodes, edges)).toEqual(communities)
  })

  it('ignores edges to unknown nodes', () => {
    const communities = detectCommunities(['a', 'b'], [
      ['a', 'b'],
      ['a', 'ghost'],
    ])
    expect(communities).toEqual([['a', 'b']])
  })
})

describe('graphCircles', () => {
  it('builds circles from internal edges only, respecting minSize', () => {
    const following = [
      member({ rest_id: 'a', name: 'Alice' }),
      member({ rest_id: 'b', name: 'Bob' }),
      member({ rest_id: 'c', name: 'Carol' }),
      member({ rest_id: 'd', name: 'Dave' }),
    ]
    const edges: Array<[string, string]> = [
      ['a', 'b'],
      ['b', 'c'],
      ['a', 'c'],
      ['d', 'stranger'], // dropped: stranger not followed
    ]
    const circles = graphCircles(following, edges, 3)
    expect(circles).toHaveLength(1)
    expect(circles[0].members.map((m) => m.rest_id).sort()).toEqual([
      'a',
      'b',
      'c',
    ])
    expect(circles[0].kind).toBe('graph')
  })
})
