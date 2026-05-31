import { captureQueryIdFromUrl, syncAuthHeaders } from 'utils/storage'
import { Host } from 'utils/types'

chrome.action.onClicked.addListener(function () {
  chrome.runtime.openOptionsPage()
})

chrome.webRequest.onSendHeaders.addListener(
  async (details: chrome.webRequest.WebRequestHeadersDetails) => {
    const { url, initiator } = details
    // 当前页面不监听
    if (initiator !== Host) {
      return
    }

    /**
     * Capture the live persisted-query id for every GraphQL operation x.com
     * calls. Twitter rotates these ids, so hardcoded values eventually 404.
     */
    await captureQueryIdFromUrl(url)

    await syncAuthHeaders(details.requestHeaders)
  },
  {
    types: ['xmlhttprequest'],
    urls: [`${Host}/i/api/graphql/*`],
  },
  ['requestHeaders'],
)
