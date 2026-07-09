import { Config, Folder, IndexedDbIndexItem, Tweet } from '../types'
import { getCurrentUserId } from '../storage'
import { getConfigId } from './configs'
import { getPostId } from './tweets'

export const DB_VERSION = 23

export const DB_NAME = 'twillot'

export const TWEETS_TABLE_NAME = 'tweets'

export const CONFIGS_TABLE_NAME = 'configs'

export const TWEETS_TABLE_NAME_V2 = 'posts'

export const CONFIGS_TABLE_NAME_V2 = 'settings'

export const USERS_TABLE_NAME = 'users'

export const FOLDERS_TABLE_NAME = 'folders'

export const TAGS_TABLE_NAME = 'tags'

export const folderIndexFields: IndexedDbIndexItem[] = [
  { name: 'owner_id', options: { unique: false, multiEntry: false } },
  { name: 'scope', options: { unique: false, multiEntry: false } },
  { name: 'sort_order', options: { unique: false, multiEntry: false } },
  { name: 'parent_id', options: { unique: false, multiEntry: false } },
  {
    name: 'owner_id_scope',
    keyPath: ['owner_id', 'scope'],
    options: { unique: false, multiEntry: false },
  },
]

export const tagIndexFields: IndexedDbIndexItem[] = [
  { name: 'owner_id', options: { unique: false, multiEntry: false } },
  { name: 'sort_order', options: { unique: false, multiEntry: false } },
]

export const userIndexFields: IndexedDbIndexItem[] = [
  { name: 'screen_name', options: { unique: false, multiEntry: false } },
  { name: 'owner_id', options: { unique: false, multiEntry: false } },
  { name: 'relationship', options: { unique: false, multiEntry: false } },
  { name: 'synced_at', options: { unique: false, multiEntry: false } },
]

export const indexFields: IndexedDbIndexItem[] =
  'full_text,sort_index,screen_name,created_at,owner_id,has_image,has_video,has_link,has_quote,is_long_text,folder,category_name'
    .split(',')
    .map((field) => ({
      name: field,
      options: {
        unique: false,
        multiEntry: false,
      },
    }))
indexFields.push({
  name: 'tags',
  options: {
    unique: false,
    multiEntry: true,
  },
})

let user_id = ''

export async function migrateData(userId: string) {
  if (!userId) {
    console.error('Migration failed: user_id is not set.')
    return
  }

  console.log('Starting database migration for user ' + userId)
  const db = await openDb()
  let transaction = db.transaction(
    [
      TWEETS_TABLE_NAME,
      CONFIGS_TABLE_NAME,
      TWEETS_TABLE_NAME_V2,
      CONFIGS_TABLE_NAME_V2,
    ],
    'readwrite',
  )

  transaction.oncomplete = () => {
    console.log('Database migration complete.')
    location.reload()
  }

  transaction.onerror = (event) => {
    console.error('Transaction error:', event)
  }

  let migrationPromises: Promise<void>[] = []

  if (db.objectStoreNames.contains(TWEETS_TABLE_NAME)) {
    migrationPromises.push(
      new Promise((resolve, reject) => {
        const oldStore = transaction.objectStore(TWEETS_TABLE_NAME)
        const newStore = transaction.objectStore(TWEETS_TABLE_NAME_V2)

        const request = oldStore.openCursor()
        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
          if (cursor) {
            const record = { ...cursor.value } as Tweet
            record.id = getPostId(userId, record.tweet_id)
            record.owner_id = userId
            newStore.put(record).onsuccess = () => {
              cursor.continue()
            }
          } else {
            resolve()
          }
        }
        request.onerror = (event) => {
          console.error('Cursor error:', event)
          reject(new Error(`${TWEETS_TABLE_NAME} migrating error`))
        }
      }),
    )
  }

  if (db.objectStoreNames.contains(CONFIGS_TABLE_NAME)) {
    migrationPromises.push(
      new Promise((resolve, reject) => {
        const oldStore = transaction.objectStore(CONFIGS_TABLE_NAME)
        const newStore = transaction.objectStore(CONFIGS_TABLE_NAME_V2)

        const request = oldStore.openCursor()
        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
          if (cursor) {
            const record = { ...cursor.value } as Config
            record.id = getConfigId(userId, record.option_name)
            record.owner_id = userId
            record.updated_at = Math.floor(Date.now() / 1000)
            newStore.put(record).onsuccess = () => {
              cursor.continue()
            }
          } else {
            resolve()
          }
        }
        request.onerror = (event) => {
          console.error('Cursor error:', event)
          reject(new Error(`${CONFIGS_TABLE_NAME} migrating error`))
        }
      }),
    )
  }

  try {
    await Promise.all(migrationPromises)
    console.log('All migrations completed successfully.')
  } catch (error) {
    console.error('Migration failed:', error)
  }
}

