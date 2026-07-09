/**
 * Parse the `twid` cookie value to extract the numeric user ID.
 *
 * The `twid` cookie is encoded as `u%3D{user_id}` (URL-encoded `u={user_id}`).
 * Returns the numeric user ID string, or an empty string if the value is
 * absent, malformed, or does not contain a valid numeric ID after the prefix.
 */
export function parseTwidCookie(cookieValue: string | undefined | null): string {
  if (!cookieValue) {
    return ''
  }

  const prefix = 'u%3D'
  const index = cookieValue.indexOf(prefix)
  if (index === -1) {
    return ''
  }

  const id = cookieValue.slice(index + prefix.length)
  if (!id || !/^\d+$/.test(id)) {
    return ''
  }

  return id
}
