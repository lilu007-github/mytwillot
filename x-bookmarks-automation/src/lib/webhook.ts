import { fetchWithTimeout } from 'utils/fetch-timeout'

/** Content script → background: post a bookmarked tweet to the user's webhook. */
export const AUTOMATION_WEBHOOK_MESSAGE = 'TWILLOT_AUTOMATION_WEBHOOK'

/** Hosts the user's webhook may live on; requested when webhooks are enabled. */
export const WEBHOOK_ORIGINS = ['https://*/*', 'http://*/*']

export interface WebhookResult {
  ok: boolean
  error?: string
}

/**
 * POST `{ data }` as JSON straight to the user's own endpoint, with the token
 * as a Bearer header. Nothing goes through a third-party relay.
 */
export async function postWebhook(
  url: string,
  token: string,
  data: unknown,
): Promise<WebhookResult> {
  let target: URL
  try {
    target = new URL(url)
  } catch {
    return { ok: false, error: `Invalid webhook URL: ${url}` }
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    return { ok: false, error: `Unsupported webhook URL: ${url}` }
  }

  try {
    const res = await fetchWithTimeout(
      target,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ data }),
      },
      30_000,
    )
    return res.ok ? { ok: true } : { ok: false, error: `HTTP ${res.status}` }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
