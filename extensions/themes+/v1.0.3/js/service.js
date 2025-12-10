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
             return { ok: false, error: 'Invalid manifest' };
        }
        
        let prevManifest = null;
        try {
            prevManifest = await getStorageLocal(STORAGE_KEY_DB);
        } catch (e) {}
        
        try {
            await setStorageLocal({ [STORAGE_KEY_DB]: manifest });
        } catch (e) {
             // console.error('Failed to save manifest', e);
             return { ok: false, error: 'Failed to save manifest' };
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

        // Prefetch first items
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
        } catch (e) {}
        
        return { ok: true };

    } catch (err) {
        // console.error('syncManifest failed', err);
        return { ok: false, error: err.message };
    }
}

self.addEventListener("install", (event) => {
	event.waitUntil(
		(async () => {
            await syncManifest();
			
            try {
                self.skipWaiting();
            } catch (e) {}

            try {
                const url = (typeof chrome !== 'undefined' && chrome.runtime) ? chrome.runtime.getURL('newtab.html') : 'newtab.html';
                if (app && app.tabs && app.tabs.create) {
                    try { app.tabs.create({ url }); } catch (err) { }
                } else if (self.clients && self.clients.openWindow) {
                    try { await self.clients.openWindow(url); } catch (err) { }
                }
            } catch (err) {}
		})(),
	);
});
self.addEventListener("activate", (event) => {
	event.waitUntil(self.clients.claim());
});

chrome.runtime.onInstalled.addListener(async (details) => {
    // Clean up legacy database "videoDB" if present, as per user request
    // This ensures we start fresh or remove old unused data
    try {
        const req = indexedDB.deleteDatabase('videoDB');
        req.onsuccess = () => {}; // console.log('Legacy videoDB cleanup success');
        req.onerror = () => {}; // console.warn('Legacy videoDB cleanup error');
    } catch (e) {
        // console.warn('Legacy videoDB cleanup exception', e);
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
        ...info
    }));
    
    // Separate playing and non-playing tabs
    const playingTabs = tabs.filter(t => t.data?.isPlaying);
    const nonPlayingTabs = tabs.filter(t => !t.data?.isPlaying);
    
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

async function handleMessage(data, sendResponse, sender) { // Added sender param

    if (!data) return;
    
    // Media Message Routing
    if (data.type === 'MEDIA_UPDATE' || data.type === 'MEDIA_PRESENCE') {

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
                timestamp: Date.now()
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
                        fromService: true
                    };
                    chrome.runtime.sendMessage(broadcastData).catch((e) => {
                        // console.warn('[Service] Failed to broadcast:', e);
                    });
                }
            } else if (data.type === 'MEDIA_UPDATE' && newPriorityTabId === tabId) {
                // If priority didn't change but this is a MEDIA_UPDATE for the current priority tab,
                // broadcast the update (e.g., play/pause state changed, song changed)
                const priorityTabInfo = mediaTabs.get(currentPriorityTabId);
                if (priorityTabInfo) {
                    const broadcastData = { 
                        type: data.type,
                        data: priorityTabInfo.data, 
                        tabId: currentPriorityTabId,
                        fromService: true
                    };
                    chrome.runtime.sendMessage(broadcastData).catch((e) => {
                        // console.warn('[Service] Failed to broadcast:', e);
                    });
                }
            }
            // MEDIA_PRESENCE updates for non-priority tabs are silently stored without broadcasting
        }
        return;
    }

    if (data.type === 'MEDIA_CONTROL') {
        
        if (data.action === 'activate_tab') {
             if (currentPriorityTabId) {
                 chrome.tabs.update(currentPriorityTabId, { active: true }).catch((e) => {
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
        return;
    }

    if (data.type === 'MEDIA_QUERY') {

        // Broadcast query to all tabs to find active media
        chrome.tabs.query({}, (tabs) => {

            tabs.forEach(tab => {

                chrome.tabs.sendMessage(tab.id, data).catch((e) => {
                    // Expected for tabs without content scripts

                });
            });
        });
        return;
    }
    
    if (!data.action) return;

    if (data.action === "getWallpaperDB") {
        try {
            const db = await getStorageLocal(STORAGE_KEY_DB);
            sendResponse({ action: "wallpaperDB", data: db || null });
        } catch (e) {
            sendResponse({ action: "wallpaperDB", data: null, error: e.message });
        }
        return;
    }
    if (data.action === "refreshManifest") {
		try {
            const res = await syncManifest();
			sendResponse({
				action: "refreshManifestResult",
				result: res
			});
		} catch (err) {
			sendResponse({
				action: "refreshManifestResult",
				result: { ok: false, error: err.message || String(err) }
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

    if (data.action === "refreshManifest") {
		(async () => {
			try {
                const res = await syncManifest();
				post({
					action: "refreshManifestResult",
					result: res
				});
			} catch (err) {
				post({
					action: "refreshManifestResult",
					result: { ok: false, error: err.message || String(err) }
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
                    chrome.runtime.sendMessage({ 
                        type: 'MEDIA_UPDATE', 
                        data: priorityTabInfo.data,
                        tabId: currentPriorityTabId,
                        fromService: true
                    }).catch(() => {});
                }
            } else {
                // No media tabs left, clear the media widget
                chrome.runtime.sendMessage({ 
                    type: 'MEDIA_UPDATE', 
                    data: null,
                    fromService: true
                }).catch(() => {});
            }
        }
    }
});

