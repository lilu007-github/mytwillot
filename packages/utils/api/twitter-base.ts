import { Endpoint } from '../types'
import { getCurrentUserId, getAuthInfo } from '../storage'
import fetchWithTimeout, { FetchError } from '../xfetch'

interface RateLimitInfo {
  limit: number
  remaining: number
  reset: number
}

let rateLimitInfo: Record<string, Record<Endpoint, RateLimitInfo>> = {}

function get_headers(headers: {
  token: string
  csrf: string
  uuid: string
  transaction_id: string
}) {
  const { token, csrf, uuid, transaction_id } = headers
  return {
    Authorization: token,
    'X-Csrf-Token': csrf,
    'X-Client-Uuid': uuid,
    'X-Client-Transaction-Id': transaction_id,
    'Content-Type': 'application/json',
    'X-Twitter-Active-User': 'yes',
    'X-Twitter-Auth-Type': 'OAuth2Session',
    'X-Twitter-Client-Language': 'en',
  }
}

interface SerializedResponse {
  status: number
  headers: Record<string, string>
  body: string
}

async function fetchFromXPageContext(
  url: string,
  options: RequestInit,
): Promise<Response | null> {
  if (!chrome?.scripting || !chrome?.tabs) {
    return null
  }

  const tabs = await chrome.tabs.query({
    url: ['https://x.com/*', 'https://*.x.com/*'],
    currentWindow: true,
  })
  const tab =
    tabs.find((item) => item.active && item.id !== undefined) ??
    tabs.find(
      (item) => item.url?.includes('/followers') && item.id !== undefined,
    ) ??
    tabs.find((item) => item.id !== undefined)
  if (!tab?.id) {
    console.warn('No x.com tab found for page-context request')
    return null
  }

  let injectionResult: chrome.scripting.InjectionResult<SerializedResponse>[]
  try {
    injectionResult = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      args: [
        url,
        {
          method: options.method || 'GET',
          headers:
            options.headers && Object.keys(options.headers).length > 0
              ? options.headers
              : null,
          body: typeof options.body === 'string' ? options.body : null,
        },
      ],
      func: async (
        requestUrl: string,
        requestOptions: {
          method: string
          headers: Record<string, string> | null
          body: string | null
        },
      ): Promise<SerializedResponse> => {
        const response = await fetch(requestUrl, {
          method: requestOptions.method,
          ...(requestOptions.headers
            ? { headers: requestOptions.headers }
            : {}),
          body: requestOptions.body,
          credentials: 'include',
        })
        return {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          body: await response.text(),
        }
      },
    })
  } catch (err) {
    console.warn('Failed to fetch from x.com page context', err)
    return null
  }

  const [{ result }] = injectionResult

  if (!result) {
    return null
  }

  return new Response(result.body, {
    status: result.status,
    headers: result.headers,
  })
}

export function getRateLimitInfo(endpoint: Endpoint, uid: string) {
  if (!uid) {
    return null
  }

  return rateLimitInfo[uid]?.[endpoint] || null
}

export async function request(
  url: string,
  options: RequestInit,
  requestOptions: { useXPageContext?: boolean } = {},
) {
  // x.com page-context requests should use the freshest headers captured from
  // the page. Missing stored auth must not block page-context requests, but X's
  // GraphQL endpoints still reject user-list requests without auth headers.
  if (!options.headers?.['authorization']) {
    const headers = await getAuthInfo()
    if (!headers.token && !requestOptions.useXPageContext) {
      const error = new Error('No token found')
      error.name = FetchError.IdentityError
      throw error
    }

    if (!headers.token) {
      // Let the page-context fetch try with cookies only.
      return requestWithOptions(url, options, requestOptions)
    }

    const authHeaders = get_headers(headers)
    // Preserve caller-specified Content-Type (e.g. for form-urlencoded v1.1 endpoints)
    if (options.headers?.['Content-Type']) {
      delete authHeaders['Content-Type']
    }
    options.headers = {
      ...options.headers,
      ...authHeaders,
    }
  }
  return requestWithOptions(url, options, requestOptions)
}

async function requestWithOptions(
  url: string,
  options: RequestInit,
  requestOptions: { useXPageContext?: boolean },
) {
  if (options.body instanceof FormData) {
    delete options.headers['Content-Type']
  }
  const requestInit = {
    method: 'POST',
    credentials: 'include',
    ...options,
  } as RequestInit
  const res =
    (requestOptions.useXPageContext
      ? await fetchFromXPageContext(url, requestInit)
      : null) || (await fetchWithTimeout(url, requestInit))
  const uid = await getCurrentUserId()
  const reset = res.headers.get('X-Rate-Limit-Reset')
  if (uid) {
    const limit = res.headers.get('X-Rate-Limit-Limit')
    const remaining = res.headers.get('X-Rate-Limit-Remaining')
    if (limit && remaining && reset) {
      const endpoint = url.split('?')[0] as Endpoint
      rateLimitInfo[uid] = {
        [endpoint]: {
          limit: parseInt(limit),
          remaining: parseInt(remaining),
          reset: parseInt(reset),
        },
      } as Record<Endpoint, RateLimitInfo>
    }
  }
  if (res.status === 403) {
    const error = new Error('Forbidden')
    error.name = FetchError.IdentityError
    throw error
  }

  if (res.status === 429) {
    const error = new Error('Too many requests')
    error.name = FetchError.RateLimitError
    throw error
  }

  // 404 means the persisted GraphQL query id is stale (Twitter rotated it).
  // The body is empty, so attempting res.json() would throw a confusing
  // "Unexpected end of JSON input". Surface a clear, actionable error instead.
  if (res.status === 404) {
    const error = new Error(
      'This endpoint is unavailable. It may require X Premium, or the API has changed. Please try again later.',
    )
    error.name = FetchError.EndpointError
    throw error
  }

  // No Content
  if (res.status === 204) {
    return
  }

  const data = await res.json()
  if ('errors' in data) {
    const leftTime = reset
      ? Math.ceil((parseInt(reset) * 1000 - Date.now()) / 60000)
      : 10
    const error = new Error(
      `Server error occurred, retry after ${leftTime} minutes.`,
    )
    error.name = FetchError.DataError
    throw error
  }

  return data
}

export function flatten(obj: {}, stringify = true) {
  return Object.keys(obj)
    .map(
      (key) =>
        `${key}=${encodeURIComponent(stringify ? JSON.stringify(obj[key]) : obj[key])}`,
    )
    .join('&')
}
