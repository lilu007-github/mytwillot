import { syncAuthHeaders } from 'utils/storage'
import { Host } from 'utils/types'

import { AUTOMATION_WEBHOOK_MESSAGE, postWebhook } from '~/lib/webhook'

chrome.webRequest.onSendHeaders.addListener(
  async (details: chrome.webRequest.WebRequestHeadersDetails) => {
    const { initiator } = details
    // 当前页面不监听
    if (initiator !== Host) {
      return
    }

    await syncAuthHeaders(details.requestHeaders)
  },
  {
    types: ['xmlhttprequest'],
    urls: [`${Host}/i/api/graphql/*`],
  },
  ['requestHeaders'],
)

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== AUTOMATION_WEBHOOK_MESSAGE) {
    return
  }
  // Only our own content script on an x.com tab may trigger a webhook post.
  if (sender.id !== chrome.runtime.id || !isXTab(sender.tab?.url)) {
    sendResponse({ ok: false, error: 'Rejected sender' })
    return
  }
  postWebhook(message.url, message.token, message.data).then(sendResponse)
  return true
})

function isXTab(url?: string) {
  try {
    const { protocol, hostname } = new URL(url || '')
    return (
      protocol === 'https:' &&
      (hostname === 'x.com' || hostname.endsWith('.x.com'))
    )
  } catch {
    return false
  }
}
