import browser from 'webextension-polyfill'
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, vi } from 'vitest'

import {
  getCurrentUserId,
  getStorageKey,
  setLocal,
  getLocal,
  captureGraphQLRequestTemplateFromUrl,
  captureQueryIdFromUrl,
  getCapturedGraphQLRequestTemplate,
  clearCurrentLocal,
  onLocalChanged,
  setCurrentUserId,
  StorageKeys,
} from './storage'

describe('Storage Module', () => {
  beforeEach(() => {
    global.chrome = browser
    browser.reset()
  })

  it('getUserId should return the current user id', async () => {
    await browser.storage.local.set({ [StorageKeys.Current_UID]: '123' })
    const userId = await getCurrentUserId()
    expect(userId).toBe('123')
  })

  it('getStorageKey should return the correct storage key', () => {
    const key = getStorageKey('testKey', '123')
    expect(key).toBe('user:123:testKey')
  })

  it('setLocal should set items in local storage', async () => {
    await setCurrentUserId('123')
    await setLocal({ testKey: 'testValue' })
    const result = await browser.storage.local.get(
      getStorageKey('testKey', '123'),
    )
    expect(result).toStrictEqual({
      'user:123:testKey': 'testValue',
    })
  })

  it('getLocal should get items from local storage', async () => {
    const result = await getLocal('testKey')
    expect(result.testKey).toBeUndefined()
    setCurrentUserId('123')
    await setLocal({ testKey: 'testValue' })
    const result2 = await getLocal('testKey')
    expect(result2.testKey).toBe('testValue')
  })

  it('clearCurrentLocal should clear current user local storage', async () => {
    await setCurrentUserId('123')
    await setLocal({ testKey: 'testValue' })
    await setCurrentUserId('456')
    await setLocal({ testKey2: 'testValue2' })

    const result = await getLocal('testKey')
    const result2 = await getLocal('testKey2')
    expect(result.testKey).toBeUndefined()
    expect(result2.testKey2).toBe('testValue2')
    await clearCurrentLocal()
    const result3 = await getLocal('testKey')
    const result4 = await getLocal('testKey2')
    expect(result3.testKey).toBeUndefined()
    expect(result4.testKey2).toBeUndefined()
    await setCurrentUserId('123')
    const result5 = await getLocal('testKey')
    expect(result5.testKey).toBe('testValue')
  })

  it('onLocalChanged should call callback when local storage changes', async () => {
    await setCurrentUserId('123')
    await setLocal({ testKey: 'oldValue' })
    const callback = vi.fn()
    onLocalChanged(callback)
    await setLocal({ testKey: 'newValue' })
    expect(callback).toHaveBeenCalledWith({
      testKey: { oldValue: 'oldValue', newValue: 'newValue' },
    })
  })

  it('captures GraphQL request templates from x.com URLs', async () => {
    await captureGraphQLRequestTemplateFromUrl(
      'https://x.com/i/api/graphql/live-query-id/Followers?variables=%7B%22userId%22%3A%22123%22%2C%22count%22%3A20%7D&features=%7B%22responsive_web_graphql_timeline_navigation_enabled%22%3Atrue%7D',
    )

    const template = await getCapturedGraphQLRequestTemplate('Followers')

    expect(template).toEqual({
      queryId: 'live-query-id',
      operationName: 'Followers',
      variables: {
        userId: '123',
        count: 20,
      },
      features: {
        responsive_web_graphql_timeline_navigation_enabled: true,
      },
    })
  })

  it('does not capture request templates when only capturing query ids', async () => {
    await captureQueryIdFromUrl(
      'https://x.com/i/api/graphql/failed-query-id/Followers?variables=%7B%22userId%22%3A%22123%22%7D',
    )

    const template = await getCapturedGraphQLRequestTemplate('Followers')

    expect(template).toBeUndefined()
  })
})
