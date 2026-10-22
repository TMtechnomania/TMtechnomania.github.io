import { WALLPAPER_JSON_URL, STORAGE_KEY_DB } from "./config.js";
import { getMediaEntry, deleteMediaEntry, getAllMediaKeys } from "./db.js";
import {
	defaultsFromManifest,
	writeDefaultMediaIds,
} from "./wallpaperDefaults.js";
import {
	fetchJson,
	resolveAssetUrl,
	getStorageLocal,
	setStorageLocal,
	downloadAndStoreResource,
	runWithConcurrency,
} from "./api.js";
import { installGlobalErrorLogging, logError } from "./logger.js";

installGlobalErrorLogging("service-worker");

const app = chrome || browser;

/**
 * Download one of the two catalog defaults if it is not cached yet.
 *
 * Defaults are the first image and the first video in the catalog. Every
 * profile must have them (a fresh install has no other wallpaper), so this is
 * intentionally not tied to a user action. Existing entries are left alone:
 * one IndexedDB lookup, no network traffic.
 */
async function ensureDefaultMedia(entry, force = false) {
	if (!entry || !entry.id || !entry.asset) return;
	try {
		const key = `${entry.id}::media`;
		const existing = await getMediaEntry(key).catch(() => null);
		if (!force && existing && existing.status === "ok") return;

		await downloadAndStoreResource({
			url: resolveAssetUrl(entry.asset),
			assetPath: entry.id,
			kind: "media",
			manifestEntry: entry,
			maxAttempts: 3,
			noStore: force,
		});
	} catch (e) {
		// A failed default download is retried on the next catalog sync.
	}
}

/**
 * Re-download full media that is already cached.
 *
 * A wallpaper can be replaced on the server without its URL changing, so a
 * catalog refresh cannot rely on "download only what is missing". Entries the
 * user already has are fetched again (cache-bypassed) and overwritten.
 */
async function refreshCachedMedia(entries, skipIds = null) {
	const cached = [];
	for (const entry of entries) {
		if (!entry || !entry.id || !entry.asset) continue;
		if (skipIds && skipIds.has(entry.id)) continue;
		const existing = await getMediaEntry(`${entry.id}::media`).catch(
			() => null,
		);
		if (existing && existing.status === "ok") cached.push(entry);
	}
	if (!cached.length) return;

	await runWithConcurrency(
		cached,
		async (entry) =>
			await downloadAndStoreResource({
				url: resolveAssetUrl(entry.asset),
				assetPath: entry.id,
				kind: "media",
				manifestEntry: entry,
				maxAttempts: 3,
				noStore: true,
			}),
		3,
	);
}

/** Tell open new-tab pages that cached assets changed. */
function notifyAssetsReady() {
	try {
		chrome.runtime
			.sendMessage({ type: "WALLPAPER_ASSETS_READY" })
			.catch(() => {});
	} catch (e) {}
}

