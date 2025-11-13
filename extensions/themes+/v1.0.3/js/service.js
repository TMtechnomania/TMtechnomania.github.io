/* Service worker for extensions/themes+
     - On install: fetch wallpaper.json, store in chrome.storage.local as 'wallpaperDB',
         download thumbnails (and later full media) into IndexedDB `themes-assets`.
     - Provide a message API for the extension UI to query and retry downloads.
*/

const app = chrome || browser;

const WALLPAPER_JSON_URL = 'https://buildwithkt.dev/extensions/themes+/assets/wallpaper.json';
const IDB_NAME = 'themes-assets';
const IDB_VERSION = 1;
const IDB_STORE = 'media';

// Open/create IndexedDB
function openDB() {
    return new Promise((resolve, reject) => {
        const r = indexedDB.open(IDB_NAME, IDB_VERSION);
        r.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE, { keyPath: 'key' });
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
    });
}

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

async function getMediaEntry(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const store = tx.objectStore(IDB_STORE);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function deleteMediaEntry(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        const store = tx.objectStore(IDB_STORE);
        const req = store.delete(key);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
    });
}

async function getAllMediaKeys() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const store = tx.objectStore(IDB_STORE);
        const req = store.getAllKeys();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

async function fetchJson(url, timeoutMs = 15000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(id);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } finally {
        clearTimeout(id);
    }
}

function resolveAssetUrl(pathOrUrl) {
    if (!pathOrUrl) return null;
    try { return new URL(pathOrUrl).href; }
    catch (e) { return `https://buildwithkt.dev${pathOrUrl}`; }
}

async function fetchWithRetries(url, maxAttempts = 3, baseDelay = 300) {
    let attempt = 0;
    let lastErr = null;
    while (attempt < maxAttempts) {
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return { ok: true, response: res };
        } catch (err) {
            lastErr = err;
            attempt++;
            if (attempt >= maxAttempts) break;
            const delay = baseDelay * Math.pow(2, attempt - 1);
            await new Promise((r) => setTimeout(r, delay));
        }
    }
    return { ok: false, error: lastErr && lastErr.message ? lastErr.message : String(lastErr) };
}

async function downloadAndStoreBlobWithStatus(url, key, meta = {}, maxAttempts = 3) {
    const result = await fetchWithRetries(url, maxAttempts);
    const idStr = meta && meta.id ? `${meta.id}` : null;
    const nameStr = meta && meta.name ? `${meta.name}` : null;
    const idLabel = idStr ? `id=${idStr}` : '';
    const nameLabel = nameStr ? `name="${nameStr}"` : '';
    const metaLabel = [idLabel, nameLabel].filter(Boolean).join(' ');
    if (!result.ok) {
        const errorMessage = result.error || 'unknown error';
        try { await putMediaEntry(key, null, Object.assign({}, meta, { status: 'failed', errorMessage, attempts: maxAttempts })); }
        catch (e) { console.warn('Failed to persist failed entry', key, e); }
        console.warn(`Download failed for ${metaLabel} key=${key} url=${url}: ${errorMessage}`);
        return { ok: false, error: errorMessage };
    }
    try {
        const blob = await result.response.blob();
        await putMediaEntry(key, blob, Object.assign({}, meta, { status: 'ok', attempts: 1 }));
        console.info(`Stored ${metaLabel} key=${key} url=${url}`);
        return { ok: true };
    } catch (err) {
        const errorMessage = err && err.message ? err.message : String(err);
        try { await putMediaEntry(key, null, Object.assign({}, meta, { status: 'failed', errorMessage, attempts: 1 })); }
        catch (e) { console.warn('Failed to persist entry after blob error', key, e); }
        console.warn(`Processing failed for ${metaLabel} key=${key} url=${url}: ${errorMessage}`);
        return { ok: false, error: errorMessage };
    }
}

async function downloadAndStoreResource({ url, assetPath, kind = 'thumb', manifestEntry = null, keyOverride = null, maxAttempts = 3 }) {
    if (!url) return { ok: false, error: 'missing url' };
    if (!assetPath && !keyOverride) return { ok: false, error: 'missing assetPath or keyOverride' };
    const key = keyOverride || `${assetPath}::${kind}`;
    const meta = Object.assign({ kind, assetPath }, manifestEntry ? { manifestEntry } : {}, { id: manifestEntry && manifestEntry.id ? manifestEntry.id : null, name: manifestEntry && manifestEntry.name ? manifestEntry.name : null, version: manifestEntry && manifestEntry.version ? manifestEntry.version : null });
    return await downloadAndStoreBlobWithStatus(url, key, meta, maxAttempts);
}

async function runWithConcurrency(items, workerFn, concurrency = 6) {
    const results = [];
    let i = 0;
    const workers = new Array(Math.max(1, concurrency)).fill(0).map(async () => {
        while (true) {
            let idx;
            if (i < items.length) idx = i++;
            else break;
            try { results[idx] = await workerFn(items[idx]); }
            catch (e) { results[idx] = { ok: false, error: e && e.message ? e.message : String(e) }; }
        }
    });
    await Promise.all(workers);
    return results;
}

