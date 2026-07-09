import { describe, it, expect, beforeEach, vi } from 'vitest'
import browser from 'webextension-polyfill'
import 'fake-indexeddb/auto'

import {
  upsertRecords,
  findRecords,
  getRecord,
  countRecords,
  aggregateUsers,
  getTopUsers,
  getRencentTweets,
  clearFolder,
  getPostId,
  getAllTweetIds,
  deleteRecordsByTweetIds,
} from './tweets'
import TweetGenerator from '../../../x-bookmarks/__mocks__/tweet'
import {
  openDb,
  getObjectStore,
  TWEETS_TABLE_NAME,
  TWEETS_TABLE_NAME_V2,
  CONFIGS_TABLE_NAME,
  CONFIGS_TABLE_NAME_V2,
  migrateData,
} from './index'
import { getCurrentUserId } from '../storage'
import { setCurrentUserId } from '../storage'
import { Config, Tweet } from '../types'
import { getConfigId } from './configs'

describe('dbModule', () => {
  beforeEach(async () => {
    global.chrome = browser
    indexedDB = new IDBFactory()
    await setCurrentUserId('1234567890')
  })

  describe('migrateData', () => {
    it('should migrate data from old tables to new tables', async () => {
      const db = await openDb()
      const userId = await getCurrentUserId()
      const tweets = TweetGenerator.generateTweets(5)
      const configs = [
        { option_name: 'config1', option_value: 'value1' },
        { option_name: 'config2', option_value: 'value2' },
      ]

      // Add data to old tables
      const { objectStore: oldTweetStore } = getObjectStore(
        db,
        TWEETS_TABLE_NAME,
      )
      const { objectStore: oldConfigStore } = getObjectStore(
        db,
        CONFIGS_TABLE_NAME,
      )
      tweets.forEach((tweet) => oldTweetStore.put(tweet))
      configs.forEach((config) => oldConfigStore.put(config))

      await migrateData(userId)

      // Verify data in new tables
      const { objectStore: newTweetStore } = getObjectStore(
        db,
        TWEETS_TABLE_NAME_V2,
      )
      const { objectStore: newConfigStore } = getObjectStore(
        db,
        CONFIGS_TABLE_NAME_V2,
      )

      const migratedTweets: Tweet[] = await new Promise((resolve, reject) => {
        const request = newTweetStore.getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })

      const migratedConfigs: Config[] = await new Promise((resolve, reject) => {
        const request = newConfigStore.getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })

      expect(migratedTweets.length).toBe(tweets.length)
      expect(migratedConfigs.length).toBe(configs.length)

      migratedTweets.forEach((tweet, index) => {
        expect(tweet.id).toBe(getPostId(userId, tweet.tweet_id))
        expect(tweet.owner_id).toBe(userId)
      })

      migratedConfigs.forEach((config, index) => {
        expect(config.id).toBe(getConfigId(userId, config.option_name))
        expect(config.owner_id).toBe(userId)
      })
    })
  })

  describe('getPostId', () => {
    it('prefixes with owner id', () => {
      expect(getPostId('123', '456')).toBe('123_456')
    })

    it('keeps an already-prefixed id unchanged', () => {
      expect(getPostId('123', '123_456')).toBe('123_456')
    })

    it('still prefixes when tweet_id merely contains user_id as substring', () => {
      // Regression: `includes` used to skip the prefix here.
      expect(getPostId('123', '41234')).toBe('123_41234')
    })
  })

  describe('addRecords', () => {
    it('should add records to the database', async () => {
      const tweets = TweetGenerator.generateTweets(5)
      await upsertRecords(tweets)
      const result = await findRecords()
      expect(result.length).toEqual(tweets.length)
    })
  })

  describe('findRecords', () => {
    it('should find records based on criteria', async () => {
      const tweet = TweetGenerator.generateTweet()
      tweet.full_text = 'Hello World'
      await upsertRecords([tweet])
      const results = await findRecords('hello')
      expect(results.length).toBe(1)
      expect(results[0].tweet_id).toBe(tweet.tweet_id)
    })
  })

  describe('getRecord', () => {
    it('should get a record by tweet_id', async () => {
      const tweet = TweetGenerator.generateTweet()
      await upsertRecords([tweet])
      const result = await getRecord(tweet.tweet_id)
      expect(result).toBeDefined()
      expect(result?.tweet_id).toBe(tweet.tweet_id)
    })
  })

  describe('countRecords', () => {
    it('should count the number of records in the database', async () => {
      const tweets = TweetGenerator.generateTweets(3)
      await upsertRecords(tweets)
      const count = await countRecords()
      expect(count.total).toBe(3)
    })
  })

  describe('aggregateUsers', () => {
    it('should aggregate tweets by user', async () => {
      const tweets = TweetGenerator.generateTweets(5)
      await upsertRecords(tweets)
      const aggregated = await aggregateUsers()
      const size = Object.keys(aggregated).length
      expect(aggregated).toBeInstanceOf(Object)
      expect(size).toBeGreaterThan(0)
      expect(size).toBeLessThan(6)
    })
  })

  describe('getTopUsers', () => {
    it('should get top users by tweet count', async () => {
      const tweets = TweetGenerator.generateTweets(5)
      await upsertRecords(tweets)
      const topUsers = await getTopUsers()
      expect(topUsers).toBeInstanceOf(Array)
      expect(topUsers.length).toBeGreaterThan(0)
    })
  })

  describe('getRecentTweets', () => {
    it('should get recent tweets', async () => {
      const tweets = TweetGenerator.generateTweets(5)
      await upsertRecords(tweets)
      const recentTweets = await getRencentTweets(Number.MAX_SAFE_INTEGER)
      expect(recentTweets.data).toBeInstanceOf(Array)
      expect(recentTweets.total).toBeGreaterThan(0)
    })
  })

  describe('clearFolder', () => {
    it('should clear tweets in a specified folder', async () => {
      const tweet = TweetGenerator.generateTweet()
      tweet.folder = 'testFolder'
      await upsertRecords([tweet])
      await clearFolder('testFolder')
      const results = await findRecords('', '', 'testFolder')
      expect(results.length).toBe(0)
    })
  })

  describe('getAllTweetIds', () => {
    it('should return all tweet_ids for the current user', async () => {
      const tweets = TweetGenerator.generateTweets(5)
      await upsertRecords(tweets)
      const ids = await getAllTweetIds()
      expect(ids.length).toBe(5)
      tweets.forEach((t) => {
        expect(ids).toContain(t.tweet_id)
      })
    })

    it('should return empty array when no records exist', async () => {
      const ids = await getAllTweetIds()
      expect(ids).toEqual([])
    })

    it('excludes non-bookmark categories from reconciliation ids', async () => {
      const bookmarks = TweetGenerator.generateTweets(2)
      await upsertRecords(bookmarks)

      // A passively-captured like must never be classified as a stale
      // bookmark and deleted during full-sync reconciliation.
      const like = TweetGenerator.generateTweet()
      like.category_name = 'likes'
      await upsertRecords([like])

      const ids = await getAllTweetIds()
      expect(ids.length).toBe(2)
      expect(ids).not.toContain(like.tweet_id)
    })

    it('should only return tweet_ids for the current user', async () => {
      // Insert tweets for user A
      const tweetsA = TweetGenerator.generateTweets(3)
      await upsertRecords(tweetsA)

      // Switch to user B and insert tweets
      await setCurrentUserId('9999999999')
      indexedDB = new IDBFactory()
      const tweetsB = TweetGenerator.generateTweets(2)
      await upsertRecords(tweetsB)

      // getAllTweetIds should only return user B's tweets
      const ids = await getAllTweetIds()
      expect(ids.length).toBe(2)
      tweetsB.forEach((t) => {
        expect(ids).toContain(t.tweet_id)
      })
    })
  })

  describe('deleteRecordsByTweetIds', () => {
    it('should delete records by tweet_ids', async () => {
      const tweets = TweetGenerator.generateTweets(5)
      await upsertRecords(tweets)

      const idsToDelete = tweets.slice(0, 3).map((t) => t.tweet_id)
      const deleted = await deleteRecordsByTweetIds(idsToDelete)
      expect(deleted).toBe(3)

      const remaining = await findRecords()
      expect(remaining.length).toBe(2)
    })

    it('should return 0 when given empty array', async () => {
      const deleted = await deleteRecordsByTweetIds([])
      expect(deleted).toBe(0)
    })

    it('should handle non-existent tweet_ids gracefully', async () => {
      const tweets = TweetGenerator.generateTweets(3)
      await upsertRecords(tweets)

      const deleted = await deleteRecordsByTweetIds(['nonexistent_1', 'nonexistent_2'])
      // delete operations succeed even if key doesn't exist in IndexedDB
      expect(deleted).toBe(2)

      // Original records should still be intact
      const remaining = await findRecords()
      expect(remaining.length).toBe(3)
    })
  })
})
