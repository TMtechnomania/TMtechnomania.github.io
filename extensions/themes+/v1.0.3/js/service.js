/* Service worker for extensions/themes+
     - Imports helpers from config.js, db.js, and api.js
     - On install: fetch manifest, store in chrome.storage, and download thumbnails.
     - Provide a message API for the extension UI.
*/

import { WALLPAPER_JSON_URL, STORAGE_KEY_DB } from "./config.js";
import { getMediaEntry, deleteMediaEntry, getAllMediaKeys } from "./db.js";
import {
	fetchJson,
	resolveAssetUrl,
	getStorageLocal,
	setStorageLocal,
	downloadAndStoreResource,
	runWithConcurrency,
} from "./api.js";

const app = chrome || browser;

// Install: fetch manifest, diff with previous, store manifest, prune deleted, download new/updated thumbnails
self.addEventListener("install", (event) => {
	event.waitUntil(
		(async () => {
			try {
				console.log("Install: fetching manifest...");
				const manifest = await fetchJson(WALLPAPER_JSON_URL);
				if (!manifest || typeof manifest.version !== "string") {
					console.warn("Manifest invalid");
				}

				// Read previous manifest using promisified helper
				let prevManifest = null;
				try {
					prevManifest = await getStorageLocal(STORAGE_KEY_DB);
				} catch (e) {
					console.warn("Failed to read previous manifest", e);
				}

				// Save new manifest using promisified helper
				try {
					await setStorageLocal({ [STORAGE_KEY_DB]: manifest });
				} catch (e) {
					console.warn("Failed to save manifest", e);
				}

				// Build prev version map
				const prevMap = {};
				if (prevManifest) {
					// ** CHANGED: Key previous versions by ID, not asset path **
					const collect = (arr) => {
						if (!Array.isArray(arr)) return;
						for (const e of arr)
							if (e && e.id) prevMap[e.id] = e.version || null;
					};
					collect(prevManifest.images);
					collect(prevManifest.videos);
				}

				const allNew = [].concat(
					manifest.images || [],
					manifest.videos || [],
				);

				// Prune deleted keys
				const existingKeys = await getAllMediaKeys(); // Imported from db.js
				const keysToDelete = [];
				// ** CHANGED: Build the set of "new" keys from entry.id **
				const newThumbKeys = new Set(
					allNew.map((e) => `${e.id}::thumb`),
				);
				for (const k of existingKeys) {
					if (k.endsWith("::thumb") && !newThumbKeys.has(k)) {
						keysToDelete.push(k);
						keysToDelete.push(k.replace("::thumb", "::media"));
					}
				}
				if (keysToDelete.length) {
					console.log(
						`Pruning ${keysToDelete.length} old/deleted assets...`,
					);
					await Promise.all(
						keysToDelete.map((k) =>
							deleteMediaEntry(k).catch(() => null),
						),
					); // Imported from db.js
				}

				// Build download list
				const candidates = [];
				for (const entry of allNew) {
					// ** CHANGED: Check for entry.id **
					if (!entry || !entry.id || !entry.asset || !entry.thumbnail)
						continue;

					// ** CHANGED: Use entry.id for the key **
					const key = `${entry.id}::thumb`;

					// ** CHANGED: Check previous version map by entry.id **
					const prevV = prevMap[entry.id];

					if (prevV && prevV === entry.version) {
						const existing = await getMediaEntry(key).catch(
							() => null,
						); // Imported from db.js
						if (existing && existing.status === "ok") continue;
					}
					candidates.push({ entry, key });
				}

				if (candidates.length) {
					const thumbConcurrency = 8; // increased concurrency for thumbnails
					console.log(`Downloading ${candidates.length} thumbnails (concurrency=${thumbConcurrency})...`);
					// Use imported helpers - concurrent thumbnail downloads
					await runWithConcurrency(
						candidates,
						async (t) => {
							const url = resolveAssetUrl(t.entry.thumbnail);
							return await downloadAndStoreResource({
								url,
								assetPath: t.entry.id,
								kind: "thumb",
								manifestEntry: t.entry,
							});
						},
						thumbConcurrency,
					);
				}

				// After thumbnail downloads, also attempt to download the first image and first video full-media assets
				try {
					const firstImage = Array.isArray(manifest.images) && manifest.images.length ? manifest.images[0] : null;
					const firstVideo = Array.isArray(manifest.videos) && manifest.videos.length ? manifest.videos[0] : null;
					const primaries = [];
					if (firstImage && firstImage.id && firstImage.asset) primaries.push({ entry: firstImage, url: resolveAssetUrl(firstImage.asset), key: `${firstImage.id}::media` });
					if (firstVideo && firstVideo.id && firstVideo.asset) primaries.push({ entry: firstVideo, url: resolveAssetUrl(firstVideo.asset), key: `${firstVideo.id}::media` });
					if (primaries.length) {
						const primaryConcurrency = 2; // small pool for primary media
						console.log(`Downloading ${primaries.length} primary media asset(s) (concurrency=${primaryConcurrency})...`);
						// Run primary downloads with a small concurrency to avoid blocking install
						await runWithConcurrency(
							primaries,
							async (p) => {
								try {
									const existing = await getMediaEntry(p.key).catch(() => null);
									if (existing && existing.status === "ok") {
										console.log(`Primary media already present: ${p.key}`);
										return { ok: true, skipped: true };
									}
									return await downloadAndStoreResource({ url: p.url, assetPath: p.entry.id, kind: "media", manifestEntry: p.entry, keyOverride: p.key, maxAttempts: 3 });
								} catch (e) {
									console.warn("Failed to download primary media", p.key, e && e.message ? e.message : e);
									return { ok: false, error: e && e.message ? e.message : String(e) };
								}
							},
							primaryConcurrency,
						);
					}
				} catch (e) {
					console.warn("Primary media download step failed", e && e.message ? e.message : e);
				}

				try {
					self.skipWaiting();
				} catch (e) {
					/* ignore */
				}
				console.log("Install complete");

				// Open a new tab to the extension's newtab page (requires "tabs" permission)
				try {
					const url = (typeof chrome !== 'undefined' && chrome.runtime) ? chrome.runtime.getURL('newtab.html') : 'newtab.html';
					if (app && app.tabs && app.tabs.create) {
						// chrome.tabs.create is callback-based; call and continue
						try { app.tabs.create({ url }); } catch (err) { console.warn('tabs.create failed', err); }
					} else if (self.clients && self.clients.openWindow) {
						// Fallback for environments without tabs API
						try { await self.clients.openWindow(url); } catch (err) { /* ignore */ }
					}
				} catch (err) {
					console.warn('Failed to open new tab after install', err && err.message ? err.message : err);
				}
			} catch (err) {
				console.error("Install failed", err);
			}
		})(),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(self.clients.claim());
});

// Message API
self.addEventListener("message", (ev) => {
	const data = ev.data || {};
	const source = ev.source;
	const post = (msg) => {
		try {
			source && source.postMessage && source.postMessage(msg);
		} catch (e) {
			/* ignore */
		}
	};
	if (!data || !data.action) return;

	if (data.action === "getWallpaperDB") {
		// ... (No change needed)
		(async () => {
			try {
				const db = await getStorageLocal(STORAGE_KEY_DB); // Use helper
				post({ action: "wallpaperDB", data: db || null });
			} catch (e) {
				post({ action: "wallpaperDB", data: null, error: e.message });
			}
		})();
		return;
	}

	if (data.action === "getMediaStatus" && data.key) {
		// ... (No change needed, UI will now request keys like "img-001::thumb")
		(async () => {
			try {
				const entry = await getMediaEntry(data.key); // Use helper
				post({
					action: "mediaStatus",
					key: data.key,
					data: entry || null,
				});
			} catch (e) {
				post({
					action: "mediaStatus",
					key: data.key,
					error: e && e.message ? e.message : String(e),
				});
			}
		})();
		return;
	}

	if (data.action === "redownloadMissing") {
		(async () => {
			try {
				const manifest = await getStorageLocal(STORAGE_KEY_DB); // Use helper
				if (!manifest)
					return post({
						action: "redownloadResult",
						error: "no manifest",
					});

				// ** CHANGED: Use entry.id for the key **
				const candidates = []
					.concat(manifest.images || [], manifest.videos || [])
					.filter((e) => e && e.id) // Ensure entry has an id
					.map((e) => ({
						entry: e,
						url: resolveAssetUrl(e.thumbnail),
						key: `${e.id}::thumb`,
					})); // Use helper

				const need = [];
				for (const t of candidates) {
					try {
						const e = await getMediaEntry(t.key); // Use helper
						if (!e || e.status !== "ok") need.push(t);
					} catch (err) {
						need.push(t);
					}
				}

				if (need.length === 0)
					return post({ action: "redownloadResult", data: [] });

				const results = await runWithConcurrency(
					need,
					async (
						t, // Use helper
					) =>
						downloadAndStoreResource({
							// Use helper
							url: t.url,
							// ** CHANGED: Use entry.id as assetPath **
							assetPath: t.entry.id,
							kind: "thumb",
							manifestEntry: t.entry,
						}),
					data.concurrency || 3,
				);
				post({ action: "redownloadResult", data: results });
			} catch (err) {
				post({
					action: "redownloadResult",
					error: err && err.message ? err.message : String(err),
				});
			}
		})();
		return;
	}

	if (data.action === "downloadFullAsset" && data.manifestEntry) {
		(async () => {
			try {
				const entry = data.manifestEntry;
				if (!entry || !entry.id) throw new Error("Missing entry.id");

				const url = resolveAssetUrl(entry.asset); // Use helper
				const result = await downloadAndStoreResource({
					// Use helper
					url,
					// ** CHANGED: Use entry.id as assetPath **
					assetPath: entry.id,
					kind: "media",
					manifestEntry: entry,
					maxAttempts: 3,
				});
				// ** CHANGED: Report result using the ID-based key **
				post({
					action: "downloadFullAssetResult",
					key: `${entry.id}::media`,
					result,
				});
			} catch (err) {
				post({
					action: "downloadFullAssetResult",
					error: err && err.message ? err.message : String(err),
				});
			}
		})();
		return;
	}
});