// Install: fetch manifest, diff with previous, store manifest, prune deleted, download new/updated thumbnails
self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        try {
            console.log('Install: fetching manifest...');
            const manifest = await fetchJson(WALLPAPER_JSON_URL);
            if (!manifest || typeof manifest.version !== 'string') {
                console.warn('Manifest invalid');
            }

            // read previous manifest
            let prevManifest = null;
            try { prevManifest = await new Promise((resolve) => app.storage.local.get('wallpaperDB', (r) => resolve(r && r.wallpaperDB ? r.wallpaperDB : null))); }
            catch (e) { console.warn('Failed to read previous manifest', e); }

            // save new manifest
            try { await new Promise((resolve, reject) => app.storage.local.set({ wallpaperDB: manifest }, () => { const err = chrome.runtime && chrome.runtime.lastError; if (err) return reject(err); resolve(); })); }
            catch (e) { console.warn('Failed to save manifest', e); }

            // build prev version map
            const prevMap = {};
            if (prevManifest) {
                const collect = (arr) => { if (!Array.isArray(arr)) return; for (const e of arr) if (e && e.asset) prevMap[e.asset] = e.version || null; };
                collect(prevManifest.images); collect(prevManifest.videos);
            }

            const allNew = [].concat(manifest.images || [], manifest.videos || []);

            // prune deleted keys
            const existingKeys = await getAllMediaKeys();
            const keysToDelete = [];
            const newThumbKeys = new Set(allNew.map(e => `${e.asset}::thumb`));
            for (const k of existingKeys) {
                if (k.endsWith('::thumb') && !newThumbKeys.has(k)) {
                    keysToDelete.push(k);
                    keysToDelete.push(k.replace('::thumb', '::media'));
                }
            }
            if (keysToDelete.length) {
                await Promise.all(keysToDelete.map((k) => deleteMediaEntry(k).catch(() => null)));
            }

            // build download list
            const candidates = [];
            for (const entry of allNew) {
                if (!entry || !entry.asset || !entry.thumbnail) continue;
                const key = `${entry.asset}::thumb`;
                const prevV = prevMap[entry.asset];
                if (prevV && prevV === entry.version) {
                    const existing = await getMediaEntry(key).catch(() => null);
                    if (existing && existing.status === 'ok') continue;
                }
                candidates.push({ entry, key });
            }

            if (candidates.length) {
                console.log(`Downloading ${candidates.length} thumbnails...`);
                await runWithConcurrency(candidates, async (t) => {
                    const url = resolveAssetUrl(t.entry.thumbnail);
                    return await downloadAndStoreResource({ url, assetPath: t.entry.asset, kind: 'thumb', manifestEntry: t.entry, keyOverride: t.key });
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
        app.storage.local.get('wallpaperDB', (res) => post({ action: 'wallpaperDB', data: res && res.wallpaperDB ? res.wallpaperDB : null }));
        return;
    }

    if (data.action === 'getMediaStatus' && data.key) {
        (async () => {
            try { const entry = await getMediaEntry(data.key); post({ action: 'mediaStatus', key: data.key, data: entry || null }); }
            catch (e) { post({ action: 'mediaStatus', key: data.key, error: e && e.message ? e.message : String(e) }); }
        })();
        return;
    }

    if (data.action === 'redownloadMissing') {
        (async () => {
            try {
                const manifest = await new Promise((resolve) => app.storage.local.get('wallpaperDB', (r) => resolve(r && r.wallpaperDB ? r.wallpaperDB : null)));
                if (!manifest) return post({ action: 'redownloadResult', error: 'no manifest' });
                const candidates = [].concat(manifest.images || [], manifest.videos || []).map((e) => ({ entry: e, url: resolveAssetUrl(e.thumbnail), key: `${e.asset}::thumb` }));
                await openDB();
                const need = [];
                for (const t of candidates) {
                    try { const e = await getMediaEntry(t.key); if (!e || e.status !== 'ok') need.push(t); } catch (err) { need.push(t); }
                }
                if (need.length === 0) return post({ action: 'redownloadResult', data: [] });
                const results = await runWithConcurrency(need, async (t) => downloadAndStoreResource({ url: t.url, assetPath: t.entry.asset, kind: 'thumb', manifestEntry: t.entry, keyOverride: t.key }), data.concurrency || 3);
                post({ action: 'redownloadResult', data: results });
            } catch (err) { post({ action: 'redownloadResult', error: err && err.message ? err.message : String(err) }); }
        })();
        return;
    }

    if (data.action === 'downloadFullAsset' && data.manifestEntry) {
        (async () => {
            try {
                const entry = data.manifestEntry;
                const url = resolveAssetUrl(entry.asset);
                const result = await downloadAndStoreResource({ url, assetPath: entry.asset, kind: 'media', manifestEntry: entry, maxAttempts: 3 });
                post({ action: 'downloadFullAssetResult', key: `${entry.asset}::media`, result });
            } catch (err) { post({ action: 'downloadFullAssetResult', error: err && err.message ? err.message : String(err) }); }
        })();
        return;
    }
});

// Expose some helper functions for potential direct calls (optional)
self.__themes_plus_helpers = { openDB, putMediaEntry, getMediaEntry, deleteMediaEntry, getAllMediaKeys, downloadAndStoreResource, resolveAssetUrl };
