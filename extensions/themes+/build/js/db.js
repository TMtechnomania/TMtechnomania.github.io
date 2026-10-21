import {
	IDB_NAME,
	IDB_STORE_MEDIA,
	IDB_STORE_THUMBS,
	IDB_STORE_WALLPAPERS,
	IDB_STORE_ZEN_TRACKS,
} from "./config.js";
import {
	isDefaultMediaId,
	readDefaultMediaIds,
} from "./wallpaperDefaults.js";
import { logError } from "./logger.js";

/**
 * Explicitly-managed IndexedDB schema version.
 *
 * Do NOT derive this from the extension version: downgrades/sideloads would
 * request a lower version and IndexedDB throws VersionError. This value is
 * intentionally higher than the old version-derived numbers (1.0.6 → 10006)
 * so existing databases upgrade in place and keep all user wallpapers.
 *
 * 1000001 adds the "zenTracks" store for uploaded Zen/Pomodoro music.
 */
const IDB_SCHEMA_VERSION = 1000001;

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
			// Never delete the database here: a failed open (including a
			// VersionError from a rollback) must not destroy user wallpapers.
			console.warn(
				`IndexedDB open attempt ${attempt} failed:`,
				err && err.name ? err.name : err,
			);
		}
	}
	// All attempts failed
	idbDead = true;
	connectionPromise = null;
	console.warn("IndexedDB unavailable — using network fallback.");
	return null;
}

function openVersion(version) {
	return new Promise((resolve, reject) => {
		let req;
		try {
			req =
				version == null ?
					indexedDB.open(IDB_NAME)
				:	indexedDB.open(IDB_NAME, version);
		} catch (e) {
			return reject(e);
		}

		let settled = false;
		let blockedTimer = null;
		const finish = (fn, value) => {
			if (settled) return;
			settled = true;
			if (blockedTimer) clearTimeout(blockedTimer);
			fn(value);
		};

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
			if (!db.objectStoreNames.contains(IDB_STORE_ZEN_TRACKS)) {
				db.createObjectStore(IDB_STORE_ZEN_TRACKS, { keyPath: "id" });
			}
		};

		// Fires when another tab/worker holds an older connection. Without a
		// timeout this promise would never settle and startup would hang.
		req.onblocked = () => {
			if (blockedTimer) return;
			blockedTimer = setTimeout(() => {
				finish(
					reject,
					new Error("IndexedDB open blocked by another connection"),
				);
			}, 10000);
		};

		req.onsuccess = () => {
			const db = req.result;
			// Auto-close when another context requests a version upgrade
			db.onversionchange = () => {
				db.close();
				connectionPromise = null;
			};
			finish(resolve, db);
		};

		req.onerror = () => {
			finish(reject, req.error || new Error("IndexedDB open failed"));
		};
	});
}

async function openDB() {
	try {
		return await openVersion(IDB_SCHEMA_VERSION);
	} catch (err) {
		if (err && err.name === "VersionError") {
			// The database was created by a build with a higher version.
			// Open it at its existing version instead of upgrading/destroying.
			console.warn(
				"IndexedDB has a newer schema; opening without version upgrade.",
			);
			return await openVersion(null);
		}
		throw err;
	}
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
	if (!db) {
		logError("db", "IndexedDB unavailable while writing media entry", entry.key);
		return false;
	}
	return new Promise((resolve) => {
		try {
			const storeName = storeForKey(entry.key);
			const tx = db.transaction(storeName, "readwrite");
			const req = tx.objectStore(storeName).put(entry);
			req.onsuccess = () => resolve(true);
			req.onerror = () => {
				logError("db", req.error, entry.key);
				resolve(false);
			};
		} catch (e) {
			logError("db", e, entry.key);
			resolve(false);
		}
	});
}

