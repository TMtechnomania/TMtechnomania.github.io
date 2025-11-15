import { IDB_NAME, IDB_VERSION, IDB_STORE_MEDIA, IDB_STORE_THUMBS } from "./config.js";

let dbInstance = null;
// ... existing code ...
async function getDB() {
	if (dbInstance) {
// ... existing code ...
	}

	return new Promise((resolve, reject) => {
// ... existing code ...
		const req = indexedDB.open(IDB_NAME, IDB_VERSION);

		req.onupgradeneeded = (e) => {
// ... existing code ...
			const db = e.target.result;
			// Ensure both stores exist: thumbnails and media
			if (!db.objectStoreNames.contains(IDB_STORE_THUMBS)) {
// ... existing code ...
				db.createObjectStore(IDB_STORE_THUMBS, { keyPath: "key" });
			}
			if (!db.objectStoreNames.contains(IDB_STORE_MEDIA)) {
// ... existing code ...
				db.createObjectStore(IDB_STORE_MEDIA, { keyPath: "key" });
			}

			// Migration: if upgrading from a version where thumbs were stored in the media store,
// ... existing code ...
			const oldVersion = e.oldVersion || 0;
			if (oldVersion < 2) {
// ... existing code ...
				try {
					const tx = e.target.transaction; // upgrade transaction
					// If media store exists, iterate and move thumb entries
// ... existing code ...
					if (tx && tx.objectStoreNames && tx.objectStoreNames.contains(IDB_STORE_MEDIA) && tx.objectStoreNames.contains(IDB_STORE_THUMBS)) {
						const mediaStore = tx.objectStore(IDB_STORE_MEDIA);
// ... existing code ...
						const thumbsStore = tx.objectStore(IDB_STORE_THUMBS);
						const cursorReq = mediaStore.openCursor();
// ... existing code ...
						cursorReq.onsuccess = (ev) => {
							const cursor = ev.target.result;
// ... existing code ...
							if (!cursor) return;
							try {
// ... existing code ...
								const key = cursor.key;
								if (String(key).endsWith('::thumb')) {
// ... existing code ...
									const val = cursor.value;
									// put into thumbs store
									thumbsStore.put(val);
									// delete from media store
// ... existing code ...
									mediaStore.delete(key);
								}
							} catch (moveErr) {
// ... existing code ...
								// ignore individual move errors
							}
							cursor.continue();
						};
					}
				} catch (mErr) {
					// ignore migration errors; new installs will create empty stores
// ... existing code ...
					console.warn('IDB migration to split thumbs/media failed', mErr);
				}
			}
		};

		req.onsuccess = () => {
// ... existing code ...
			dbInstance = req.result;
			resolve(dbInstance);
		};

		req.onerror = () => reject(req.error);
// ... existing code ...
	});
}

/**
 * Gets a single entry from the media store.
// ... existing code ...
 * @param {string} key - The unique key (e.g., "path/::thumb")
 * @returns {Promise<object | null>}
 */
function storeForKey(key) {
// ... existing code ...
	if (!key) return IDB_STORE_MEDIA;
	if (String(key).endsWith("::thumb")) return IDB_STORE_THUMBS;
// ... existing code ...
	if (String(key).endsWith("::media")) return IDB_STORE_MEDIA;
	// default to media store
	return IDB_STORE_MEDIA;
}

export async function getMediaEntry(key) {
// ... existing code ...
	const db = await getDB();
	const storeName = storeForKey(key);
// ... existing code ...
	return new Promise((resolve, reject) => {
		const tx = db.transaction(storeName, "readonly");
// ... existing code ...
		const store = tx.objectStore(storeName);
		const req = store.get(key);
// ... existing code ...
		req.onsuccess = () => resolve(req.result || null);
		req.onerror = () => reject(req.error);
// ... existing code ...
	});
}

/**
 * Puts (creates or updates) an entry in the media store.
// ... existing code ...
 * @param {object} entry - The full entry object, must include a 'key'
 * @returns {Promise<true>}
 */
export async function putMediaEntry(entry) {
// ... existing code ...
	if (!entry || !entry.key) throw new Error('entry.key is required');
	const db = await getDB();
// ... existing code ...
	const storeName = storeForKey(entry.key);
	return new Promise((resolve, reject) => {
// ... existing code ...
		const tx = db.transaction(storeName, "readwrite");
		const store = tx.objectStore(storeName);
// ... existing code ...
		const req = store.put(entry);
		req.onsuccess = () => resolve(true);
// ... existing code ...
		req.onerror = () => reject(req.error);
	});
}

/**
 * Deletes an entry from the media store by its key.
// ... existing code ...
 * @param {string} key
 * @returns {Promise<true>}
 */
export async function deleteMediaEntry(key) {
// ... existing code ...
	const db = await getDB();
	const storeName = storeForKey(key);
// ... existing code ...
	return new Promise((resolve, reject) => {
		const tx = db.transaction(storeName, "readwrite");
// ... existing code ...
		const store = tx.objectStore(storeName);
		const req = store.delete(key);
// ... existing code ...
		req.onsuccess = () => resolve(true);
		req.onerror = () => reject(req.error);
// ... existing code ...
	});
}

/**
 * Gets all keys from the media store. Used for pruning.
 * @returns {Promise<string>}
 */
export async function getAllMediaKeys() {
// ... existing code ...
	const db = await getDB();
	// collect keys from both stores
	const thumbs = await new Promise((resolve, reject) => {
// ... existing code ...
		try {
			const tx = db.transaction(IDB_STORE_THUMBS, "readonly");
// ... existing code ...
			const store = tx.objectStore(IDB_STORE_THUMBS);
			const req = store.getAllKeys();
// ... existing code ...
			req.onsuccess = () => resolve(req.result || []);
			req.onerror = () => reject(req.error);
// ... existing code ...
		} catch (e) { resolve([]); }
	});
	const media = await new Promise((resolve, reject) => {
// ... existing code ...
		try {
			const tx = db.transaction(IDB_STORE_MEDIA, "readonly");
// ... existing code ...
			const store = tx.objectStore(IDB_STORE_MEDIA);
			const req = store.getAllKeys();
// ... existing code ...
			req.onsuccess = () => resolve(req.result || []);
			req.onerror = () => reject(req.error);
// ... existing code ...
		} catch (e) { resolve([]); }
	});
	return thumbs.concat(media);
}

/**
 * Gets all keys from ONLY the full media store.
 * Used to select a random *available* wallpaper.
 * @returns {Promise<string[]>}
 */
export async function getAvailableMediaKeys() {
	const db = await getDB();
	return new Promise((resolve, reject) => {
		try {
			const tx = db.transaction(IDB_STORE_MEDIA, "readonly");
			const store = tx.objectStore(IDB_STORE_MEDIA);
			const req = store.getAllKeys();
			// We also check status, but getAllKeys is faster.
			// We will rely on the `tryLoadFromBlob` to verify status.
			req.onsuccess = () => resolve(req.result || []);
			req.onerror = () => reject(req.error);
		} catch (e) {
			resolve([]); // Return empty array on error
		}
	});
}