export function createSchema(
  db: IDBDatabase,
  transaction: IDBTransaction | null,
  realTbName: string,
  keyPath: string | null,
  indexes: IndexedDbIndexItem[],
) {
  let objectStore = db.objectStoreNames.contains(realTbName)
    ? transaction.objectStore(realTbName)
    : db.createObjectStore(realTbName, {
        keyPath: keyPath,
      })

  indexes.forEach((index) => {
    if (!objectStore.indexNames.contains(index.name)) {
      objectStore.createIndex(
        index.name,
        index.keyPath || index.name,
        index.options,
      )
    }
  })
}

export function getFolderId(
  ownerId: string,
  scope: string,
  name: string,
): string {
  return `${ownerId}_${scope}_${name}`
}

/**
 * Migrate legacy folder data to the new entity-scoped folders store.
 * Runs inside the onupgradeneeded transaction — must not create new transactions.
 * Idempotent: skips if the folders store already has records.
 * On failure, lets the transaction abort naturally to preserve data at version 21.
 */
export function migrateToV22(transaction: IDBTransaction): void {
  const foldersStore = transaction.objectStore(FOLDERS_TABLE_NAME)
  const settingsStore = transaction.objectStore(CONFIGS_TABLE_NAME_V2)
  const usersStore = transaction.objectStore(USERS_TABLE_NAME)

  // Idempotency check: if folders store already has records, skip migration
  const countRequest = foldersStore.count()
  countRequest.onsuccess = () => {
    if (countRequest.result > 0) {
      console.log('migrateToV22: folders store already has records, skipping.')
      return
    }

    // Scan settings store for records with option_name 'folder' (OptionName.FOLDER)
    const settingsCursor = settingsStore.openCursor()
    const folderConfigs: Config[] = []

    settingsCursor.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
      if (cursor) {
        const record = cursor.value as Config
        if (record.option_name === 'folder') {
          folderConfigs.push(record)
        }
        cursor.continue()
      } else {
        // Done scanning settings — process folder configs
        migrateBookmarkFolders(foldersStore, folderConfigs)
        migrateUserFolders(foldersStore, usersStore)
      }
    }

    settingsCursor.onerror = (event) => {
      console.error('migrateToV22: error scanning settings store', event)
      transaction.abort()
    }
  }

  countRequest.onerror = (event) => {
    console.error('migrateToV22: error counting folders store', event)
    transaction.abort()
  }
}

/**
 * Create bookmark-scoped folder records from legacy folder config arrays.
 */
function migrateBookmarkFolders(
  foldersStore: IDBObjectStore,
  folderConfigs: Config[],
): void {
  const now = Math.floor(Date.now() / 1000)

  for (const config of folderConfigs) {
    const ownerId = config.owner_id
    const folderNames = config.option_value

    // Handle empty/null/non-array gracefully
    if (!Array.isArray(folderNames) || folderNames.length === 0) {
      continue
    }

    for (let i = 0; i < folderNames.length; i++) {
      const name = folderNames[i]
      if (!name || typeof name !== 'string') {
        continue
      }

      const folder: Folder = {
        id: getFolderId(ownerId, 'bookmark', name),
        owner_id: ownerId,
        name,
        scope: 'bookmark',
        sort_order: i,
        created_at: now,
      }
      foldersStore.put(folder)
    }
  }
}

