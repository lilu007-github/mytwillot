import { parseTwidCookie } from 'utils/cookie-parser'
import { detectAndSetActiveAccount } from 'utils/account-manager'
import { StorageKeys } from 'utils/storage'

const CAPTURE_SOURCE = 'twillot:x-graphql-response'
const USER_OPERATIONS = new Set(['Followers', 'Following', 'BlueVerifiedFollowers'])

document.documentElement.dataset.twillotCaptureBridge = 'loading'
setCaptureDebug('content-script-loaded')
injectCaptureScript()

const cookies = document.cookie.split(';')
const twidCookie = cookies.find((c) => c.trim().startsWith('twid='))
const twidValue = twidCookie?.split('=').slice(1).join('=')?.trim()
const userId = parseTwidCookie(twidValue)

detectAndSetActiveAccount(userId)

window.addEventListener('message', (event) => {
  // Only accept messages posted by our own page-world capture script on this
  // page: same window (not an iframe) and same origin. Anything else could be
  // a forged payload from an embedded frame or another script.
  if (event.source !== window || event.origin !== window.location.origin) {
    return
  }

  const message = event.data
  if (message?.source !== CAPTURE_SOURCE) {
    return
  }

  forwardCaptured(message.operation, message.url, message.json)
})

function forwardCaptured(operation: string, url: string, json: unknown) {
  setCaptureDebug('content-script-received', url)

  // Followers/Following go to the users store; everything else is a tweet
  // timeline that maps to a category (bookmarks/likes/posts/replies/media).
  if (USER_OPERATIONS.has(operation)) {
    chrome.runtime.sendMessage({
      type: 'TWILLOT_CAPTURED_X_USER_LIST',
      url,
      json,
    })
  } else {
    chrome.runtime.sendMessage({
      type: 'TWILLOT_CAPTURED_TIMELINE',
      operation,
      url,
      json,
    })
  }
}

function injectCaptureScript() {
  const script = document.createElement('script')
  script.src = chrome.runtime.getURL('captureGraphql.js')
  script.async = false
  script.onload = () => {
    document.documentElement.dataset.twillotCaptureBridge = 'loaded'
    setCaptureDebug('capture-script-loaded', script.src)
    script.remove()
  }
  script.onerror = () => {
    document.documentElement.dataset.twillotCaptureBridge = 'error'
    setCaptureDebug('capture-script-error', script.src)
  }
  ;(document.head || document.documentElement).appendChild(script)
}

function setCaptureDebug(stage: string, url?: string) {
  chrome.storage.local.set({
    [StorageKeys.Captured_Users_Debug]: {
      stage,
      url,
      page_url: window.location.href,
      updated_at: Date.now(),
    },
  })
}
