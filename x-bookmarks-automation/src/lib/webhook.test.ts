import { afterEach, describe, expect, it, vi } from 'vitest'

import { postWebhook } from './webhook'

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubFetch(response: Partial<Response> | Error) {
  const fetchMock = vi.fn(async () => {
    if (response instanceof Error) {
      throw response
    }
    return response as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('postWebhook', () => {
  it('posts the tweet straight to the user endpoint with a Bearer token', async () => {
    const fetchMock = stubFetch({ ok: true, status: 200 })

    const result = await postWebhook('https://hooks.example.com/x', 'secret', {
      tweet_id: '1',
    })

    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(String(url)).toBe('https://hooks.example.com/x')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer secret',
    })
    expect(JSON.parse(init.body as string)).toEqual({ data: { tweet_id: '1' } })
  })

  it('omits the Authorization header when no token is set', async () => {
    const fetchMock = stubFetch({ ok: true, status: 200 })
    await postWebhook('https://hooks.example.com/x', '', {})
    const [, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
  })

  it.each(['not a url', 'javascript:alert(1)', 'file:///etc/passwd'])(
    'rejects %s without sending anything',
    async (url) => {
      const fetchMock = stubFetch({ ok: true, status: 200 })
      const result = await postWebhook(url, 't', {})
      expect(result.ok).toBe(false)
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it('reports HTTP and network failures instead of throwing', async () => {
    stubFetch({ ok: false, status: 401 })
    expect(await postWebhook('https://h.example.com', 't', {})).toEqual({
      ok: false,
      error: 'HTTP 401',
    })

    stubFetch(new TypeError('Failed to fetch'))
    expect(await postWebhook('https://h.example.com', 't', {})).toEqual({
      ok: false,
      error: 'Failed to fetch',
    })
  })
})
