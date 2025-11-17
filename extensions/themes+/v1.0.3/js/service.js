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

self.addEventListener("install", (event) => {
	event.waitUntil(
		(async () => {
			try {
				const manifest = await fetchJson(WALLPAPER_JSON_URL);
				if (!manifest || typeof manifest.version !== "string") {
				}
				let prevManifest = null;
				try {
					prevManifest = await getStorageLocal(STORAGE_KEY_DB);
				} catch (e) {
				}
				try {
					await setStorageLocal({ [STORAGE_KEY_DB]: manifest });
				} catch (e) {
				}
				const prevMap = {};
				if (prevManifest) {
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
				const existingKeys = await getAllMediaKeys();
				const keysToDelete = [];
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
					await Promise.all(
						keysToDelete.map((k) =>
							deleteMediaEntry(k).catch(() => null),
						),
					);
				}
				const candidates = [];
				for (const entry of allNew) {
					if (!entry || !entry.id || !entry.asset || !entry.thumbnail)
						continue;
					const key = `${entry.id}::thumb`;
					const prevV = prevMap[entry.id];
					if (prevV && prevV === entry.version) {
						const existing = await getMediaEntry(key).catch(
							() => null,
						);
						if (existing && existing.status === "ok") continue;
					}
					candidates.push({ entry, key });
				}
				if (candidates.length) {
					const thumbConcurrency = 8;
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
				try {
					const firstImage = Array.isArray(manifest.images) && manifest.images.length ? manifest.images[0] : null;
					const firstVideo = Array.isArray(manifest.videos) && manifest.videos.length ? manifest.videos[0] : null;
					const primaries = [];
					if (firstImage && firstImage.id && firstImage.asset) primaries.push({ entry: firstImage, url: resolveAssetUrl(firstImage.asset), key: `${firstImage.id}::media` });
					if (firstVideo && firstVideo.id && firstVideo.asset) primaries.push({ entry: firstVideo, url: resolveAssetUrl(firstVideo.asset), key: `${firstVideo.id}::media` });
					if (primaries.length) {
						const primaryConcurrency = 2;
						await runWithConcurrency(
							primaries,
							async (p) => {
								try {
									const existing = await getMediaEntry(p.key).catch(() => null);
									if (existing && existing.status === "ok") {
										return { ok: true, skipped: true };
									}
									return await downloadAndStoreResource({ url: p.url, assetPath: p.entry.id, kind: "media", manifestEntry: p.entry, keyOverride: p.key, maxAttempts: 3 });
								} catch (e) {
									return { ok: false, error: e && e.message ? e.message : String(e) };
								}
							},
							primaryConcurrency,
						);
					}
				} catch (e) {
				}
				try {
					self.skipWaiting();
				} catch (e) {
				}
				try {
					const url = (typeof chrome !== 'undefined' && chrome.runtime) ? chrome.runtime.getURL('newtab.html') : 'newtab.html';
					if (app && app.tabs && app.tabs.create) {
						try { app.tabs.create({ url }); } catch (err) { }
					} else if (self.clients && self.clients.openWindow) {
						try { await self.clients.openWindow(url); } catch (err) { }
					}
				} catch (err) {
				}
			} catch (err) {
			}
		})(),
	);
});
self.addEventListener("activate", (event) => {
	event.waitUntil(self.clients.claim());
});
self.addEventListener("message", (ev) => {
	const data = ev.data || {};
	const source = ev.source;
	const post = (msg) => {
		try {
			source && source.postMessage && source.postMessage(msg);
		} catch (e) {
		}
	};
	if (!data || !data.action) return;
	if (data.action === "getWallpaperDB") {
		(async () => {
			try {
				const db = await getStorageLocal(STORAGE_KEY_DB);
				post({ action: "wallpaperDB", data: db || null });
			} catch (e) {
				post({ action: "wallpaperDB", data: null, error: e.message });
			}
		})();
		return;
	}
	if (data.action === "getMediaStatus" && data.key) {
		(async () => {
			try {
				const entry = await getMediaEntry(data.key);
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
				const manifest = await getStorageLocal(STORAGE_KEY_DB);
				if (!manifest)
					return post({
						action: "redownloadResult",
						error: "no manifest",
					});
				const candidates = []
					.concat(manifest.images || [], manifest.videos || [])
					.filter((e) => e && e.id)
					.map((e) => ({
						entry: e,
						url: resolveAssetUrl(e.thumbnail),
						key: `${e.id}::thumb`,
					}));
				const need = [];
				for (const t of candidates) {
					try {
						const e = await getMediaEntry(t.key);
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
						t,
					) =>
						downloadAndStoreResource({
							url: t.url,
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
				const url = resolveAssetUrl(entry.asset);
				const result = await downloadAndStoreResource({
					url,
					assetPath: entry.id,
					kind: "media",
					manifestEntry: entry,
					maxAttempts: 3,
				});
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
try {
	if (chrome && chrome.alarms && chrome.alarms.onAlarm) {
		chrome.alarms.onAlarm.addListener(async (alarm) => {
			try {
				try { await chrome.storage.local.set({ 'alarm_firing': true, 'alarm_id': alarm.name }); } catch (e) {}
				const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
				if (clients && clients.length) {
					clients.forEach(c => {
						try {
							if (c && c.postMessage) c.postMessage({ action: 'alarm:fired', id: alarm.name });
						} catch (e) {}
					});
				} else {
					try {
						if (chrome.notifications && chrome.notifications.create) {
							chrome.notifications.create(alarm.name, {
								type: 'basic',
								iconUrl: 'icons/icon128.png',
								title: 'Alarm',
								message: `Alarm "${alarm.name}" is ringing!`,
								priority: 2,
							});
						}
					} catch (e) {}
				}
			} catch (e) {}
		});
	}
} catch (e) {}
