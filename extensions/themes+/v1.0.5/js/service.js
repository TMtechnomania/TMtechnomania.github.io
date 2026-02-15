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

async function syncManifest() {
	try {
		const manifest = await fetchJson(WALLPAPER_JSON_URL);
		if (!manifest || typeof manifest.version !== "string") {
			// console.warn('Invalid manifest fetched');
			return { ok: false, error: "Invalid manifest" };
		}

		let prevManifest = null;
		try {
			prevManifest = await getStorageLocal(STORAGE_KEY_DB);
		} catch (e) {}

		try {
			await setStorageLocal({ [STORAGE_KEY_DB]: manifest });
		} catch (e) {
			// console.error('Failed to save manifest', e);
			return { ok: false, error: "Failed to save manifest" };
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

		const allNew = [].concat(manifest.images || [], manifest.videos || []);

		// IDB-dependent: clean up removed entries. Fails gracefully if IDB is broken.
		let existingKeys = [];
		try {
			existingKeys = await getAllMediaKeys();
		} catch (e) {}
		const keysToDelete = [];
		const newThumbKeys = new Set(allNew.map((e) => `${e.id}::thumb`));
		for (const k of existingKeys) {
			if (k.endsWith("::thumb") && !newThumbKeys.has(k)) {
				keysToDelete.push(k);
				keysToDelete.push(k.replace("::thumb", "::media"));
			}
		}
		if (keysToDelete.length) {
			await Promise.all(
				keysToDelete.map((k) => deleteMediaEntry(k).catch(() => null)),
			);
		}

		// Define first items early
		const firstImage =
			Array.isArray(manifest.images) && manifest.images.length ?
				manifest.images[0]
			:	null;
		const firstVideo =
			Array.isArray(manifest.videos) && manifest.videos.length ?
				manifest.videos[0]
			:	null;

		// STEP 1: Download First Image Wallpaper (BLOCKING)
		if (firstImage && firstImage.id && firstImage.asset) {
			try {
				const url = resolveAssetUrl(firstImage.asset);
				const key = `${firstImage.id}::media`;
				const existing = await getMediaEntry(key).catch(() => null);

				if (!existing || existing.status !== "ok") {
					// console.log("Step 1: Downloading First Image Wallpaper...", key);
					await downloadAndStoreResource({
						url: url,
						assetPath: firstImage.id,
						kind: "media",
						manifestEntry: firstImage,
						keyOverride: key,
						maxAttempts: 3,
					});
				}
			} catch (e) {
				// console.warn("Failed first image download", e);
			}
		}

		// STEP 2: Download All Thumbnails (BLOCKING)
		const candidates = [];
		for (const entry of allNew) {
			if (!entry || !entry.id || !entry.asset || !entry.thumbnail)
				continue;
			const key = `${entry.id}::thumb`;
			const prevV = prevMap[entry.id];
			if (prevV && prevV === entry.version) {
				const existing = await getMediaEntry(key).catch(() => null);
				if (existing && existing.status === "ok") continue;
			}
			candidates.push({ entry, key });
		}

		if (candidates.length) {
			// console.log("Step 2: Downloading All Thumbnails...", candidates.length);
			const thumbConcurrency = 6;
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

		// STEP 3: Download First Video Wallpaper (BLOCKING)
		if (firstVideo && firstVideo.id && firstVideo.asset) {
			try {
				const url = resolveAssetUrl(firstVideo.asset);
				const key = `${firstVideo.id}::media`;
				const existing = await getMediaEntry(key).catch(() => null);

				if (!existing || existing.status !== "ok") {
					// console.log("Step 3: Downloading First Video Wallpaper...", key);
					await downloadAndStoreResource({
						url: url,
						assetPath: firstVideo.id,
						kind: "media",
						manifestEntry: firstVideo,
						keyOverride: key,
						maxAttempts: 3,
					});
				}
			} catch (e) {
				// console.warn("Failed first video download", e);
			}
		}

		return { ok: true };
	} catch (err) {
		// console.error('syncManifest failed', err);
		return { ok: false, error: err.message };
	}
}

self.addEventListener("install", (event) => {
	event.waitUntil(
		(async () => {
			// Sync manifest — if IDB is broken, at least the JSON manifest
			// gets saved to chrome.storage so the UI can still work.
			await syncManifest().catch(() => {});
			try {
				self.skipWaiting();
			} catch (e) {}
		})(),
	);
});
self.addEventListener("activate", (event) => {
	event.waitUntil(self.clients.claim());
});

chrome.runtime.onInstalled.addListener(async (details) => {
	// Clean up legacy database "videoDB" if present
	try {
		const req = indexedDB.deleteDatabase("videoDB");
		req.onsuccess = () => {};
		req.onerror = () => {};
	} catch (e) {}

	// On install or update: fetch manifest first, THEN open user guide
	if (details.reason === "install" || details.reason === "update") {
		try {
			// 1. Fetch and save manifest to chrome.storage (no IDB dependency)
			const manifest = await fetchJson(WALLPAPER_JSON_URL).catch(
				() => null,
			);
			if (manifest && typeof manifest.version === "string") {
				await setStorageLocal({ [STORAGE_KEY_DB]: manifest }).catch(
					() => {},
				);
			}
		} catch (e) {}

		// 2. Now open user guide — manifest data is ready for display
		try {
			chrome.tabs.create({ url: "userguide.html" });
		} catch (e) {}

		// 3. Kick off thumbnail sync in the background (IDB-dependent, may fail silently)
		syncManifest().catch(() => {});
	}
});

// Common handler for both SW messages and Runtime messages
// State for media control routing - Priority-based system
const mediaTabs = new Map(); // tabId -> { data, lastUserAccess, timestamp }
let currentPriorityTabId = null;

// Select highest priority tab based on playing state and user interaction
function selectHighestPriorityTab() {
	if (mediaTabs.size === 0) return null;

	const tabs = Array.from(mediaTabs.entries()).map(([tabId, info]) => ({
		tabId,
		...info,
	}));

	// Separate playing and non-playing tabs
	const playingTabs = tabs.filter((t) => t.data?.isPlaying);
	const nonPlayingTabs = tabs.filter((t) => !t.data?.isPlaying);

	// Priority 1: If any tab is playing, choose the most recently accessed playing tab
	if (playingTabs.length > 0) {
		playingTabs.sort((a, b) => {
			const timeDiff = (b.lastUserAccess || 0) - (a.lastUserAccess || 0);
			// If timestamps are equal, prefer lower tab ID (created first)
			return timeDiff !== 0 ? timeDiff : a.tabId - b.tabId;
		});
		return playingTabs[0].tabId;
	}

	// Priority 2: No tabs playing, choose most recently accessed tab
	if (nonPlayingTabs.length > 0) {
		nonPlayingTabs.sort((a, b) => {
			const timeDiff = (b.lastUserAccess || 0) - (a.lastUserAccess || 0);
			// If timestamps are equal, prefer lower tab ID (created first)
			return timeDiff !== 0 ? timeDiff : a.tabId - b.tabId;
		});
		return nonPlayingTabs[0].tabId;
	}

	return null;
}

async function handleMessage(data, sendResponse, sender) {
	// Added sender param

	if (!data) return;

	// Media Message Routing
	if (data.type === "MEDIA_UPDATE" || data.type === "MEDIA_PRESENCE") {
		// From Content Script -> Service Worker
		if (sender && sender.tab) {
			const tabId = sender.tab.id;

			// Retain existing info if available
			const existing = mediaTabs.get(tabId);

			// Only update lastUserAccess if the message explicitly contains it (from MEDIA_PRESENCE)
			// Otherwise keep existing, or default to now() only if it's a new tab
			let lastUserAccess = data.data?.lastUserAccess;

			if (!lastUserAccess) {
				if (existing) {
					lastUserAccess = existing.lastUserAccess;
				} else {
					lastUserAccess = Date.now();
				}
			}

			// Update or add tab info
			mediaTabs.set(tabId, {
				data: data.data,
				lastUserAccess: lastUserAccess,
				timestamp: Date.now(),
			});

			// Calculate new priority tab
			const newPriorityTabId = selectHighestPriorityTab();

			// Only broadcast if priority tab actually changed
			if (newPriorityTabId !== currentPriorityTabId) {
				currentPriorityTabId = newPriorityTabId;

				// Broadcast to New Tab pages with the priority tab's data
				const priorityTabInfo = mediaTabs.get(currentPriorityTabId);
				if (priorityTabInfo) {
					const broadcastData = {
						type: data.type,
						data: priorityTabInfo.data,
						tabId: currentPriorityTabId,
						fromService: true,
					};
					chrome.runtime.sendMessage(broadcastData).catch((e) => {
						// console.warn('[Service] Failed to broadcast:', e);
					});
				}
			} else if (
				data.type === "MEDIA_UPDATE" &&
				newPriorityTabId === tabId
			) {
				// If priority didn't change but this is a MEDIA_UPDATE for the current priority tab,
				// broadcast the update (e.g., play/pause state changed, song changed)
				const priorityTabInfo = mediaTabs.get(currentPriorityTabId);
				if (priorityTabInfo) {
					const broadcastData = {
						type: data.type,
						data: priorityTabInfo.data,
						tabId: currentPriorityTabId,
						fromService: true,
					};
					chrome.runtime.sendMessage(broadcastData).catch((e) => {
						// console.warn('[Service] Failed to broadcast:', e);
					});
				}
			}
			// MEDIA_PRESENCE updates for non-priority tabs are silently stored without broadcasting
		}
		if (sendResponse) sendResponse({});
		return;
	}

	if (data.type === "MEDIA_CONTROL") {
		if (data.action === "activate_tab") {
			if (currentPriorityTabId) {
				chrome.tabs
					.update(currentPriorityTabId, { active: true })
					.catch((e) => {
						// console.warn('[Service] Failed to activate tab:', e);
					});
			}
			return;
		}

		// From New Tab -> Service Worker -> Content Script
		if (currentPriorityTabId) {
			// Send control message to the priority tab without switching to it
			chrome.tabs.sendMessage(currentPriorityTabId, data).catch((e) => {
				// console.warn(`[Service] Failed to send control to tab ${currentPriorityTabId}`, e);
			});
		} else {
			// console.warn('[Service] No active media tab to send control to');
		}
		if (sendResponse) sendResponse({});
		return;
	}

	if (data.type === "MEDIA_QUERY") {
		// Broadcast query to all tabs to find active media
		chrome.tabs.query({}, (tabs) => {
			tabs.forEach((tab) => {
				chrome.tabs.sendMessage(tab.id, data).catch((e) => {
					// Expected for tabs without content scripts
				});
			});
		});
		if (sendResponse) sendResponse({});
		return;
	}

	if (!data.action) return;

	if (data.action === "getWallpaperDB") {
		try {
			const db = await getStorageLocal(STORAGE_KEY_DB);
			sendResponse({ action: "wallpaperDB", data: db || null });
		} catch (e) {
			sendResponse({
				action: "wallpaperDB",
				data: null,
				error: e.message,
			});
		}
		return;
	}
	if (data.action === "refreshManifest") {
		try {
			const res = await syncManifest();
			sendResponse({
				action: "refreshManifestResult",
				result: res,
			});
		} catch (err) {
			sendResponse({
				action: "refreshManifestResult",
				result: { ok: false, error: err.message || String(err) },
			});
		}
		return;
	}
	// ... Add other handlers if needed, but for now specific to refresh logic which is what we need.
	// The existing sw message handler is complex with source.postMessage.
	// We'll leave the existing SW handler for existing flows, and just add this one for the new Refresh button
	// or direct internal calls that use runtime.sendMessage.
}

chrome.runtime.onMessage.addListener((data, sender, sendResponse) => {
	handleMessage(data, sendResponse, sender);
	return true; // Keep channel open for async response
});

self.addEventListener("message", (ev) => {
	const data = ev.data || {};
	const source = ev.source;
	const post = (msg) => {
		try {
			source && source.postMessage && source.postMessage(msg);
		} catch (e) {}
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
					async (t) =>
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

	if (data.action === "refreshManifest") {
		(async () => {
			try {
				const res = await syncManifest();
				post({
					action: "refreshManifestResult",
					result: res,
				});
			} catch (err) {
				post({
					action: "refreshManifestResult",
					result: { ok: false, error: err.message || String(err) },
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
				const alarmId = alarm.name;
				const isSnooze = alarmId.startsWith("snooze_");

				// Get alarm label for notification
				let alarmLabel = "Alarm";
				if (isSnooze) {
					// Look up snooze info from storage
					try {
						const result =
							await chrome.storage.local.get("snooze_alarms");
						const snoozes = result.snooze_alarms || {};
						if (snoozes[alarmId]) {
							alarmLabel = snoozes[alarmId].label || "Alarm";
							// Clean up snooze entry after use
							delete snoozes[alarmId];
							await chrome.storage.local.set({
								snooze_alarms: snoozes,
							});
						}
					} catch (e) {}
				}

				// Store firing state with alarm info
				try {
					await chrome.storage.local.set({
						alarm_firing: true,
						alarm_id: alarmId,
						alarm_label: alarmLabel,
					});
				} catch (e) {}

				const clients = await self.clients.matchAll({
					type: "window",
					includeUncontrolled: true,
				});
				if (clients && clients.length) {
					clients.forEach((c) => {
						try {
							if (c && c.postMessage)
								c.postMessage({
									action: "alarm:fired",
									id: alarmId,
									label: alarmLabel,
									isSnooze,
								});
						} catch (e) {}
					});
				} else {
					// No extension tab open - show notification
					try {
						if (
							chrome.notifications &&
							chrome.notifications.create
						) {
							chrome.notifications.create(alarmId, {
								type: "basic",
								iconUrl: "icons/icon128.png",
								title: alarmLabel,
								message: "Alarm is ringing! Click to open.",
								priority: 2,
								requireInteraction: true,
							});
						}
					} catch (e) {}
				}
			} catch (e) {}
		});
	}
} catch (e) {}

// Handle notification click - focus extension tab
try {
	if (chrome && chrome.notifications && chrome.notifications.onClicked) {
		chrome.notifications.onClicked.addListener(async (notificationId) => {
			try {
				// Clear the notification
				chrome.notifications.clear(notificationId);

				// Find or create a new tab page
				const tabs = await chrome.tabs.query({
					url: chrome.runtime.getURL("newtab.html"),
				});
				if (tabs && tabs.length > 0) {
					// Focus existing tab
					await chrome.tabs.update(tabs[0].id, { active: true });
					await chrome.windows.update(tabs[0].windowId, {
						focused: true,
					});
				} else {
					// Open new tab
					await chrome.tabs.create({ url: "newtab.html" });
				}
			} catch (e) {}
		});
	}
} catch (e) {}

// Watch for tab closure to clear media state
chrome.tabs.onRemoved.addListener((tabId) => {
	if (mediaTabs.has(tabId)) {
		mediaTabs.delete(tabId);

		// Recalculate priority tab
		const newPriorityTabId = selectHighestPriorityTab();

		// If priority changed, broadcast the new priority tab's data or clear
		if (newPriorityTabId !== currentPriorityTabId) {
			currentPriorityTabId = newPriorityTabId;

			if (currentPriorityTabId) {
				const priorityTabInfo = mediaTabs.get(currentPriorityTabId);
				if (priorityTabInfo) {
					chrome.runtime
						.sendMessage({
							type: "MEDIA_UPDATE",
							data: priorityTabInfo.data,
							tabId: currentPriorityTabId,
							fromService: true,
						})
						.catch(() => {});
				}
			} else {
				// No media tabs left, clear the media widget
				chrome.runtime
					.sendMessage({
						type: "MEDIA_UPDATE",
						data: null,
						fromService: true,
					})
					.catch(() => {});
			}
		}
	}
});

// Watch for navigation to clear media state (e.g. user goes from Amazon Music to Google)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
	if (changeInfo.status === "loading" && mediaTabs.has(tabId)) {
		mediaTabs.delete(tabId);

		const newPriorityTabId = selectHighestPriorityTab();

		if (newPriorityTabId !== currentPriorityTabId) {
			currentPriorityTabId = newPriorityTabId;

			if (currentPriorityTabId) {
				const priorityTabInfo = mediaTabs.get(currentPriorityTabId);
				if (priorityTabInfo) {
					chrome.runtime
						.sendMessage({
							type: "MEDIA_UPDATE",
							data: priorityTabInfo.data,
							tabId: currentPriorityTabId,
							fromService: true,
						})
						.catch(() => {});
				}
			} else {
				chrome.runtime
					.sendMessage({
						type: "MEDIA_UPDATE",
						data: null,
						fromService: true,
					})
					.catch(() => {});
			}
		}
	}
});

// === ZEN MODE BLOCK WEB LOGIC ===
let focusLockTabId = null;

// Helper to force focus with retries
async function forceFocus(tabId, retryCount = 0) {
	try {
		const lockedTab = await chrome.tabs.get(tabId);
		await chrome.windows.update(lockedTab.windowId, { focused: true });
		await chrome.tabs.update(tabId, { active: true });
	} catch (e) {
		console.warn(`[Block Web] Attempt ${retryCount + 1} failed:`, e);

		// Stop if tab is gone
		if (e.message && e.message.includes("No tab with id")) {
			console.log("[Block Web] Tab gone, clearing lock");
			focusLockTabId = null;
			return;
		}

		// Retry for transient errors (like dragging)
		if (retryCount < 5) {
			setTimeout(() => forceFocus(tabId, retryCount + 1), 100);
		}
	}
}

// Listen for tab switching to enforce lock
chrome.tabs.onActivated.addListener((activeInfo) => {
	if (focusLockTabId && activeInfo.tabId !== focusLockTabId) {
		console.log(
			"[Block Web] Tab switch detected. Forcing back to locked tab:",
			focusLockTabId,
		);
		forceFocus(focusLockTabId);
	}
});

// Clear lock if locked tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
	if (focusLockTabId === tabId) {
		console.log("[Block Web] Locked tab closed, clearing lock");
		focusLockTabId = null;
	}
});

// Handle ZEN control messages
chrome.runtime.onMessage.addListener((data, sender, sendResponse) => {
	if (data.type === "ZEN_MODE_CONTROL") {
		if (data.action === "ENABLE_BLOCK") {
			// Lock to the provided tab ID (explicit) or fallback to sender.tab
			if (data.tabId) {
				focusLockTabId = data.tabId;
				console.log("[Block Web] ENABLED for tab ID:", focusLockTabId);
			} else if (sender.tab) {
				focusLockTabId = sender.tab.id;
				console.log(
					"[Block Web] ENABLED for tab ID (from sender):",
					focusLockTabId,
				);
			} else {
				console.warn("[Block Web] No tab ID available");
			}
		} else if (data.action === "DISABLE_BLOCK") {
			console.log("[Block Web] DISABLED");
			focusLockTabId = null;
		}
		if (sendResponse) sendResponse({ locked: focusLockTabId });
	}
});
