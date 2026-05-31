import {
  EntityScope,
  Folder,
  DuplicateFolderError,
  FolderNotFoundError,
} from '../types/folder'
import { getCurrentUserId } from '../storage'
import { validateFolderName } from './folder-validation'
import {
  openDb,
  getObjectStore,
  FOLDERS_TABLE_NAME,
  TWEETS_TABLE_NAME_V2,
  USERS_TABLE_NAME,
} from './index'

export function getFolderId(
  ownerId: string,
  scope: EntityScope,
  name: string,
): string {
  return `${ownerId}_${scope}_${name}`
}

export async function createFolder(
  name: string,
  scope: EntityScope,
): Promise<Folder> {
  const ownerId = await getCurrentUserId()
  const existingFolders = await getFoldersByScope(scope)
  const existingNames = existingFolders.map((f) => f.name)

  const result = validateFolderName(name, scope, existingNames)
  if (result instanceof Error) {
    throw result
  }

  const trimmedName = result
  const id = getFolderId(ownerId, scope, trimmedName)
  const sortOrder = existingFolders.length
  const folder: Folder = {
    id,
    owner_id: ownerId,
    name: trimmedName,
    scope,
    sort_order: sortOrder,
    created_at: Math.floor(Date.now() / 1000),
  }

  const db = await openDb()
  const { objectStore, transaction } = getObjectStore(db, FOLDERS_TABLE_NAME)

  return new Promise((resolve, reject) => {
    const request = objectStore.put(folder)
    transaction.oncomplete = () => resolve(folder)
    transaction.onerror = () => reject(new Error('Failed to create folder'))
  })
}

export async function renameFolder(
  oldName: string,
  newName: string,
  scope: EntityScope,
): Promise<void> {
  const ownerId = await getCurrentUserId()
  const oldId = getFolderId(ownerId, scope, oldName)

  const db = await openDb()

  // Read the existing folder
  const existingFolder = await new Promise<Folder | undefined>(
    (resolve, reject) => {
      const { objectStore } = getObjectStore(db, FOLDERS_TABLE_NAME)
      const request = objectStore.get(oldId)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(new Error('Failed to read folder'))
    },
  )

  if (!existingFolder) {
    throw new FolderNotFoundError(oldName, scope)
  }

  // Validate new name
  const existingFolders = await getFoldersByScope(scope)
  const existingNames = existingFolders
    .filter((f) => f.name !== oldName)
    .map((f) => f.name)

  const result = validateFolderName(newName, scope, existingNames)
  if (result instanceof Error) {
    throw result
  }

  const trimmedNewName = result
  const newId = getFolderId(ownerId, scope, trimmedNewName)

  // Update folder record: delete old, insert new
  const updatedFolder: Folder = {
    ...existingFolder,
    id: newId,
    name: trimmedNewName,
  }

  const db2 = await openDb()
  const { objectStore: folderStore, transaction: folderTx } = getObjectStore(
    db2,
    FOLDERS_TABLE_NAME,
  )

  await new Promise<void>((resolve, reject) => {
    folderStore.delete(oldId)
    folderStore.put(updatedFolder)
    folderTx.oncomplete = () => resolve()
    folderTx.onerror = () => reject(new Error('Failed to rename folder'))
  })

  // Update entity records in the same scope
  const entityStoreName =
    scope === 'bookmark' ? TWEETS_TABLE_NAME_V2 : USERS_TABLE_NAME

  const db3 = await openDb()
  const { objectStore: entityStore, transaction: entityTx } = getObjectStore(
    db3,
    entityStoreName,
  )

  await new Promise<void>((resolve, reject) => {
    const index = entityStore.index('folder')
    const request = index.openCursor(IDBKeyRange.only(oldName))

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
      if (cursor) {
        const record = cursor.value
        if (record.owner_id === ownerId) {
          record.folder = trimmedNewName
          cursor.update(record)
        }
        cursor.continue()
      }
    }

    request.onerror = () =>
      reject(new Error('Failed to update entity folder references'))
    entityTx.oncomplete = () => resolve()
    entityTx.onerror = () =>
      reject(new Error('Failed to update entity folder references'))
  })
}

