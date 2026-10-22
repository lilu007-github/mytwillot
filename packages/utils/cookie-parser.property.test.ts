import { describe, it } from 'vitest'
import fc from 'fast-check'

import { parseTwidCookie } from './cookie-parser'
import { NUM_RUNS } from './test-utils'

const PREFIX = 'u%3D'

describe('Feature: multi-account-support, Property 1: Cookie Parsing Round-Trip', () => {
  it('parses back any numeric id encoded as u%3D{id}', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^\d{1,25}$/), (id) => {
        return parseTwidCookie(PREFIX + id) === id
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it('returns empty string when the prefix is absent', () => {
    fc.assert(
      fc.property(
        fc
          .option(fc.string(), { nil: undefined })
          .filter((s) => !s || !s.includes(PREFIX)),
        (value) => parseTwidCookie(value) === '',
      ),
      { numRuns: NUM_RUNS },
    )
    fc.assert(
      fc.property(fc.constantFrom(null, undefined, ''), (value) => {
        return parseTwidCookie(value) === ''
      }),
    )
  })

  it('returns empty string when the value after the prefix is not numeric', () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !/^\d+$/.test(s) && !s.includes(PREFIX)),
        (suffix) => parseTwidCookie(PREFIX + suffix) === '',
      ),
      { numRuns: NUM_RUNS },
    )
  })
})
