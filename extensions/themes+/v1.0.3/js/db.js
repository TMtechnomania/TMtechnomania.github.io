import { IDB_NAME, IDB_VERSION, IDB_STORE_MEDIA, IDB_STORE_THUMBS, IDB_STORE_WALLPAPERS } from "./config.js";

let dbInstance = null;
async function getDB() {
	if (dbInstance) {
		return dbInstance;
	}

	return new Promise((resolve, reject) => {
		const req = indexedDB.open(IDB_NAME, IDB_VERSION);

		req.onupgradeneeded = (e) => {
			const db = e.target.result;
			if (!db.objectStoreNames.contains(IDB_STORE_THUMBS)) {
				db.createObjectStore(IDB_STORE_THUMBS, { keyPath: "key" });
			}
			if (!db.objectStoreNames.contains(IDB_STORE_MEDIA)) {
				db.createObjectStore(IDB_STORE_MEDIA, { keyPath: "key" });
			}
            if (!db.objectStoreNames.contains(IDB_STORE_WALLPAPERS)) {
                db.createObjectStore(IDB_STORE_WALLPAPERS, { keyPath: "id" }); // Use 'id' for user wallpapers
            }

            // ... exiting upgrade logic ...
			const oldVersion = e.oldVersion || 0;
			if (oldVersion < 2) {
				try {
					const tx = e.target.transaction;
                    // Check if stores exist before accessing
					if (tx && tx.objectStoreNames && tx.objectStoreNames.contains(IDB_STORE_MEDIA) && tx.objectStoreNames.contains(IDB_STORE_THUMBS)) {
						const mediaStore = tx.objectStore(IDB_STORE_MEDIA);
						const thumbsStore = tx.objectStore(IDB_STORE_THUMBS);
						const cursorReq = mediaStore.openCursor();
						cursorReq.onsuccess = (ev) => {
							const cursor = ev.target.result;
							if (!cursor) return;
							try {
								const key = cursor.key;
								if (String(key).endsWith('::thumb')) {
									const val = cursor.value;
									thumbsStore.put(val);
									mediaStore.delete(key);
								}
							} catch (moveErr) {
							}
							cursor.continue();
						};
					}
				} catch (mErr) {
					// console.warn('IDB migration to split thumbs/media failed', mErr);
				}
			}
		};

		req.onsuccess = () => {
			dbInstance = req.result;
			resolve(dbInstance);
		};

		req.onerror = () => reject(req.error);
	});
}

function storeForKey(key) {
	if (!key) return IDB_STORE_MEDIA;
	if (String(key).endsWith("::thumb")) return IDB_STORE_THUMBS;
	if (String(key).endsWith("::media")) return IDB_STORE_MEDIA;
	return IDB_STORE_MEDIA;
}

export async function getMediaEntry(key) {
	const db = await getDB();
	const storeName = storeForKey(key);
	return new Promise((resolve, reject) => {
		const tx = db.transaction(storeName, "readonly");
		const store = tx.objectStore(storeName);
		const req = store.get(key);
		req.onsuccess = () => resolve(req.result || null);
		req.onerror = () => reject(req.error);
	});
}

export async function putMediaEntry(entry) {
	if (!entry || !entry.key) throw new Error('entry.key is required');
	const db = await getDB();
	const storeName = storeForKey(entry.key);
	return new Promise((resolve, reject) => {
		const tx = db.transaction(storeName, "readwrite");
		const store = tx.objectStore(storeName);
		const req = store.put(entry);
		req.onsuccess = () => resolve(true);
		req.onerror = () => reject(req.error);
	});
}

export async function deleteMediaEntry(key) {
	const db = await getDB();
	const storeName = storeForKey(key);
	return new Promise((resolve, reject) => {
		const tx = db.transaction(storeName, "readwrite");
		const store = tx.objectStore(storeName);
		const req = store.delete(key);
		req.onsuccess = () => resolve(true);
		req.onerror = () => reject(req.error);
	});
}

export async function getAllMediaKeys() {
	const db = await getDB();
	const thumbs = await new Promise((resolve, reject) => {
		try {
			const tx = db.transaction(IDB_STORE_THUMBS, "readonly");
			const store = tx.objectStore(IDB_STORE_THUMBS);
			const req = store.getAllKeys();
			req.onsuccess = () => resolve(req.result || []);
			req.onerror = () => reject(req.error);
		} catch (e) { resolve([]); }
	});
	const media = await new Promise((resolve, reject) => {
		try {
			const tx = db.transaction(IDB_STORE_MEDIA, "readonly");
			const store = tx.objectStore(IDB_STORE_MEDIA);
			const req = store.getAllKeys();
			req.onsuccess = () => resolve(req.result || []);
			req.onerror = () => reject(req.error);
		} catch (e) { resolve([]); }
	});
	return thumbs.concat(media);
}

export async function getAvailableMediaKeys() {
	const db = await getDB();
	return new Promise((resolve, reject) => {
		try {
			const tx = db.transaction(IDB_STORE_MEDIA, "readonly");
			const store = tx.objectStore(IDB_STORE_MEDIA);
			const req = store.getAllKeys();
			req.onsuccess = () => resolve(req.result || []);
			req.onerror = () => reject(req.error);
		} catch (e) {
			resolve([]);
		}
	});
}

// --- User Wallpaper Helpers ---

export async function saveUserWallpaper(blob, type, thumbBlob = null, existingId = null) {
    const db = await getDB();
    const id = existingId || `user-wall-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const entry = {
        id,
        blob, // Store blob directly
        thumbBlob, // Store thumbnail blob (if provided)
        type, // 'img' or 'video'
        timestamp: Date.now()
    };
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE_WALLPAPERS, "readwrite");
        const store = tx.objectStore(IDB_STORE_WALLPAPERS);
        const req = store.put(entry);
        req.onsuccess = () => resolve(id);
        req.onerror = () => reject(req.error);
    });
}

export async function deleteUserWallpaper(id) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE_WALLPAPERS, "readwrite");
        const store = tx.objectStore(IDB_STORE_WALLPAPERS);
        const req = store.delete(id);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
    });
}

export async function getAllUserWallpapers() {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        try {
            const tx = db.transaction(IDB_STORE_WALLPAPERS, "readonly");
            const store = tx.objectStore(IDB_STORE_WALLPAPERS);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        } catch (e) {
            resolve([]);
        }
    });
}