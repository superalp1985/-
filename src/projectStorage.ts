import {
  parseProjectDocument,
  serializeProjectDocument,
  type ProjectDocument,
} from './project'

export const LOCAL_PROJECT_STORAGE_KEY = 'wangdazhan-factor-canvas:active-project'

const DATABASE_NAME = 'wangdazhan-factor-canvas'
const DATABASE_VERSION = 1
const STORE_NAME = 'projects'
const ACTIVE_PROJECT_ID = 'active'

export type ProjectStorageLike = Pick<Storage, 'getItem' | 'setItem'>
export type LocalSaveMode = 'indexeddb' | 'localstorage'

export function readProjectFromStorage(storage: ProjectStorageLike | null | undefined): ProjectDocument | null {
  if (!storage) return null
  const raw = storage.getItem(LOCAL_PROJECT_STORAGE_KEY)
  if (!raw) return null
  try {
    return parseProjectDocument(JSON.parse(raw))
  } catch {
    return null
  }
}

export function writeProjectToStorage(document: ProjectDocument, storage: ProjectStorageLike | null | undefined): void {
  storage?.setItem(LOCAL_PROJECT_STORAGE_KEY, serializeProjectDocument(document))
}

function browserStorage(): ProjectStorageLike | null {
  return typeof localStorage === 'undefined' ? null : localStorage
}

function browserIndexedDb(): IDBFactory | null {
  return typeof indexedDB === 'undefined' ? null : indexedDB
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('无法打开本地项目存储'))
  })
}

function readFromIndexedDb(database: IDBDatabase): Promise<unknown | null> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).get(ACTIVE_PROJECT_ID)
    request.onsuccess = () => resolve(request.result ?? null)
    request.onerror = () => reject(request.error ?? new Error('无法读取本地项目'))
  })
}

function writeToIndexedDb(database: IDBDatabase, document: ProjectDocument): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put(document, ACTIVE_PROJECT_ID)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('无法保存本地项目'))
    transaction.onabort = () => reject(transaction.error ?? new Error('本地项目保存被中止'))
  })
}

export async function loadLocalProject(): Promise<ProjectDocument | null> {
  const factory = browserIndexedDb()
  if (factory) {
    let database: IDBDatabase | null = null
    try {
      database = await openDatabase(factory)
      const stored = await readFromIndexedDb(database)
      if (stored) return parseProjectDocument(stored)
    } catch {
      // Fall back to localStorage when iframe storage is restricted or unavailable.
    } finally {
      database?.close()
    }
  }
  return readProjectFromStorage(browserStorage())
}

export async function saveLocalProject(document: ProjectDocument): Promise<LocalSaveMode> {
  const factory = browserIndexedDb()
  if (factory) {
    let database: IDBDatabase | null = null
    try {
      database = await openDatabase(factory)
      await writeToIndexedDb(database, document)
      return 'indexeddb'
    } catch {
      // Fall back to localStorage when the browser denies IndexedDB access.
    } finally {
      database?.close()
    }
  }
  writeProjectToStorage(document, browserStorage())
  return 'localstorage'
}
