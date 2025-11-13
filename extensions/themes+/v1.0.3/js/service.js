const app = chrome || browser; // Support both Chrome and Firefox

// Service worker for the extension: on install or update fetch wallpaper.json and
// cache the manifest in storage.local as `wallpaperDB`. Then download all
// thumbnails into an IndexedDB named `themes-assets` in object store `media`.

const WALLPAPER_JSON_URL = 'https://buildwithkt.dev/extensions/themes+/assets/wallpaper.json';
const IDB_NAME = 'themes-assets';
const IDB_VERSION = 1;
const IDB_STORE = 'media';

// Open (or create) the IndexedDB database and object store.
function openDB() {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(IDB_NAME, IDB_VERSION);
		req.onupgradeneeded = (e) => {
			const db = e.target.result;
			if (!db.objectStoreNames.contains(IDB_STORE)) {
				// keyPath is `key` which will be the asset path or derived key
				db.createObjectStore(IDB_STORE, { keyPath: 'key' });
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

// Put a blob and metadata into the media store. Overwrites existing entry with same key.
async function putMediaEntry(key, blob, meta = {}) {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(IDB_STORE, 'readwrite');
		const store = tx.objectStore(IDB_STORE);
		const entry = Object.assign({ key, blob, createdAt: Date.now() }, meta);
		const req = store.put(entry);
		req.onsuccess = () => resolve(true);
		req.onerror = () => reject(req.error);
	});
}

// Helper: fetch JSON with timeout and basic error handling
async function fetchJson(url, timeoutMs = 15000) {
	const controller = new AbortController();
	const id = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(url, { signal: controller.signal });
		clearTimeout(id);
		if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
		return await res.json();
	} finally {
		clearTimeout(id);
	}
}

// Derive a full URL for an asset/thumbnail. If value is absolute, return it.
function resolveAssetUrl(pathOrUrl) {
	if (!pathOrUrl) return null;
	try {
		const u = new URL(pathOrUrl);
		return u.href; // absolute
	} catch (e) {
		// relative path: prepend known origin
		return `https://buildwithkt.dev${pathOrUrl}`;
	}
}

// Download a resource as a blob and store in IDB under the given key.
async function downloadAndStoreBlob(url, key, meta = {}) {
	try {
		const res = await fetch(url);
		if (!res.ok) throw new Error(`Fetch failed ${res.status} ${url}`);
		const blob = await res.blob();
		await putMediaEntry(key, blob, meta);
		return { ok: true };
	} catch (err) {
		return { ok: false, error: err.message };
	}
}

// Limit concurrent downloads (simple semaphore)
async function runWithConcurrency(items, workerFn, concurrency = 6) {
	const results = [];
	let i = 0;
	const workers = new Array(concurrency).fill(0).map(async () => {
		while (i < items.length) {
			const idx = i++;
			try {
				results[idx] = await workerFn(items[idx]);
			} catch (e) {
				results[idx] = { ok: false, error: e.message };
			}
		}
	});
	await Promise.all(workers);
	return results;
}

// Main install/update handler: fetch manifest, save to storage, download thumbnails.
self.addEventListener('install', (event) => {
	// Keep the worker alive until we've fetched manifest and thumbnails
	event.waitUntil((async () => {
		try {
			// Try to fetch wallpaper.json
			const manifest = await fetchJson(WALLPAPER_JSON_URL);

			// Validate basic shape: { version, images, videos }
			if (!manifest || typeof manifest.version !== 'string') {
				// still store whatever we got, but return early if invalid
				console.warn('wallpaper.json missing version or invalid format');
			}

			// Save manifest into storage.local as wallpaperDB
			try {
				await new Promise((resolve, reject) => {
					app.storage.local.set({ wallpaperDB: manifest }, () => {
						const err = chrome.runtime && chrome.runtime.lastError;
						if (err) return reject(err);
						resolve();
					});
				});
			} catch (err) {
				console.warn('Failed to write wallpaperDB to storage.local', err);
			}

			// Collect thumbnail tasks from images and videos
			const tasks = [];
			const addEntries = (arr, type) => {
				if (!Array.isArray(arr)) return;
				for (const entry of arr) {
					// We'll key thumbnails by the asset path + ::thumb to keep uniqueness
					const assetKey = entry && entry.asset ? entry.asset : null;
					const thumbPath = entry && entry.thumbnail ? entry.thumbnail : null;
					if (!thumbPath || !assetKey) continue;
					const url = resolveAssetUrl(thumbPath);
					const key = `${assetKey}::thumb`;
					const meta = { id: entry.id || null, name: entry.name || null, type, version: entry.version || null };
					tasks.push({ url, key, meta });
				}
			};

			addEntries(manifest.images, 'image');
			addEntries(manifest.videos, 'video');

			// Download thumbnails with limited concurrency
			await openDB(); // ensure DB created/upgraded before downloads
			await runWithConcurrency(tasks, async (t) => {
				if (!t || !t.url) return { ok: false, error: 'invalid task' };
				return await downloadAndStoreBlob(t.url, t.key, t.meta);
			}, 6);

			// Activate immediately so updated service worker takes effect
			try { self.skipWaiting && self.skipWaiting(); } catch (e) {/* ignore */}
		} catch (err) {
			console.error('Install handler failed:', err);
		}
	})());
});

// Activate: claim clients so extension pages start controlled by this worker
self.addEventListener('activate', (event) => {
	event.waitUntil((async () => {
		try { await self.clients.claim(); } catch (e) { /* ignore */ }
	})());
});

// Optional: message handler to allow on-demand downloads or retrievals from pages
self.addEventListener('message', (ev) => {
	// Example: { action: 'getWallpaperDB' }
	const data = ev.data || {};
	if (data && data.action === 'getWallpaperDB') {
		app.storage.local.get('wallpaperDB', (res) => {
			const reply = res && res.wallpaperDB ? res.wallpaperDB : null;
			ev.source && ev.source.postMessage && ev.source.postMessage({ action: 'wallpaperDB', data: reply });
		});
	}
});
