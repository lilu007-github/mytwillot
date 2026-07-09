import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'

import {
  DB_NAME,
  DB_VERSION,
  FOLDERS_TABLE_NAME,
  CONFIGS_TABLE_NAME_V2,
  USERS_TABLE_NAME,
  getFolderId,
  migrateToV22,
} from './index'
import { Folder } from '../types'

// Mock webextension-polyfill and chrome storage to avoid browser extension errors
vi.mock('webextension-polyfill', () => ({
  default: {},
}))

vi.mock('../storage', () => ({
  getCurrentUserId: vi.fn().mockResolvedValue('user1'),
  setCurrentUserId: vi.fn().mockResolvedValue(undefined),
}))

function getAllFromStore<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const store = tx.objectStore(storeName)
    const request = store.getAll()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/**
 * Helper to create a test database with the required stores pre-seeded,
 * then trigger migration via a version bump.
 */
function setupAndMigrate(
  seedFn: (transaction: IDBTransaction) => void,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // First, create the DB at version 1 with required stores and seed data
    const request1 = indexedDB.open(DB_NAME, 1)
    request1.onupgradeneeded = (event) => {
      const target = event.target as IDBOpenDBRequest
      const db = target.result
      const transaction = target.transaction!

      if (!db.objectStoreNames.contains(CONFIGS_TABLE_NAME_V2)) {
        db.createObjectStore(CONFIGS_TABLE_NAME_V2, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(FOLDERS_TABLE_NAME)) {
        db.createObjectStore(FOLDERS_TABLE_NAME, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(USERS_TABLE_NAME)) {
        db.createObjectStore(USERS_TABLE_NAME, { keyPath: 'id' })
      }

      seedFn(transaction)
    }
    request1.onsuccess = () => {
      request1.result.close()

      // Now re-open at version 2 to trigger migration
      const request2 = indexedDB.open(DB_NAME, 2)
      request2.onupgradeneeded = (event) => {
        const target = event.target as IDBOpenDBRequest
        const transaction = target.transaction!
        migrateToV22(transaction)
      }
      request2.onsuccess = () => resolve(request2.result)
      request2.onerror = () => reject(request2.error)
    }
    request1.onerror = () => reject(request1.error)
  })
}

