/** Keeps imported media in IndexedDB so a project survives a page reload.
 *
 * The browser cannot re-open a file by path the way the desktop build does, so
 * the bytes themselves are stored. Object URLs are minted per session and
 * cached, because a URL from a previous session is already revoked.
 */

const DB_NAME = "ai-video-editor";
const DB_VERSION = 1;
const STORE = "media";

let database: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (database) return database;

  database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDBを開けません"));
  });
  return database;
}

function transact<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = run(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("保存に失敗しました"));
      }),
  );
}

const urls = new Map<string, string>();

/** Stores a file under a media id and returns a URL usable this session. */
export async function putFile(mediaId: string, file: Blob): Promise<string> {
  await transact("readwrite", (store) => store.put(file, mediaId));
  return urlFor(mediaId, file);
}

export async function getFile(mediaId: string): Promise<Blob | null> {
  const stored = await transact<Blob | undefined>("readonly", (store) =>
    store.get(mediaId),
  );
  return stored ?? null;
}

export async function deleteFile(mediaId: string): Promise<void> {
  const existing = urls.get(mediaId);
  if (existing) {
    URL.revokeObjectURL(existing);
    urls.delete(mediaId);
  }
  await transact("readwrite", (store) => store.delete(mediaId));
}

/** Object URL for a stored file, created once per session. */
export function urlFor(mediaId: string, blob: Blob): string {
  const existing = urls.get(mediaId);
  if (existing) return existing;

  const url = URL.createObjectURL(blob);
  urls.set(mediaId, url);
  return url;
}

/** Resolves a playable URL, loading from IndexedDB if this session has not. */
export async function resolveUrl(mediaId: string): Promise<string | null> {
  const existing = urls.get(mediaId);
  if (existing) return existing;

  const blob = await getFile(mediaId);
  return blob ? urlFor(mediaId, blob) : null;
}

/** Synchronous lookup for render paths that cannot await. */
export function cachedUrl(mediaId: string): string | null {
  return urls.get(mediaId) ?? null;
}

/** Total bytes held, for the storage indicator. */
export async function usage(): Promise<number> {
  if (!navigator.storage?.estimate) return 0;
  const estimate = await navigator.storage.estimate();
  return estimate.usage ?? 0;
}

/** Asks the browser to keep this data rather than evicting it under pressure. */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
