import { getOptionsPageTab } from 'utils/browser'
import {
  captureQueryIdFromUrl,
  StorageKeys,
  syncAuthHeaders,
} from 'utils/storage'
import { Host } from 'utils/types'
import { cancelCurrentSync, startFullSync } from 'utils/sync-engine'
import { upsertAccountEntry } from 'utils/account-manager'

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
     * Using the ids from the user's own session keeps requests working.
     */
    await captureQueryIdFromUrl(url)

    /**
     * The interface for members and non-members is different.
     * Members request folders first, while regular users directly request bookmarks.
     */
    if (!url.includes('/Bookmarks') && !url.includes('/BookmarkFoldersSlice')) {
      return
    }

    console.log('syncAuthHeaders: url', { url })

    await syncAuthHeaders(details.requestHeaders)

    const storage = await chrome.storage.local.get()
    console.log('syncAuthHeaders: storage', {
      url,
      ...storage,
    })
  },
  {
    types: ['xmlhttprequest'],
    urls: [`${Host}/i/api/graphql/*`],
  },
  ['requestHeaders'],
)

chrome.omnibox.onInputEntered.addListener(async (text) => {
  const newURL =
    chrome.runtime.getURL('pages/options.html') +
    '#/?q=' +
    encodeURIComponent(text)
  let tab = await getOptionsPageTab()
  if (tab) {
    await chrome.tabs.update(tab.id, { url: newURL, active: true })
  } else {
    await chrome.tabs.create({ url: newURL })
  }
})

/**
 * Listen for account switches.
 * When `current_user_id` changes in Chrome Storage:
 * 1. Cancel any in-progress sync for the previous account
 * 2. Update the new account's registry entry (last_active_at)
 * 3. Start a full sync for the new account (resets cursor)
 */
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== 'local') {
    return
  }

  const userIdChange = changes[StorageKeys.Current_UID]
  if (!userIdChange) {
    return
  }

  const oldUserId: string = userIdChange.oldValue || ''
  const newUserId: string = userIdChange.newValue || ''

  // No actual change
  if (oldUserId === newUserId) {
    return
  }

  // Cancel any active sync for the previous account
  if (oldUserId) {
    await cancelCurrentSync()
  }

  // If new user ID is empty (logged out), don't start a new sync
  if (!newUserId) {
    return
  }

  // Update the account registry with the new account's last_active_at
  await upsertAccountEntry({
    user_id: newUserId,
    last_active_at: Math.floor(Date.now() / 1000),
  })

  // Start a full sync for the new account (resets cursor)
  await startFullSync(newUserId)
})
