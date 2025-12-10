import { putMediaEntry } from "./db.js";

const app =
	typeof chrome !== "undefined"
		? chrome
		: typeof browser !== "undefined"
		? browser
		: null;

export async function fetchJson(url, timeoutMs = 15000) {
	const controller = new AbortController();
	const id = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(url, { signal: controller.signal });
		if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
		return await res.json();
	} finally {
		clearTimeout(id);
	}
}

export async function fetchWithRetries(url, maxAttempts = 3, baseDelay = 300) {
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
	return {
		ok: false,
		error: lastErr && lastErr.message ? lastErr.message : String(lastErr),
	};
}

export function resolveAssetUrl(pathOrUrl) {
	if (!pathOrUrl) return null;
	try {
		const u = new URL(pathOrUrl, "https://buildwithkt.dev");
		return u.href;
	} catch (e) {
		// console.warn(`Failed to resolve asset URL: ${pathOrUrl}`, e);
		return null;
	}
}

export async function getStorageLocal(key) {
	if (!app || !app.storage || !app.storage.local) return null;
	return new Promise((resolve) => {
		app.storage.local.get(key, (res) => {
			const err =
				typeof chrome !== "undefined" && chrome.runtime
					? chrome.runtime.lastError
					: null;
			if (err) return resolve(null);
			resolve(res ? res[key] : null);
		});
	});
}

export async function setStorageLocal(obj) {
	if (!app || !app.storage || !app.storage.local) return false;
	return new Promise((resolve, reject) => {
		app.storage.local.set(obj, () => {
			const err =
				typeof chrome !== "undefined" && chrome.runtime
					? chrome.runtime.lastError
					: null;
			if (err) return reject(err);
			resolve(true);
		});
	});
}

async function fetchAndStoreBlob(url, key, meta = {}, maxAttempts = 3) {
	let status = "failed";
	let errorMessage = null;
	let blob = null;

	const logIdentifier = meta.id || meta.name || key;

	const result = await fetchWithRetries(url, maxAttempts);

	if (result.ok) {
		try {
			blob = await result.response.blob();
			status = "ok";
		} catch (err) {
			errorMessage = err && err.message ? err.message : String(err);
		}
	} else {
		errorMessage = result.error || "unknown error";
	}

	try {
		const entry = Object.assign(
			{ key, blob, status, errorMessage, updatedAt: Date.now() },
			meta || {},
		);
		await putMediaEntry(entry);
	} catch (dbErr) {
		// console.warn(`Failed to persist media entry ${logIdentifier}`, dbErr);
		return {
			ok: false,
			error: dbErr && dbErr.message ? dbErr.message : String(dbErr),
		};
	}

	if (status === "ok") {
		// console.info(`Resource stored: ${logIdentifier}: ${Date.now()}`);
		return { ok: true };
	} else {
		// console.warn(
// 	`Resource download failed for ${logIdentifier}: ${errorMessage}`,
// );
		return { ok: false, error: errorMessage };
	}
}

export async function downloadAndStoreResource({
	url,
	assetPath,
	kind = "thumb",
	manifestEntry = null,
	maxAttempts = 3,
}) {
	if (!url) return { ok: false, error: "missing url" };
	if (!assetPath) return { ok: false, error: "missing assetPath" };

	const key = `${assetPath}::${kind}`;
	const meta = {
		kind,
		assetPath, 
		id: manifestEntry && manifestEntry.id ? manifestEntry.id : null,
		name: manifestEntry && manifestEntry.name ? manifestEntry.name : null,
		version:
			manifestEntry && manifestEntry.version
				? manifestEntry.version
				: null,
		manifestEntry: manifestEntry || {},
	};

	return await fetchAndStoreBlob(url, key, meta, maxAttempts);
}

export async function runWithConcurrency(items, workerFn, concurrency = 6) {
	const results = [];
	let i = 0;
	const workers = new Array(Math.max(1, concurrency))
		.fill(0)
		.map(async () => {
			while (true) {
				let idx;
				if (i < items.length) idx = i++;
				else break;
				try {
					results[idx] = await workerFn(items[idx]);
				} catch (e) {
					results[idx] = {
						ok: false,
						error: e && e.message ? e.message : String(e),
					};
				}
			}
		});
	await Promise.all(workers);
	return results;
}