async function syncManifest({ force = false } = {}) {
	try {
		// A manual refresh must not be served a cached catalog: GitHub Pages
		// caches wallpaper.json for a few minutes. Bypass the HTTP cache and
		// add a cache-busting query when the refresh is explicit.
		let manifestUrl = WALLPAPER_JSON_URL;
		if (force) {
			const u = new URL(WALLPAPER_JSON_URL);
			u.searchParams.set("t", String(Date.now()));
			manifestUrl = u.href;
		}
		const manifest = await fetchJson(
			manifestUrl,
			15000,
			force ? { cache: "no-store" } : undefined,
		);
		if (!manifest || typeof manifest.version !== "string") {
			// console.warn('Invalid manifest fetched');
			return { ok: false, error: "Invalid manifest" };
		}

		// Normalize arrays so a malformed/partial payload cannot throw below.
		if (
			!Array.isArray(manifest.images) &&
			!Array.isArray(manifest.videos)
		) {
			return { ok: false, error: "Invalid manifest" };
		}
		if (!Array.isArray(manifest.images)) manifest.images = [];
		if (!Array.isArray(manifest.videos)) manifest.videos = [];

		let prevManifest = null;
		try {
			prevManifest = await getStorageLocal(STORAGE_KEY_DB);
		} catch (e) {}

		const allNew = [].concat(manifest.images || [], manifest.videos || []);
		const newTotal = allNew.filter((e) => e && e.id).length;
		const prevTotal = prevManifest
			? [].concat(prevManifest.images || [], prevManifest.videos || [])
					.filter((e) => e && e.id).length
			: 0;

		// Never replace a working catalog with an empty one.
		if (newTotal === 0) {
			return { ok: false, error: "Empty manifest" };
		}

		try {
			await setStorageLocal({ [STORAGE_KEY_DB]: manifest });
		} catch (e) {
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

		// Only prune when the new catalog is non-empty and hasn't collapsed
		// unexpectedly (e.g. partial manifest / transient server error).
		const manifestLooksComplete =
			newTotal >= Math.ceil(prevTotal * 0.25);

		// IDB-dependent: clean up removed entries. Fails gracefully if IDB is broken.
		let existingKeys = [];
		try {
			existingKeys = (await getAllMediaKeys()) || [];
		} catch (e) {}
		const keysToDelete = [];
		const newThumbKeys = new Set(allNew.map((e) => `${e.id}::thumb`));
		for (const k of existingKeys) {
			if (k.endsWith("::thumb") && !newThumbKeys.has(k)) {
				keysToDelete.push(k);
				keysToDelete.push(k.replace("::thumb", "::media"));
			}
		}
		// Defaults are product fallbacks: never remove them here. `force` is
		// only for entries that have disappeared from the catalog entirely.
		if (manifestLooksComplete && keysToDelete.length) {
			await Promise.all(
				keysToDelete.map((k) =>
					deleteMediaEntry(k, { force: true }).catch(() => null),
				),
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

		// First image/video are the product defaults: auto-downloaded so a
		// fresh profile renders immediately, and never deletable in the UI.
		// Record them before downloading so the settings grid can flag the
		// tiles even while the media is still in flight.
		const defaults = defaultsFromManifest(manifest);
		await writeDefaultMediaIds(defaults);

		// STEP 1: Default image wallpaper (needed for the very first render).
		await ensureDefaultMedia(firstImage, force);

		// The default image is cached now: let open new-tab pages retry a
		// render that happened before the asset was available.
		notifyAssetsReady();

		// STEP 2: thumbnails and the default video in parallel. The video is
		// downloaded alongside the catalog instead of after 100+ thumbnails,
		// so switching to Video has a local default even if the worker is
		// stopped shortly after install.
		const candidates = [];
		for (const entry of allNew) {
			if (!entry || !entry.id || !entry.asset || !entry.thumbnail)
				continue;
			const key = `${entry.id}::thumb`;
			if (!force) {
				const existing = await getMediaEntry(key).catch(() => null);
				const cached = existing && existing.status === "ok";
				if (cached) {
					const prevV = prevMap[entry.id];
					const nextV = entry.version || null;
					// Only refetch a cached thumb when the catalog explicitly
					// says it changed (or on an explicit refresh below).
					if (!prevV || !nextV || prevV === nextV) continue;
				}
			}
			candidates.push({ entry, key });
		}

		const downloadThumbs = async () => {
			if (!candidates.length) return;
			await runWithConcurrency(
				candidates,
				async (t) => {
					const url = resolveAssetUrl(t.entry.thumbnail);
					return await downloadAndStoreResource({
						url,
						assetPath: t.entry.id,
						kind: "thumb",
						manifestEntry: t.entry,
						noStore: force,
					});
				},
				6,
			);
		};

		await Promise.all([ensureDefaultMedia(firstVideo, force), downloadThumbs()]);

		// Explicit refresh: replace full media the user already has, since a
		// re-uploaded wallpaper keeps its URL. The two defaults were already
		// refreshed above, so skip them here.
		if (force) {
			const defaultIds = new Set(
				[firstImage?.id, firstVideo?.id].filter(Boolean),
			);
			await refreshCachedMedia(allNew, defaultIds);
		}

		// Let open new-tab pages pick up the default video as well.
		notifyAssetsReady();

		return { ok: true };
	} catch (err) {
		logError("wallpaper-sync", err);
		return { ok: false, error: err.message };
	}
}

self.addEventListener("install", (event) => {
	// Activate immediately. Catalog sync must not hold the install phase:
	// large thumbnail catalogs/slow networks can exceed Chromium's install
	// timeout. The new-tab page retries when assets become ready.
	try {
		self.skipWaiting();
	} catch (e) {}
	syncManifest().catch(() => {});
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

	// Fresh install: open the Calendar tool as a floating panel by default.
	// Positions are stored in rem so they follow the responsive UI scale.
	// Only `install` seeds this; updates keep existing layouts untouched.
	if (details.reason === "install") {
		try {
			await setStorageLocal({
				tm_tool_floats_v2: JSON.stringify({
					version: 2,
					unit: "rem",
					tools: [{ id: "calendar", x: 5, y: 5 }],
				}),
			});
		} catch (e) {}
	}

	// Catalog sync is handled exactly once by the install event above.
	// Here we only open the user guide on install/update.
	if (details.reason === "install" || details.reason === "update") {
		try {
			chrome.tabs.create({ url: "userguide.html" });
		} catch (e) {}
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

	// New Tab instance registration
	if (data.type === "NEWTAB_REGISTER" && sender?.tab?.id) {
		_registerNewTab(sender.tab.id);
		if (sendResponse) sendResponse({ ok: true });
		return;
	}
	if (data.type === "NEWTAB_UNREGISTER" && sender?.tab?.id) {
		_unregisterNewTab(sender.tab.id);
		if (sendResponse) sendResponse({ ok: true });
		return;
	}

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
					.then((tab) => {
						// If the media tab is in another window, activating it
						// is not enough; that window must be focused too.
						if (tab && tab.windowId != null) {
							return chrome.windows.update(tab.windowId, {
								focused: true,
							});
						}
					})
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
			const res = await syncManifest({ force: data.force === true });
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
	if (data.action === "downloadFullAsset" && data.manifestEntry) {
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
			sendResponse({
				action: "downloadFullAssetResult",
				key: `${entry.id}::media`,
				result,
			});
		} catch (err) {
			sendResponse({
				action: "downloadFullAssetResult",
				error: err && err.message ? err.message : String(err),
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
	// Wallpaper sync messages are handled by the dedicated function below.
	// Returning true here would make this generic handler answer {ok:true}
	// before the sync handler can call sendResponse().
	const type = data && data.type;
	if (
		type === "WALLPAPER_SYNC_QUERY" ||
		type === "WALLPAPER_SYNC" ||
		type === "WALLPAPER_SYNC_TIME"
	) {
		return handleWallpaperSyncMessage(data, sender, sendResponse);
	}
	if (type === "ZEN_MODE_CONTROL") {
		return handleZenControlMessage(data, sender, sendResponse);
	}
	let responded = false;
	const respond = (resp) => {
		if (responded) return;
		responded = true;
		try {
			if (sendResponse) sendResponse(resp);
		} catch (e) {}
	};
	handleMessage(data, respond, sender).catch((err) => {
		if (!responded) respond({ ok: false, error: (err && err.message) || String(err) });
	}).finally(() => {
		if (!responded) respond({ ok: true });
	});
	return true; // Keep channel open for async response
});

const ALARMS_STORAGE_KEY = "alarms_list_v1";

async function clearAlarmFiringState(notificationId = null) {
	try {
		const st = await chrome.storage.local.get([
			"alarm_firing",
			"alarm_id",
		]);
		if (!st.alarm_firing) return;
		if (
			notificationId &&
			st.alarm_id &&
			notificationId !== st.alarm_id
		)
			return;
		await chrome.storage.local.set({
			alarm_firing: false,
			alarm_id: null,
			alarm_label: null,
			alarm_fired_at: null,
		});
		// Tell open new-tab pages to stop ringing as well.
		try {
			chrome.runtime
				.sendMessage({ type: "ALARM_STOPPED", id: notificationId })
				.catch(() => {});
		} catch (e) {}
	} catch (e) {}
}

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
				} else {
					// Regular alarms store their label in the alarm list.
					try {
						const result = await chrome.storage.local.get(
							ALARMS_STORAGE_KEY,
						);
						const raw = result[ALARMS_STORAGE_KEY];
						const list =
							typeof raw === "string" ? JSON.parse(raw) : raw;
						if (Array.isArray(list)) {
							const baseId = alarmId.split("_day_")[0];
							const found = list.find(
								(a) => a && a.id === baseId,
							);
							if (found && found.label)
								alarmLabel = found.label;
						}
					} catch (e) {}
				}

				const firedAt = Date.now();

				// Store firing state with alarm info and a timestamp so pages
				// can ignore stale firings instead of replaying them later.
				try {
					await chrome.storage.local.set({
						alarm_firing: true,
						alarm_id: alarmId,
						alarm_label: alarmLabel,
						alarm_fired_at: firedAt,
					});
				} catch (e) {}

				// Target only the active new-tab page. Broadcasting would make
				// every open new-tab ring and would suppress the OS notification
				// even when the page is hidden or playback was blocked.
				let targetTabId = null;
				try {
					const activeTabs = await chrome.tabs.query({
						active: true,
						lastFocusedWindow: true,
					});
					const target = (activeTabs || []).find((t) =>
						_isNewtabUrl(t.url),
					);
					if (target) targetTabId = target.id;
				} catch (e) {}

				let handled = false;
				let played = false;
				let visible = false;
				if (targetTabId != null) {
					try {
						const response = await chrome.runtime.sendMessage({
							type: "ALARM_FIRED",
							id: alarmId,
							label: alarmLabel,
							isSnooze,
							firedAt,
							targetTabId,
						});
						handled = !!response?.handled;
						played = !!response?.played;
						visible = !!response?.visible;
					} catch (e) {}
				}

				if (!(handled && played && visible)) {
					// No visible page actually played the alarm - show notification
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
				await clearAlarmFiringState(notificationId);

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

// Dismissing a notification clears the firing flag so the alarm cannot
// replay the next time the Alarms modal opens.
try {
	if (chrome && chrome.notifications && chrome.notifications.onClosed) {
		chrome.notifications.onClosed.addListener((notificationId) => {
			clearAlarmFiringState(notificationId);
		});
	}
} catch (e) {}

// Watch for tab closure to clear media state
function handleMediaTabRemoved(tabId) {
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
}

// Watch for navigation to clear media state (e.g. user goes from Amazon Music to Google)
function handleMediaTabUpdated(tabId, changeInfo, tab) {
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
}

// === WALLPAPER SYNC MANAGEMENT ===
const _syncTimes = new Map(); // tabId -> { time, duration, lastUpdate }
let _syncState = false; // true = in sync, false = out of sync

// Restore the last known state after a service-worker restart.
try {
	chrome.storage.local.get("wallpaperSyncState", (res) => {
		if (typeof res?.wallpaperSyncState === "boolean") {
			_syncState = res.wallpaperSyncState;
		}
	});
} catch (e) {}

function _broadcastSyncStatus() {
	// New-tab pages are extension pages, not content scripts, so
	// chrome.tabs.sendMessage() cannot reach them. Runtime messaging does.
	// The sync action stays available whenever two or more new-tab pages are
	// open, even if they happen to be momentarily in sync.
	const needSync = newTabInstances.length >= 2;
	try {
		chrome.runtime
			.sendMessage({
				type: "WALLPAPER_SYNC_STATUS",
				needSync,
				tabCount: newTabInstances.length,
			})
			.catch(() => {});
	} catch (e) {}
}

function _setSyncState(next) {
	if (_syncState === next) return;
	_syncState = next;
	try {
		chrome.storage.local.set({ wallpaperSyncState: next });
	} catch (e) {}
	_broadcastSyncStatus();
}

function _checkSync() {
	if (_syncTimes.size < 2) {
		_setSyncState(true);
		return;
	}
	const times = Array.from(_syncTimes.values()).map((v) => v.time);
	const maxTime = Math.max(...times);
	const minTime = Math.min(...times);
	const spread = maxTime - minTime;
	_setSyncState(spread < 0.5); // 500ms tolerance
}

function handleWallpaperSyncMessage(msg, sender, sendResponse) {
	if (msg.type === "WALLPAPER_SYNC" && sender.tab) {
		// Broadcast sync to all newtab instances (extension pages).
		try {
			chrome.runtime
				.sendMessage({ type: "WALLPAPER_SYNC" })
				.catch(() => {});
		} catch (e) {}
		return false;
	}
	if (msg.type === "WALLPAPER_SYNC_TIME" && sender.tab) {
		_syncTimes.set(sender.tab.id, {
			time: msg.time,
			duration: msg.duration,
			lastUpdate: Date.now(),
		});
		// Clean up stale entries
		const now = Date.now();
		for (const [tid, info] of _syncTimes) {
			if (now - info.lastUpdate > 5000) _syncTimes.delete(tid);
		}
		_checkSync();
		return false;
	}
	if (msg.type === "WALLPAPER_SYNC_QUERY") {
		// Chrome ignores listener return values; only sendResponse works.
		if (sendResponse) {
			sendResponse({
				needSync: newTabInstances.length >= 2,
				tabCount: newTabInstances.length,
			});
		}
		return false;
	}
	return false;
}

// === NEW TAB INSTANCE MANAGEMENT ===
let newTabInstances = []; // Ordered list of {tabId, autoMuted}
let audioOwnerTabId = null; // only this new-tab may play wallpaper audio

function _sendAudioState(tabId, muted) {
	if (tabId == null) return;
	try {
		chrome.runtime
			.sendMessage({
				type: muted ? "WALLPAPER_MUTE" : "WALLPAPER_UNMUTE",
				tabId,
			})
			.catch(() => {});
	} catch (e) {}
}

/**
 * Make exactly one new-tab page the audio owner. All other instances are
 * auto-muted. Passing null mutes every new-tab page.
 */
function _setAudioOwner(tabId) {
	audioOwnerTabId = tabId ?? null;
	for (const inst of newTabInstances) {
		const shouldMute = inst.tabId !== audioOwnerTabId;
		inst.autoMuted = shouldMute;
		// Send unconditionally: after a service-worker restart the page may
		// still hold an older mute state, so a no-op comparison is unsafe.
		_sendAudioState(inst.tabId, shouldMute);
	}
}

function _getNewtabUrl() {
	try { return chrome.runtime.getURL("newtab.html"); } catch (e) { return null; }
}

function _isNewtabUrl(url) {
	if (!url) return false;
	const nt = _getNewtabUrl();
	return nt && url.startsWith(nt);
}

function _rebuildNewTabInstances() {
	const nt = _getNewtabUrl();
	if (!nt) return;
	chrome.tabs.query({}, (tabs) => {
		if (chrome.runtime.lastError) return;
		const matching = (tabs || []).filter(
			(t) => t.url && t.url.startsWith(nt),
		);
		newTabInstances = matching.map((t) => ({
			tabId: t.id,
			autoMuted: false,
		}));
		_broadcastSyncStatus();
		// After a service-worker restart, ownership follows the active
		// new-tab page; if none is active, mute all until one is focused.
		const active = matching.find((t) => t.active);
		_setAudioOwner(active ? active.id : null);
	});
}

function _registerNewTab(tabId) {
	newTabInstances = newTabInstances.filter((i) => i.tabId !== tabId);
	newTabInstances.push({ tabId, autoMuted: false });
	_broadcastSyncStatus();
	// Audio ownership follows the active tab; a background new tab is muted
	// until it becomes active.
	try {
		chrome.tabs.get(tabId, (tab) => {
			if (chrome.runtime.lastError) {
				_setAudioOwner(tabId);
				return;
			}
			if (tab && tab.active) {
				_setAudioOwner(tabId);
			} else {
				const inst = newTabInstances.find((i) => i.tabId === tabId);
				if (inst) {
					inst.autoMuted = true;
					_sendAudioState(tabId, true);
				}
			}
		});
	} catch (e) {
		_setAudioOwner(tabId);
	}
}

function _unregisterNewTab(tabId) {
	const idx = newTabInstances.findIndex((i) => i.tabId === tabId);
	if (idx === -1) return;
	const wasAudioOwner = audioOwnerTabId === tabId;
	newTabInstances.splice(idx, 1);
	_broadcastSyncStatus();

	if (wasAudioOwner) {
		// Prefer the active new-tab page if there is one; otherwise mute all
		// until the user returns to a new-tab page.
		audioOwnerTabId = null;
		try {
			chrome.tabs.query(
				{ active: true, lastFocusedWindow: true },
				(tabs) => {
					const activeId = tabs && tabs[0] ? tabs[0].id : null;
					if (
						activeId != null &&
						newTabInstances.some((i) => i.tabId === activeId)
					) {
						_setAudioOwner(activeId);
					} else {
						_setAudioOwner(null);
					}
				},
			);
		} catch (e) {
			_setAudioOwner(null);
		}
	}
}

// Switching between tabs moves wallpaper audio ownership with the user.
chrome.tabs.onActivated.addListener(({ tabId }) => {
	if (newTabInstances.some((i) => i.tabId === tabId)) {
		_setAudioOwner(tabId);
	} else if (audioOwnerTabId !== null) {
		_setAudioOwner(null);
	}
});

// Rebuild instance list on SW startup
_rebuildNewTabInstances();

// Detect tabs navigating to newtab.html
function handleNewTabUpdated(tabId, changeInfo, tab) {
	if (changeInfo.url && _isNewtabUrl(changeInfo.url)) {
		_registerNewTab(tabId);
	}
	// If a registered tab navigates away, unregister it
	if (changeInfo.url && !_isNewtabUrl(changeInfo.url)) {
		const wasRegistered = newTabInstances.some((i) => i.tabId === tabId);
		if (wasRegistered) {
			_unregisterNewTab(tabId);
		}
	}
}

// Handle tab closure (catches cases where unload wasn't fired)
function handleNewTabRemoved(tabId) {
	_unregisterNewTab(tabId);
}

// === ZEN MODE BLOCK WEB LOGIC ===
const ZEN_BLOCK_STATE_KEY = "zenBlockedTab";
const ZEN_MUTE_STATE_KEY = "zenMuteState";
let focusLockTabId = null;
let zenMutedTabs = [];
let zenMuteKeepTabId = null;

async function persistBlockState() {
	try {
		if (focusLockTabId) {
			await chrome.storage.session.set({
				[ZEN_BLOCK_STATE_KEY]: { tabId: focusLockTabId },
			});
		} else {
			await chrome.storage.session.remove(ZEN_BLOCK_STATE_KEY);
		}
	} catch (e) {}
}

async function persistMuteState() {
	try {
		if (zenMutedTabs.length === 0 && zenMuteKeepTabId == null) {
			await chrome.storage.session.remove(ZEN_MUTE_STATE_KEY);
		} else {
			await chrome.storage.session.set({
				[ZEN_MUTE_STATE_KEY]: {
					keepTabId: zenMuteKeepTabId,
					muted: zenMutedTabs,
				},
			});
		}
	} catch (e) {}
}

async function unmuteZenTabs() {
	const ids = zenMutedTabs.slice();
	zenMutedTabs = [];
	zenMuteKeepTabId = null;
	for (const id of ids) {
		try {
			await chrome.tabs.update(id, { muted: false });
		} catch (e) {}
	}
	await persistMuteState();
}

async function setZenMuteOthers(enable, keepTabId) {
	if (!enable) {
		await unmuteZenTabs();
		return;
	}
	// A different Zen tab taking over: restore the previous one first.
	if (zenMuteKeepTabId != null && zenMuteKeepTabId !== keepTabId) {
		await unmuteZenTabs();
	}
	zenMuteKeepTabId = keepTabId ?? null;
	const tracked = new Set(zenMutedTabs);
	const all = await chrome.tabs.query({});
	for (const tab of all) {
		if (tab.id === zenMuteKeepTabId) continue;
		if (tab.mutedInfo?.muted) continue;
		if (tracked.has(tab.id)) continue;
		try {
			await chrome.tabs.update(tab.id, { muted: true });
			tracked.add(tab.id);
		} catch (e) {}
	}
	zenMutedTabs = [...tracked];
	await persistMuteState();
}

// Restore after service-worker suspension. If the Zen tab disappeared while
// the SW was asleep, do not leave the browser muted.
(async () => {
	try {
		const res = await chrome.storage.session.get([
			ZEN_BLOCK_STATE_KEY,
			ZEN_MUTE_STATE_KEY,
		]);
		const block = res?.[ZEN_BLOCK_STATE_KEY];
		if (block?.tabId) {
			try {
				await chrome.tabs.get(block.tabId);
				focusLockTabId = block.tabId;
			} catch (e) {
				await chrome.storage.session.remove(ZEN_BLOCK_STATE_KEY);
			}
		}

		const mute = res?.[ZEN_MUTE_STATE_KEY];
		if (mute) {
			zenMutedTabs = Array.isArray(mute.muted) ? mute.muted : [];
			zenMuteKeepTabId = mute.keepTabId ?? null;
			let keepAlive = true;
			if (zenMuteKeepTabId != null) {
				try {
					await chrome.tabs.get(zenMuteKeepTabId);
				} catch (e) {
					keepAlive = false;
				}
			}
			if (!keepAlive) await unmuteZenTabs();
		}
	} catch (e) {}
})();

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

// Clear lock if locked tab is closed; restore mutes if the Zen tab is gone.
function handleZenTabRemoved(tabId) {
	if (focusLockTabId === tabId) {
		console.log("[Block Web] Locked tab closed, clearing lock");
		focusLockTabId = null;
		persistBlockState();
	}
	if (zenMuteKeepTabId === tabId) {
		unmuteZenTabs();
	} else if (zenMutedTabs.includes(tabId)) {
		zenMutedTabs = zenMutedTabs.filter((id) => id !== tabId);
		persistMuteState();
	}
}

// Block Web also has to cover new tabs/windows; onActivated alone misses them.
chrome.tabs.onCreated.addListener(async (tab) => {
	if (focusLockTabId && tab.id !== focusLockTabId) {
		try {
			await chrome.tabs.remove(tab.id);
		} catch (e) {}
		forceFocus(focusLockTabId);
		return;
	}
	if (
		(zenMutedTabs.length > 0 || zenMuteKeepTabId != null) &&
		tab.id !== zenMuteKeepTabId &&
		tab.mutedInfo?.muted !== true
	) {
		try {
			await chrome.tabs.update(tab.id, { muted: true });
			zenMutedTabs.push(tab.id);
			persistMuteState();
		} catch (e) {}
	}
});

// Leaving the new-tab page ends the Zen protections that belonged to it.
function handleZenTabUpdated(tabId, changeInfo) {
	if (!changeInfo.url || _isNewtabUrl(changeInfo.url)) return;
	if (focusLockTabId === tabId) {
		focusLockTabId = null;
		persistBlockState();
	}
	if (zenMuteKeepTabId === tabId) {
		unmuteZenTabs();
	}
}

// A new window can also steal focus while Block Web is active.
chrome.windows.onFocusChanged.addListener(async (windowId) => {
	if (!focusLockTabId || windowId === chrome.windows.WINDOW_ID_NONE) return;
	try {
		const locked = await chrome.tabs.get(focusLockTabId);
		if (locked.windowId !== windowId) forceFocus(focusLockTabId);
	} catch (e) {
		focusLockTabId = null;
		persistBlockState();
	}
});

// Handle ZEN control messages
function handleZenControlMessage(data, sender, sendResponse) {
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
			persistBlockState();
		} else if (data.action === "DISABLE_BLOCK") {
			console.log("[Block Web] DISABLED");
			focusLockTabId = null;
			persistBlockState();
		} else if (data.action === "MUTE_OTHERS") {
			setZenMuteOthers(!!data.enable, data.keepTabId).catch(() => {});
		}
		if (sendResponse) sendResponse({ locked: focusLockTabId });
	}
}

// Single tab-lifecycle dispatchers (media state, new-tab instances, Zen mode).
chrome.tabs.onRemoved.addListener((tabId) => {
	handleMediaTabRemoved(tabId);
	handleNewTabRemoved(tabId);
	handleZenTabRemoved(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
	handleMediaTabUpdated(tabId, changeInfo, tab);
	handleNewTabUpdated(tabId, changeInfo, tab);
	handleZenTabUpdated(tabId, changeInfo);
});

