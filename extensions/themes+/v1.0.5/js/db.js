import {
	IDB_NAME,
	IDB_STORE_MEDIA,
	IDB_STORE_THUMBS,
	IDB_STORE_WALLPAPERS,
} from "./config.js";

/**
 * Derive IndexedDB version from extension manifest version.
 * Formula: major * 100 + minor * 10 + patch
 * Example: "1.0.4" → 104, "1.1.0" → 110, "2.3.1" → 231
 */
function getIDBVersion() {
	try {
		const version = chrome.runtime.getManifest().version; // e.g. "1.0.4"
		const parts = version.split(".").map(Number);
		return (parts[0] || 0) * 100 + (parts[1] || 0) * 10 + (parts[2] || 0);
	} catch (_) {
		return 104;
	}
}

// ─── Connection management ──────────────────────────────────────────────────

let connectionPromise = null; // Shared across ALL concurrent callers
let idbDead = false;

/**
 * Get (or create) the IndexedDB connection.
 * All concurrent callers share a single connection attempt.
 * Returns IDBDatabase on success, or null if permanently unavailable.
 */
async function getDB() {
	if (idbDead) return null;
	if (!connectionPromise) {
		connectionPromise = _connectWithRetry();
	}
	return connectionPromise;
}

async function _connectWithRetry() {
	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			if (attempt > 1) {
				await new Promise((r) => setTimeout(r, attempt * 150));
			}
			return await openDB();
		} catch (err) {
			if (attempt === 3) {
				// Last resort: delete and recreate
				try {
					await new Promise((resolve) => {
						const del = indexedDB.deleteDatabase(IDB_NAME);
						del.onsuccess = () => resolve();
						del.onerror = () => resolve();
						del.onblocked = () => resolve();
					});
					return await openDB();
				} catch (_) {
					// IDB is truly broken
				}
			}
		}
	}
	// All attempts failed
	idbDead = true;
	connectionPromise = null;
	console.warn("IndexedDB unavailable — using network fallback.");
	return null;
}

function openDB() {
	const IDB_VERSION = getIDBVersion();

	return new Promise((resolve, reject) => {
		let req;
		try {
			req = indexedDB.open(IDB_NAME, IDB_VERSION);
		} catch (e) {
			return reject(e);
		}

		req.onupgradeneeded = (e) => {
			const db = e.target.result;
			if (!db.objectStoreNames.contains(IDB_STORE_THUMBS)) {
				db.createObjectStore(IDB_STORE_THUMBS, { keyPath: "key" });
			}
			if (!db.objectStoreNames.contains(IDB_STORE_MEDIA)) {
				db.createObjectStore(IDB_STORE_MEDIA, { keyPath: "key" });
			}
			if (!db.objectStoreNames.contains(IDB_STORE_WALLPAPERS)) {
				db.createObjectStore(IDB_STORE_WALLPAPERS, { keyPath: "id" });
			}
		};

		// Fires when another tab/worker holds an older connection
		req.onblocked = () => {
			console.warn(
				"IndexedDB upgrade blocked — close other extension tabs.",
			);
		};

		req.onsuccess = () => {
			const db = req.result;
			// Auto-close when another context requests a version upgrade
			db.onversionchange = () => {
				db.close();
				connectionPromise = null;
			};
			resolve(db);
		};

		req.onerror = () => {
			reject(req.error);
		};
	});
}

// ─── Store routing ──────────────────────────────────────────────────────────

function storeForKey(key) {
	if (!key) return IDB_STORE_MEDIA;
	if (String(key).endsWith("::thumb")) return IDB_STORE_THUMBS;
	return IDB_STORE_MEDIA;
}

// ─── Media helpers ──────────────────────────────────────────────────────────

export async function getMediaEntry(key) {
	const db = await getDB();
	if (!db) return null;
	return new Promise((resolve) => {
		try {
			const tx = db.transaction(storeForKey(key), "readonly");
			const req = tx.objectStore(storeForKey(key)).get(key);
			req.onsuccess = () => resolve(req.result || null);
			req.onerror = () => resolve(null);
		} catch (_) {
			resolve(null);
		}
	});
}

export async function putMediaEntry(entry) {
	if (!entry || !entry.key) throw new Error("entry.key is required");
	const db = await getDB();
	if (!db) return false;
	return new Promise((resolve) => {
		try {
			const storeName = storeForKey(entry.key);
			const tx = db.transaction(storeName, "readwrite");
			const req = tx.objectStore(storeName).put(entry);
			req.onsuccess = () => resolve(true);
			req.onerror = () => resolve(false);
		} catch (_) {
			resolve(false);
		}
	});
}