describe('migrateToV22', () => {
  beforeEach(() => {
    indexedDB = new IDBFactory()
  })

  it('should migrate legacy bookmark folders from settings store', async () => {
    const db = await setupAndMigrate((transaction) => {
      const settings = transaction.objectStore(CONFIGS_TABLE_NAME_V2)
      settings.put({
        id: 'user1_folder',
        owner_id: 'user1',
        option_name: 'folder',
        option_value: ['Work', 'Personal', 'Research'],
        updated_at: 1000,
      })
    })

    const folders = await getAllFromStore<Folder>(db, FOLDERS_TABLE_NAME)
    db.close()

    expect(folders).toHaveLength(3)

    // Records are returned sorted by primary key (id), so sort by sort_order for assertions
    const sorted = [...folders].sort((a, b) => a.sort_order - b.sort_order)
    expect(sorted[0]).toMatchObject({
      id: getFolderId('user1', 'bookmark', 'Work'),
      owner_id: 'user1',
      name: 'Work',
      scope: 'bookmark',
      sort_order: 0,
    })
    expect(sorted[1]).toMatchObject({
      id: getFolderId('user1', 'bookmark', 'Personal'),
      owner_id: 'user1',
      name: 'Personal',
      scope: 'bookmark',
      sort_order: 1,
    })
    expect(sorted[2]).toMatchObject({
      id: getFolderId('user1', 'bookmark', 'Research'),
      owner_id: 'user1',
      name: 'Research',
      scope: 'bookmark',
      sort_order: 2,
    })
  })

  it('should handle empty legacy config gracefully (no records created)', async () => {
    const db = await setupAndMigrate((transaction) => {
      const settings = transaction.objectStore(CONFIGS_TABLE_NAME_V2)
      settings.put({
        id: 'user1_folder',
        owner_id: 'user1',
        option_name: 'folder',
        option_value: [],
        updated_at: 1000,
      })
    })

    const folders = await getAllFromStore<Folder>(db, FOLDERS_TABLE_NAME)
    db.close()

    expect(folders).toHaveLength(0)
  })

  it('should handle null legacy config gracefully', async () => {
    const db = await setupAndMigrate((transaction) => {
      const settings = transaction.objectStore(CONFIGS_TABLE_NAME_V2)
      settings.put({
        id: 'user1_folder',
        owner_id: 'user1',
        option_name: 'folder',
        option_value: null,
        updated_at: 1000,
      })
    })

    const folders = await getAllFromStore<Folder>(db, FOLDERS_TABLE_NAME)
    db.close()

    expect(folders).toHaveLength(0)
  })

  it('should handle no folder config at all', async () => {
    const db = await setupAndMigrate(() => {
      // No settings seeded
    })

    const folders = await getAllFromStore<Folder>(db, FOLDERS_TABLE_NAME)
    db.close()

    expect(folders).toHaveLength(0)
  })

  it('should create user-scoped folders from distinct non-empty user folder values', async () => {
    const db = await setupAndMigrate((transaction) => {
      const usersStore = transaction.objectStore(USERS_TABLE_NAME)
      usersStore.put({ id: 'user1_u1', owner_id: 'user1', folder: 'Friends' })
      usersStore.put({
        id: 'user1_u2',
        owner_id: 'user1',
        folder: 'Colleagues',
      })
      usersStore.put({ id: 'user1_u3', owner_id: 'user1', folder: 'Friends' }) // duplicate
      usersStore.put({ id: 'user1_u4', owner_id: 'user1', folder: '' }) // empty
      usersStore.put({ id: 'user1_u5', owner_id: 'user1', folder: null }) // null
    })

    const folders = await getAllFromStore<Folder>(db, FOLDERS_TABLE_NAME)
    db.close()

    const userFolders = folders.filter((f) => f.scope === 'user')
    expect(userFolders).toHaveLength(2)

    const names = userFolders.map((f) => f.name).sort()
    expect(names).toEqual(['Colleagues', 'Friends'])

    for (const folder of userFolders) {
      expect(folder.sort_order).toBeGreaterThanOrEqual(0)
      expect(folder.owner_id).toBe('user1')
    }
  })

  it('should migrate both bookmark and user folders together', async () => {
    const db = await setupAndMigrate((transaction) => {
      const settings = transaction.objectStore(CONFIGS_TABLE_NAME_V2)
      settings.put({
        id: 'user1_folder',
        owner_id: 'user1',
        option_name: 'folder',
        option_value: ['Tech', 'News'],
        updated_at: 1000,
      })

      const usersStore = transaction.objectStore(USERS_TABLE_NAME)
      usersStore.put({ id: 'user1_u1', owner_id: 'user1', folder: 'VIPs' })
      usersStore.put({ id: 'user1_u2', owner_id: 'user1', folder: 'Devs' })
    })

    const folders = await getAllFromStore<Folder>(db, FOLDERS_TABLE_NAME)
    db.close()

    const bookmarkFolders = folders.filter((f) => f.scope === 'bookmark')
    const userFolders = folders.filter((f) => f.scope === 'user')

    expect(bookmarkFolders).toHaveLength(2)
    expect(userFolders).toHaveLength(2)

    expect(bookmarkFolders.map((f) => f.name).sort()).toEqual(['News', 'Tech'])
    expect(userFolders.map((f) => f.name).sort()).toEqual(['Devs', 'VIPs'])
  })

  it('should be idempotent - skip if folders store already has records', async () => {
    const db = await setupAndMigrate((transaction) => {
      // Pre-populate folders store
      const foldersStore = transaction.objectStore(FOLDERS_TABLE_NAME)
      foldersStore.put({
        id: 'user1_bookmark_Existing',
        owner_id: 'user1',
        name: 'Existing',
        scope: 'bookmark',
        sort_order: 0,
        created_at: 1000,
      })

      // Also add settings config that would normally trigger migration
      const settings = transaction.objectStore(CONFIGS_TABLE_NAME_V2)
      settings.put({
        id: 'user1_folder',
        owner_id: 'user1',
        option_name: 'folder',
        option_value: ['NewFolder1', 'NewFolder2'],
        updated_at: 1000,
      })
    })

    const folders = await getAllFromStore<Folder>(db, FOLDERS_TABLE_NAME)
    db.close()

    // Should only have the pre-existing folder, not the new ones
    expect(folders).toHaveLength(1)
    expect(folders[0].name).toBe('Existing')
  })

  it('should preserve sort_order matching array index for bookmark folders', async () => {
    const folderNames = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon']
    const db = await setupAndMigrate((transaction) => {
      const settings = transaction.objectStore(CONFIGS_TABLE_NAME_V2)
      settings.put({
        id: 'user1_folder',
        owner_id: 'user1',
        option_name: 'folder',
        option_value: folderNames,
        updated_at: 1000,
      })
    })

    const folders = await getAllFromStore<Folder>(db, FOLDERS_TABLE_NAME)
    db.close()

    expect(folders).toHaveLength(5)
    for (let i = 0; i < folderNames.length; i++) {
      const folder = folders.find((f) => f.name === folderNames[i])
      expect(folder).toBeDefined()
      expect(folder!.sort_order).toBe(i)
    }
  })

  it('should skip non-string entries in the legacy folder array', async () => {
    const db = await setupAndMigrate((transaction) => {
      const settings = transaction.objectStore(CONFIGS_TABLE_NAME_V2)
      settings.put({
        id: 'user1_folder',
        owner_id: 'user1',
        option_name: 'folder',
        option_value: ['Valid', null, '', undefined, 'AlsoValid', 123],
        updated_at: 1000,
      })
    })

    const folders = await getAllFromStore<Folder>(db, FOLDERS_TABLE_NAME)
    db.close()

    expect(folders).toHaveLength(2)
    expect(folders.map((f) => f.name).sort()).toEqual(['AlsoValid', 'Valid'])
  })
})
