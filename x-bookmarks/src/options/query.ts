/**
 * Read-side handlers: querying the tweet list from IndexedDB into the global
 * store, pagination, and list navigation. No network, no writes.
 */
import { untrack } from 'solid-js/web'

import { findRecords } from 'utils/db/tweets'

import dataStore from './store'

export async function query(
  keyword = '',
  category = '',
  folder = '',
  lastId = '',
  limit = 100,
  append = false,
  dataType = 'bookmarks',
  tag = '',
) {
  const [store, setStore] = dataStore
  const start = new Date().getTime()
  const tweets = await findRecords(
    keyword,
    category,
    folder,
    lastId,
    limit,
    dataType,
    tag,
  )
  setStore('hasMore', tweets.length === limit)
  if (append) {
    if (tweets.length > 0) {
      setStore('tweets', (current) => [...current, ...tweets])
    }
  } else {
    setStore('tweets', tweets)
    if (!store.isSidePanel && (keyword.trim() || category || folder)) {
      window.scrollTo(0, 720)
    }
  }
  setStore('searchTime', new Date().getTime() - start)
}

export async function queryByCondition(append = false) {
  const [store] = dataStore
  const tweets = untrack(() => store.tweets)
  query(
    store.keyword,
    store.category,
    store.folder,
    append ? tweets[tweets.length - 1]?.tweet_id || '' : '',
    store.pageSize,
    append,
    store.dataType,
    store.tag,
  )
}

export function resetQuery() {
  const [store, setStore] = dataStore
  setStore({
    keyword: '',
    category: '',
  })
}

export async function getNextTweet() {
  const [store, setStore] = dataStore
  const index = store.selectedTweet
  if (index < 0) {
    console.warn('Invalid index')
    return
  }
  const nextIndex = index + 1
  if (nextIndex >= store.tweets.length) {
    console.warn('Invalid index')
    return
  }
  setStore('selectedTweet', nextIndex)
}

export async function getPrevTweet() {
  const [store, setStore] = dataStore
  const index = store.selectedTweet

  if (index < 0) {
    console.warn('Invalid index')
    return
  }
  const prevIndex = index - 1
  if (prevIndex < 0) {
    console.warn('Invalid index')
    return
  }
  setStore('selectedTweet', prevIndex)
}
