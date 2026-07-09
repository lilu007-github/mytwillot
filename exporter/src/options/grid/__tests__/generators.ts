import fc from 'fast-check'
import type { StoredUser } from 'utils/db/users'

export const arbRelationship = fc.constantFrom(
  'follower' as const,
  'following' as const,
)

export const arbStoredUser: fc.Arbitrary<StoredUser> = fc.record({
  id: fc.uuid(),
  rest_id: fc.string({ minLength: 1, maxLength: 20 }),
  owner_id: fc.string({ minLength: 1, maxLength: 20 }),
  relationship: arbRelationship,
  name: fc.string({ minLength: 1, maxLength: 50 }),
  screen_name: fc.string({ minLength: 1, maxLength: 15 }),
  profile_image_url_https: fc.webUrl(),
  profile_banner_url: fc.option(fc.webUrl(), { nil: undefined }),
  description: fc.string({ minLength: 0, maxLength: 160 }),
  followers_count: fc.nat({ max: 10_000_000 }),
  friends_count: fc.nat({ max: 10_000_000 }),
  statuses_count: fc.nat({ max: 10_000_000 }),
  is_blue_verified: fc.boolean(),
  location: fc.string({ minLength: 0, maxLength: 30 }),
  created_at: fc.integer({
    min: new Date('2006-03-21').getTime(),
    max: new Date('2025-01-01').getTime(),
  }).map((ts) => new Date(ts).toISOString()),
  synced_at: fc.nat({ max: 2_000_000_000_000 }),
})

export const arbStoredUserList = (
  minLength = 0,
  maxLength = 50,
): fc.Arbitrary<StoredUser[]> =>
  fc.array(arbStoredUser, { minLength, maxLength })

export const arbNonEmptyStoredUserList = (
  maxLength = 50,
): fc.Arbitrary<StoredUser[]> =>
  fc.array(arbStoredUser, { minLength: 1, maxLength })