export async function deleteFolder(
  name: string,
  scope: EntityScope,
): Promise<void> {
  const ownerId = await getCurrentUserId()
  const id = getFolderId(ownerId, scope, name)

  // Verify folder exists
  const db = await openDb()
  const exists = await new Promise<boolean>((resolve, reject) => {
    const { objectStore } = getObjectStore(db, FOLDERS_TABLE_NAME)
    const request = objectStore.get(id)
    request.onsuccess = () => resolve(!!request.result)
    request.onerror = () => reject(new Error('Failed to check folder'))
  })

  if (!exists) {
    throw new FolderNotFoundError(name, scope)
  }

  // Delete the folder record
  const db2 = await openDb()
  const { objectStore: folderStore, transaction: folderTx } = getObjectStore(
    db2,
    FOLDERS_TABLE_NAME,
  )

  await new Promise<void>((resolve, reject) => {
    folderStore.delete(id)
    folderTx.oncomplete = () => resolve()
    folderTx.onerror = () => reject(new Error('Failed to delete folder'))
  })

  // Clear folder field on all entities in the same scope
  const entityStoreName =
    scope === 'bookmark' ? TWEETS_TABLE_NAME_V2 : USERS_TABLE_NAME

  const db3 = await openDb()
  const { objectStore: entityStore, transaction: entityTx } = getObjectStore(
    db3,
    entityStoreName,
  )

  await new Promise<void>((resolve, reject) => {
    const index = entityStore.index('folder')
    const request = index.openCursor(IDBKeyRange.only(name))

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
      if (cursor) {
        const record = cursor.value
        if (record.owner_id === ownerId) {
          record.folder = ''
          cursor.update(record)
        }
        cursor.continue()
      }
    }

    request.onerror = () =>
      reject(new Error('Failed to clear entity folder references'))
    entityTx.oncomplete = () => resolve()
    entityTx.onerror = () =>
      reject(new Error('Failed to clear entity folder references'))
  })
}

export async function reorderFolders(
  orderedNames: string[],
  scope: EntityScope,
): Promise<void> {
  const ownerId = await getCurrentUserId()
  const db = await openDb()
  const { objectStore, transaction } = getObjectStore(db, FOLDERS_TABLE_NAME)

  return new Promise((resolve, reject) => {
    orderedNames.forEach((name, index) => {
      const id = getFolderId(ownerId, scope, name)
      const getRequest = objectStore.get(id)
      getRequest.onsuccess = () => {
        const record = getRequest.result
        if (record) {
          record.sort_order = index
          objectStore.put(record)
        }
      }
    })

    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(new Error('Failed to reorder folders'))
  })
}

export async function getFoldersByScope(
  scope: EntityScope,
): Promise<Folder[]> {
  const ownerId = await getCurrentUserId()
  const db = await openDb()
  const { objectStore } = getObjectStore(db, FOLDERS_TABLE_NAME)

  return new Promise((resolve, reject) => {
    const index = objectStore.index('owner_id_scope')
    const keyRange = IDBKeyRange.only([ownerId, scope])
    const request = index.openCursor(keyRange)
    const folders: Folder[] = []

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
      if (cursor) {
        folders.push(cursor.value)
        cursor.continue()
      } else {
        folders.sort((a, b) => a.sort_order - b.sort_order)
        resolve(folders)
      }
    }

    request.onerror = () => reject(new Error('Failed to get folders'))
  })
}

export async function folderExists(
  name: string,
  scope: EntityScope,
): Promise<boolean> {
  const ownerId = await getCurrentUserId()
  const id = getFolderId(ownerId, scope, name)
  const db = await openDb()
  const { objectStore } = getObjectStore(db, FOLDERS_TABLE_NAME)

  return new Promise((resolve, reject) => {
    const request = objectStore.get(id)
    request.onsuccess = () => resolve(!!request.result)
    request.onerror = () => reject(new Error('Failed to check folder'))
  })
}

/**
 * Count entities per folder for a given scope.
 * Returns a Record<string, number> mapping folder name → entity count.
 */
export async function getFolderCounts(
  scope: EntityScope,
): Promise<Record<string, number>> {
  const ownerId = await getCurrentUserId()
  const entityStoreName =
    scope === 'bookmark' ? TWEETS_TABLE_NAME_V2 : USERS_TABLE_NAME
  const db = await openDb()
  const { objectStore } = getObjectStore(db, entityStoreName)

  return new Promise((resolve, reject) => {
    const counts: Record<string, number> = {}
    const request = objectStore.index('folder').openCursor()

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
      if (cursor) {
        const record = cursor.value
        if (record.owner_id === ownerId && record.folder) {
          counts[record.folder] = (counts[record.folder] || 0) + 1
        }
        cursor.continue()
      } else {
        resolve(counts)
      }
    }

    request.onerror = () => reject(new Error('Failed to count folder entities'))
  })
}