export async function deleteMediaEntry(key) {
	const db = await getDB();
	if (!db) return false;
	return new Promise((resolve) => {
		try {
			const storeName = storeForKey(key);
			const tx = db.transaction(storeName, "readwrite");
			const req = tx.objectStore(storeName).delete(key);
			req.onsuccess = () => resolve(true);
			req.onerror = () => resolve(false);
		} catch (_) {
			resolve(false);
		}
	});
}

export async function getAllMediaKeys() {
	const db = await getDB();
	if (!db) return null;
	const thumbs = await new Promise((resolve) => {
		try {
			const req = db
				.transaction(IDB_STORE_THUMBS, "readonly")
				.objectStore(IDB_STORE_THUMBS)
				.getAllKeys();
			req.onsuccess = () => resolve(req.result || []);
			req.onerror = () => resolve([]);
		} catch (_) {
			resolve([]);
		}
	});
	const media = await new Promise((resolve) => {
		try {
			const req = db
				.transaction(IDB_STORE_MEDIA, "readonly")
				.objectStore(IDB_STORE_MEDIA)
				.getAllKeys();
			req.onsuccess = () => resolve(req.result || []);
			req.onerror = () => resolve([]);
		} catch (_) {
			resolve([]);
		}
	});
	return thumbs.concat(media);
}

export async function getAvailableMediaKeys() {
	const db = await getDB();
	if (!db) return null;
	return new Promise((resolve) => {
		try {
			const req = db
				.transaction(IDB_STORE_MEDIA, "readonly")
				.objectStore(IDB_STORE_MEDIA)
				.getAllKeys();
			req.onsuccess = () => resolve(req.result || []);
			req.onerror = () => resolve([]);
		} catch (_) {
			resolve([]);
		}
	});
}

// ─── User Wallpaper helpers ─────────────────────────────────────────────────

export async function saveUserWallpaper(
	blob,
	type,
	thumbBlob = null,
	existingId = null,
) {
	const db = await getDB();
	if (!db) return null;
	const id =
		existingId ||
		`user-wall-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
	const entry = { id, blob, thumbBlob, type, timestamp: Date.now() };
	return new Promise((resolve) => {
		try {
			const tx = db.transaction(IDB_STORE_WALLPAPERS, "readwrite");
			const req = tx.objectStore(IDB_STORE_WALLPAPERS).put(entry);
			req.onsuccess = () => resolve(id);
			req.onerror = () => resolve(null);
		} catch (_) {
			resolve(null);
		}
	});
}

export async function deleteUserWallpaper(id) {
	const db = await getDB();
	if (!db) return false;
	return new Promise((resolve) => {
		try {
			const tx = db.transaction(IDB_STORE_WALLPAPERS, "readwrite");
			const req = tx.objectStore(IDB_STORE_WALLPAPERS).delete(id);
			req.onsuccess = () => resolve(true);
			req.onerror = () => resolve(false);
		} catch (_) {
			resolve(false);
		}
	});
}

/**
 * Lightweight list: returns [{id, type, timestamp, thumbBlob}] WITHOUT the heavy `blob` field.
 */
export async function getUserWallpaperList() {
	const db = await getDB();
	if (!db) return [];
	return new Promise((resolve) => {
		try {
			const tx = db.transaction(IDB_STORE_WALLPAPERS, "readonly");
			const store = tx.objectStore(IDB_STORE_WALLPAPERS);
			const results = [];
			const cursorReq = store.openCursor();
			cursorReq.onsuccess = (e) => {
				const cursor = e.target.result;
				if (!cursor) {
					resolve(results);
					return;
				}
				const val = cursor.value;
				results.push({
					id: val.id,
					type: val.type,
					timestamp: val.timestamp,
					thumbBlob: val.thumbBlob || null,
				});
				cursor.continue();
			};
			cursorReq.onerror = () => resolve([]);
		} catch (_) {
			resolve([]);
		}
	});
}

/**
 * Fetch a single user wallpaper by ID (includes the heavy blob).
 */
export async function getUserWallpaperById(id) {
	const db = await getDB();
	if (!db) return null;
	return new Promise((resolve) => {
		try {
			const req = db
				.transaction(IDB_STORE_WALLPAPERS, "readonly")
				.objectStore(IDB_STORE_WALLPAPERS)
				.get(id);
			req.onsuccess = () => resolve(req.result || null);
			req.onerror = () => resolve(null);
		} catch (_) {
			resolve(null);
		}
	});
}

/**
 * @deprecated Use getUserWallpaperList() + getUserWallpaperById() instead.
 */
export async function getAllUserWallpapers() {
	const db = await getDB();
	if (!db) return [];
	return new Promise((resolve) => {
		try {
			const req = db
				.transaction(IDB_STORE_WALLPAPERS, "readonly")
				.objectStore(IDB_STORE_WALLPAPERS)
				.getAll();
			req.onsuccess = () => resolve(req.result || []);
			req.onerror = () => resolve([]);
		} catch (_) {
			resolve([]);
		}
	});
}
