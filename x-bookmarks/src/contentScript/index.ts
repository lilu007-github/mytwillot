import { parseTwidCookie } from 'utils/cookie-parser'
import { detectAndSetActiveAccount } from 'utils/account-manager'
import { StorageKeys } from 'utils/storage'

const CAPTURE_SOURCE = 'twillot:x-user-list-response'

document.documentElement.dataset.twillotCaptureBridge = 'loading'
setCaptureDebug('content-script-loaded')
injectCaptureScript()

const cookies = document.cookie.split(';')
const twidCookie = cookies.find((c) => c.trim().startsWith('twid='))
const twidValue = twidCookie?.split('=').slice(1).join('=')?.trim()
const userId = parseTwidCookie(twidValue)

detectAndSetActiveAccount(userId)

window.addEventListener('message', (event) => {
  const message = event.data
  if (message?.source !== CAPTURE_SOURCE) {
    return
  }

  forwardCapturedUserList(message.url, message.json)
})

document.addEventListener(CAPTURE_SOURCE, (event) => {
  const detail = (event as CustomEvent).detail
  if (!detail?.url || !detail?.json) {
    return
  }

  forwardCapturedUserList(detail.url, detail.json)
})

function forwardCapturedUserList(url: string, json: unknown) {
  setCaptureDebug('content-script-received', url)

  chrome.runtime.sendMessage({
    type: 'TWILLOT_CAPTURED_X_USER_LIST',
    url,
    json,
  })
}

function injectCaptureScript() {
  const script = document.createElement('script')
  script.src = chrome.runtime.getURL('captureFollowers.js')
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
