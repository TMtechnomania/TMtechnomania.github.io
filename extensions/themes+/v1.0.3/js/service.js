/* Service worker for extensions/themes+
     - Imports helpers from config.js, db.js, and api.js
     - On install: fetch manifest, store in chrome.storage, and download thumbnails.
     - Provide a message API for the extension UI.
*/

import { WALLPAPER_JSON_URL, STORAGE_KEY_DB } from './config.js';
import { getMediaEntry, deleteMediaEntry, getAllMediaKeys } from './db.js';
import {
    fetchJson,
    resolveAssetUrl,
    getStorageLocal,
    setStorageLocal,
    downloadAndStoreResource,
    runWithConcurrency
} from './api.js';

const app = chrome || browser;

// Install: fetch manifest, diff with previous, store manifest, prune deleted, download new/updated thumbnails
self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        try {
            console.log('Install: fetching manifest...');
            const manifest = await fetchJson(WALLPAPER_JSON_URL);
            if (!manifest || typeof manifest.version !== 'string') {
                console.warn('Manifest invalid');
            }

            // Read previous manifest using promisified helper
            let prevManifest = null;
            try {
                prevManifest = await getStorageLocal(STORAGE_KEY_DB);
            } catch (e) {
                console.warn('Failed to read previous manifest', e);
            }

            // Save new manifest using promisified helper
            try {
                await setStorageLocal({ [STORAGE_KEY_DB]: manifest });
            } catch (e) {
                console.warn('Failed to save manifest', e);
            }

            // Build prev version map
            const prevMap = {};
            if (prevManifest) {
                const collect = (arr) => { if (!Array.isArray(arr)) return; for (const e of arr) if (e && e.asset) prevMap[e.asset] = e.version || null; };
                collect(prevManifest.images); collect(prevManifest.videos);
            }

            const allNew = [].concat(manifest.images || [], manifest.videos || []);

            // Prune deleted keys
            const existingKeys = await getAllMediaKeys(); // Imported from db.js
            const keysToDelete = [];
            const newThumbKeys = new Set(allNew.map(e => `${e.asset}::thumb`));
            for (const k of existingKeys) {
                if (k.endsWith('::thumb') && !newThumbKeys.has(k)) {
                    keysToDelete.push(k);
                    keysToDelete.push(k.replace('::thumb', '::media'));
                }
            }
            if (keysToDelete.length) {
                await Promise.all(keysToDelete.map((k) => deleteMediaEntry(k).catch(() => null))); // Imported from db.js
            }

            // Build download list
            const candidates = [];
            for (const entry of allNew) {
                if (!entry || !entry.asset || !entry.thumbnail) continue;
                const key = `${entry.asset}::thumb`;
                const prevV = prevMap[entry.asset];
                if (prevV && prevV === entry.version) {
                    const existing = await getMediaEntry(key).catch(() => null); // Imported from db.js
                    if (existing && existing.status === 'ok') continue;
                }
                candidates.push({ entry, key });
            }

            if (candidates.length) {
                console.log(`Downloading ${candidates.length} thumbnails...`);
                // Use imported helpers
                await runWithConcurrency(candidates, async (t) => {
                    const url = resolveAssetUrl(t.entry.thumbnail);
                    return await downloadAndStoreResource({ url, assetPath: t.entry.asset, kind: 'thumb', manifestEntry: t.entry });
                }, 6);
            }

            try { self.skipWaiting(); } catch (e) { /* ignore */ }
            console.log('Install complete');
        } catch (err) { console.error('Install failed', err); }
    })());
});

self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });

// Message API
self.addEventListener('message', (ev) => {
    const data = ev.data || {};
    const source = ev.source;
    const post = (msg) => { try { source && source.postMessage && source.postMessage(msg); } catch (e) { /* ignore */ } };
    if (!data || !data.action) return;

    if (data.action === 'getWallpaperDB') {
        (async () => {
            try {
                const db = await getStorageLocal(STORAGE_KEY_DB); // Use helper
                post({ action: 'wallpaperDB', data: db || null });
            } catch (e) {
                post({ action: 'wallpaperDB', data: null, error: e.message });
            }
        })();
        return;
    }

    if (data.action === 'getMediaStatus' && data.key) {
        (async () => {
            try {
                const entry = await getMediaEntry(data.key); // Use helper
                post({ action: 'mediaStatus', key: data.key, data: entry || null });
            } catch (e) {
                post({ action: 'mediaStatus', key: data.key, error: e && e.message ? e.message : String(e) });
            }
        })();
        return;
    }

    if (data.action === 'redownloadMissing') {
        (async () => {
            try {
                const manifest = await getStorageLocal(STORAGE_KEY_DB); // Use helper
                if (!manifest) return post({ action: 'redownloadResult', error: 'no manifest' });

                const candidates = [].concat(manifest.images || [], manifest.videos || [])
                    .map((e) => ({ entry: e, url: resolveAssetUrl(e.thumbnail), key: `${e.asset}::thumb` })); // Use helper

                const need = [];
                for (const t of candidates) {
                    try {
                        const e = await getMediaEntry(t.key); // Use helper
                        if (!e || e.status !== 'ok') need.push(t);
                    } catch (err) { need.push(t); }
                }

                if (need.length === 0) return post({ action: 'redownloadResult', data: [] });

                const results = await runWithConcurrency(need, async (t) => // Use helper
                    downloadAndStoreResource({ // Use helper
                        url: t.url,
                        assetPath: t.entry.asset,
                        kind: 'thumb',
                        manifestEntry: t.entry
                    }),
                    data.concurrency || 3
                );
                post({ action: 'redownloadResult', data: results });
            } catch (err) {
                post({ action: 'redownloadResult', error: err && err.message ? err.message : String(err) });
            }
        })();
        return;
    }

    if (data.action === 'downloadFullAsset' && data.manifestEntry) {
        (async () => {
            try {
                const entry = data.manifestEntry;
                const url = resolveAssetUrl(entry.asset); // Use helper
                const result = await downloadAndStoreResource({ // Use helper
                    url,
                    assetPath: entry.asset,
                    kind: 'media',
                    manifestEntry: entry,
                    maxAttempts: 3
                });
                post({ action: 'downloadFullAssetResult', key: `${entry.asset}::media`, result });
            } catch (err) {
                post({ action: 'downloadFullAssetResult', error: err && err.message ? err.message : String(err) });
            }
        })();
        return;
    }
});