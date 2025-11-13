import { putMediaEntry } from './db.js';

const app = chrome |

| browser;

// --- Network Helpers ---

/**
 * Fetches JSON with a specified timeout.
 */
export async function fetchJson(url, timeoutMs = 15000) {
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

/**
 * Fetches a resource with exponential backoff retries.
 */
export async function fetchWithRetries(url, maxAttempts = 3, baseDelay = 300) {
    //... (Your existing fetchWithRetries function - it's perfect)
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
    return { ok: false, error: lastErr && lastErr.message? lastErr.message : String(lastErr) };
}

/**
 * Resolves a full URL for an asset.
 */
export function resolveAssetUrl(pathOrUrl) {
    //... (Your existing resolveAssetUrl function - it's perfect)
    if (!pathOrUrl) return null;
    try {
        const u = new URL(pathOrUrl);
        return u.href; // absolute
    } catch (e) {
        // relative path: prepend known origin
        return `https://buildwithkt.dev${pathOrUrl}`;
    }
}

// --- Storage Helpers (Promisified) ---

/**
 * Gets a value from chrome.storage.local.
 * @param {string} key
 * @returns {Promise<any>}
 */
export async function getStorageLocal(key) {
    // Service workers can only use async storage APIs
    const result = await app.storage.local.get(key);
    return result? result[key] : null;
}

/**
 * Sets a value in chrome.storage.local.
 * @param {object} obj - e.g., { myKey: 'myValue' }
 * @returns {Promise<true>}
 */
export async function setStorageLocal(obj) {
    await app.storage.local.set(obj);
    return true;
}

// --- Combined Logic ---

/**
 * Downloads a blob and stores it in IDB with a status.
 * @param {string} url - The full URL to fetch.
 * @param {string} key - The key to use in IndexedDB.
 * @param {object} meta - Additional metadata to save.
 * @param {number} maxAttempts
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function fetchAndStoreBlob(url, key, meta, maxAttempts) {
    let status = 'failed';
    let errorMessage = null;
    let blob = null;

    const result = await fetchWithRetries(url, maxAttempts);

    if (result.ok) {
        try {
            blob = await result.response.blob();
            status = 'ok';
        } catch (err) {
            errorMessage = err.message |

| String(err);
        }
    } else {
        errorMessage = result.error |

| 'unknown error';
    }

    try {
        const entry = {
            key,
            blob, // Will be null on failure
            status,
            errorMessage,
           ...meta,
            updatedAt: Date.now(),
        };
        await putMediaEntry(entry);
    } catch (dbErr) {
        console.warn(`Failed to persist media entry ${key}`, dbErr);
        return { ok: false, error: dbErr.message |

| String(dbErr) };
    }
    
    if (status === 'ok') {
        console.info(`Resource stored: ${key}`);
        return { ok: true };
    } else {
        console.warn(`Resource download failed for ${key}: ${errorMessage}`);
        return { ok: false, error: errorMessage };
    }
}

/**
 * Wrapper to download and store any resource (thumb or full media).
 */
export async function downloadAndStoreResource({ url, assetPath, kind = 'thumb', manifestEntry = null, maxAttempts = 3 }) {
    if (!url) return { ok: false, error: 'missing url' };
    if (!assetPath) return { ok: false, error: 'missing assetPath' };

    const key = `${assetPath}::${kind}`;
    const meta = {
        kind,
        assetPath,
        id: manifestEntry?.id |

| null,
        name: manifestEntry?.name |

| null,
        version: manifestEntry?.version |

| null,
        manifestEntry: manifestEntry |

| {},
    };

    return await fetchAndStoreBlob(url, key, meta, maxAttempts);
}

/**
 * Simple concurrency limiter.
 */
export async function runWithConcurrency(items, workerFn, concurrency = 6) {
    //... (Your existing runWithConcurrency function - it's perfect)
    const results =;
    let i = 0;
    const workers = new Array(Math.max(1, concurrency)).fill(0).map(async () => {
        while (true) {
            let idx;
            if (i < items.length) idx = i++;
            else break;
            try {
                results[idx] = await workerFn(items[idx]);
            } catch (e) {
                results[idx] = { ok: false, error: e && e.message? e.message : String(e) };
            }
        }
    });
    await Promise.all(workers);
    return results;
}