/**
 * Delete a cached media or thumbnail entry.
 *
 * The two catalog defaults (first image + first video) are the app's fallback
 * wallpapers and are never removed. Pass `{ force: true }` only when the entry
 * has left the catalog entirely (manifest pruning), where keeping the blob
 * would just leak storage.
 */
export async function deleteMediaEntry(key, { force = false } = {}) {
	if (!force && key && String(key).endsWith("::media")) {
		const id = String(key).slice(0, -"::media".length);
		const defaults = await readDefaultMediaIds();
		if (isDefaultMediaId(defaults, id)) return false;
	}
	const db = await getDB();
	if (!db) {
		logError("db", "IndexedDB unavailable while deleting media entry", key);
		return false;
	}
	return new Promise((resolve) => {
		try {
			const storeName = storeForKey(key);
			const tx = db.transaction(storeName, "readwrite");
			const req = tx.objectStore(storeName).delete(key);
			req.onsuccess = () => resolve(true);
			req.onerror = () => {
				logError("db", req.error, key);
				resolve(false);
			};
		} catch (e) {
			logError("db", e, key);
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

// ─── Zen (Pomodoro) music helpers ───────────────────────────────────────────

/**
 * Persist an uploaded audio file for Zen mode. The blob lives in IndexedDB so
 * personal tracks survive restarts without counting against storage.sync.
 */
export async function saveZenTrack(blob, name) {
	const db = await getDB();
	if (!db) return null;
	const id = `zen-track-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
	const entry = {
		id,
		name: String(name || "Untitled"),
		type: blob.type || "",
		size: blob.size || 0,
		blob,
		timestamp: Date.now(),
	};
	return new Promise((resolve) => {
		try {
			const tx = db.transaction(IDB_STORE_ZEN_TRACKS, "readwrite");
			const req = tx.objectStore(IDB_STORE_ZEN_TRACKS).put(entry);
			req.onsuccess = () => resolve(id);
			req.onerror = () => resolve(null);
		} catch (_) {
			resolve(null);
		}
	});
}

/** Lightweight playlist: metadata only, ordered by upload time. */
export async function getZenTrackList() {
	const db = await getDB();
	if (!db) return [];
	return new Promise((resolve) => {
		try {
			const store = db
				.transaction(IDB_STORE_ZEN_TRACKS, "readonly")
				.objectStore(IDB_STORE_ZEN_TRACKS);
			const results = [];
			const cursorReq = store.openCursor();
			cursorReq.onsuccess = (e) => {
				const cursor = e.target.result;
				if (!cursor) {
					results.sort((a, b) => a.timestamp - b.timestamp);
					resolve(results);
					return;
				}
				const val = cursor.value;
				results.push({
					id: val.id,
					name: val.name || "Untitled",
					type: val.type || "",
					size: val.size || 0,
					timestamp: val.timestamp || 0,
				});
				cursor.continue();
			};
			cursorReq.onerror = () => resolve([]);
		} catch (_) {
			resolve([]);
		}
	});
}

/** Fetch a single Zen track including its blob. */
export async function getZenTrackById(id) {
	const db = await getDB();
	if (!db) return null;
	return new Promise((resolve) => {
		try {
			const req = db
				.transaction(IDB_STORE_ZEN_TRACKS, "readonly")
				.objectStore(IDB_STORE_ZEN_TRACKS)
				.get(id);
			req.onsuccess = () => resolve(req.result || null);
			req.onerror = () => resolve(null);
		} catch (_) {
			resolve(null);
		}
	});
}

export async function deleteZenTrack(id) {
	const db = await getDB();
	if (!db) return false;
	return new Promise((resolve) => {
		try {
			const req = db
				.transaction(IDB_STORE_ZEN_TRACKS, "readwrite")
				.objectStore(IDB_STORE_ZEN_TRACKS)
				.delete(id);
			req.onsuccess = () => resolve(true);
			req.onerror = () => resolve(false);
		} catch (_) {
			resolve(false);
		}
	});
}
