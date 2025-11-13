import { IDB_NAME, IDB_VERSION, IDB_STORE_MEDIA } from './config.js';

let dbInstance = null;

/**
 * Opens and returns the IndexedDB instance, creating it if needed.
 * Uses a singleton pattern to avoid opening multiple connections.
 * @returns {Promise<IDBDatabase>}
 */
async function getDB() {
    if (dbInstance) {
        return dbInstance;
    }

    return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_NAME, IDB_VERSION);

        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(IDB_STORE_MEDIA)) {
                // 'key' will be our unique asset path, e.g., "/wallpapers/img/01.webp::thumb"
                db.createObjectStore(IDB_STORE_MEDIA, { keyPath: 'key' });
            }
        };

        req.onsuccess = () => {
            dbInstance = req.result;
            resolve(dbInstance);
        };

        req.onerror = () => reject(req.error);
    });
}

/**
 * Gets a single entry from the media store.
 * @param {string} key - The unique key (e.g., "path/::thumb")
 * @returns {Promise<object | null>}
 */
export async function getMediaEntry(key) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE_MEDIA, 'readonly');
        const store = tx.objectStore(IDB_STORE_MEDIA);
        const req = store.get(key);
    req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Puts (creates or updates) an entry in the media store.
 * @param {object} entry - The full entry object, must include a 'key'
 * @returns {Promise<true>}
 */
export async function putMediaEntry(entry) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE_MEDIA, 'readwrite');
        const store = tx.objectStore(IDB_STORE_MEDIA);
        const req = store.put(entry);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Deletes an entry from the media store by its key.
 * @param {string} key
 * @returns {Promise<true>}
 */
export async function deleteMediaEntry(key) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE_MEDIA, 'readwrite');
        const store = tx.objectStore(IDB_STORE_MEDIA);
        const req = store.delete(key);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Gets all keys from the media store. Used for pruning.
 * @returns {Promise<string>}
 */
export async function getAllMediaKeys() {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE_MEDIA, 'readonly');
        const store = tx.objectStore(IDB_STORE_MEDIA);
        const req = store.getAllKeys(); // This is much more efficient than getAll()
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}