/**
 * Scan users store for distinct non-empty folder values and create
 * user-scoped folder records.
 */
function migrateUserFolders(
  foldersStore: IDBObjectStore,
  usersStore: IDBObjectStore,
): void {
  const now = Math.floor(Date.now() / 1000)

  const userCursor = usersStore.openCursor()
  // Track distinct folder names per owner_id
  const seenFolders = new Map<string, Set<string>>()
  let sortOrderMap = new Map<string, number>()

  userCursor.onsuccess = (event) => {
    const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
    if (cursor) {
      const record = cursor.value
      const folderName = record.folder
      const ownerId = record.owner_id

      if (
        folderName &&
        typeof folderName === 'string' &&
        ownerId &&
        typeof ownerId === 'string'
      ) {
        if (!seenFolders.has(ownerId)) {
          seenFolders.set(ownerId, new Set())
          sortOrderMap.set(ownerId, 0)
        }

        const ownerFolders = seenFolders.get(ownerId)!
        if (!ownerFolders.has(folderName)) {
          ownerFolders.add(folderName)
          const sortOrder = sortOrderMap.get(ownerId)!
          sortOrderMap.set(ownerId, sortOrder + 1)

          const folder: Folder = {
            id: getFolderId(ownerId, 'user', folderName),
            owner_id: ownerId,
            name: folderName,
            scope: 'user',
            sort_order: sortOrder,
            created_at: now,
          }
          foldersStore.put(folder)
        }
      }
      cursor.continue()
    }
    // When cursor is exhausted, migration is complete (transaction commits naturally)
  }

  userCursor.onerror = (event) => {
    console.error('migrateToV22: error scanning users store', event)
    // Let the transaction abort naturally — IndexedDB will handle this
  }
}

function upgradeDb(db: IDBDatabase, transaction: IDBTransaction) {
  createSchema(
    db,
    transaction,
    TWEETS_TABLE_NAME,
    'tweet_id',
    indexFields.filter((i) => i.name !== 'owner_id'),
  )
  createSchema(db, transaction, CONFIGS_TABLE_NAME, 'option_name', [])
  createSchema(db, transaction, TWEETS_TABLE_NAME_V2, 'id', indexFields)
  createSchema(db, transaction, CONFIGS_TABLE_NAME_V2, 'id', [])
  createSchema(db, transaction, USERS_TABLE_NAME, 'id', [
    ...userIndexFields,
    { name: 'folder', options: { unique: false, multiEntry: false } },
  ])
  createSchema(db, transaction, FOLDERS_TABLE_NAME, 'id', folderIndexFields)
  createSchema(db, transaction, TAGS_TABLE_NAME, 'id', tagIndexFields)

  // Run legacy folder migration after all stores/indexes are created
  migrateToV22(transaction)
}

export function getObjectStore(db: IDBDatabase, realTbName: string) {
  const transaction = db.transaction([realTbName], 'readwrite')
  return {
    transaction,
    objectStore: transaction.objectStore(realTbName),
  }
}

export async function openDb(
  dbName = DB_NAME,
  dbVersion = DB_VERSION,
  onUpgrade = upgradeDb,
): Promise<IDBDatabase> {
  if (!user_id) {
    user_id = await getCurrentUserId()
  }

  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject('IndexedDB is not supported by this browser.')
      return
    }

    const request = globalThis.indexedDB.open(dbName, dbVersion)
    request.onerror = (event: Event) => {
      reject(
        'Database error: ' +
          (event.target as IDBOpenDBRequest).error?.toString(),
      )
    }
    request.onupgradeneeded = async (event: IDBVersionChangeEvent) => {
      const target = event.target as IDBOpenDBRequest
      // DO NOT create a new transaction here
      const db = target.result
      const transaction = target.transaction
      if (transaction) {
        onUpgrade(db, transaction)
      }
    }

    request.onsuccess = (event: Event) => {
      const db = (event.target as IDBOpenDBRequest).result
      resolve(db)
    }
  })
}
