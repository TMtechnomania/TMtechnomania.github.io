// Shared storage helpers for user data that older versions kept in localStorage.
//
// Older releases stored notes, alarms and stopwatch laps in window.localStorage.
// This module moves them to chrome.storage.local (the proper extension store) with
// a one-time, idempotent migration when the new tab page starts:
//   1. Read each legacy key from localStorage.
//   2. Copy any value that is not already present in chrome.storage.local.
//   3. Remove the migrated entries from localStorage.
//
// Modules read through storageGetSync() (served from an in-memory snapshot, so all
// existing synchronous call sites keep working unchanged) and write through
// storageSetAsync()/storageRemoveAsync(), which update the snapshot immediately and
// persist to chrome.storage.local in the background. A chrome.storage.onChanged
// listener keeps the snapshot fresh across new-tab pages, matching the old
// cross-tab localStorage sharing behavior.

const LEGACY_KEYS = [
	"tm_notes_v1", // notes (notesModal / notesWidget)
	"alarms_list_v1", // alarms (alarmModal / actionbar display)
	"alarms_permission_requested", // alarm notification-permission flag
	"timer_last_laps", // stopwatch laps (timerModal)
	"tm_tool_floats_v1", // floating tool positions (toolsRibbon, legacy px)
	"tm_tool_floats_v2", // floating tool positions (toolsRibbon, rem)
];

// Events modules already listen to, re-dispatched for cross-tab writes.
const KEY_EVENTS = {
	"tm_notes_v1": "notes-updated",
	"alarms_list_v1": "alarms-updated",
	"timer_last_laps": "timer-laps-updated",
	"tm_tool_floats_v1": "tool-floats-updated",
	"tm_tool_floats_v2": "tool-floats-updated",
};

let _cache = null; // { [key]: rawString | null }
let _initPromise = null;

function readLegacy(key) {
	try {
		return localStorage.getItem(key);
	} catch (e) {
		console.warn("[storageUtil] could not read legacy key", key, e);
		return null;
	}
}

/**
 * Hydrate the in-memory snapshot and run the one-time localStorage migration.
 * Safe to call multiple times; concurrent callers share a single promise.
 */
export function initStorageSync() {
	if (_initPromise) return _initPromise;
	_initPromise = (async () => {
		const cache = {};

		let stored = {};
		try {
			stored =
				(await new Promise((resolve) => {
					chrome.storage.local.get(LEGACY_KEYS, resolve);
				})) || {};
		} catch (e) {
			console.warn("[storageUtil] chrome.storage.local unavailable", e);
		}

		const toWrite = {};
		for (const key of LEGACY_KEYS) {
			const legacyValue = readLegacy(key);
			const storedValue = stored[key];
			if (storedValue !== undefined) {
				cache[key] = typeof storedValue === "string" ? storedValue : JSON.stringify(storedValue);
			} else if (legacyValue !== null) {
				cache[key] = legacyValue; // migrated value, kept in cache
				toWrite[key] = legacyValue;
			} else {
				cache[key] = null;
			}
		}

		if (Object.keys(toWrite).length > 0) {
			try {
				await new Promise((resolve) => chrome.storage.local.set(toWrite, resolve));
				for (const key of Object.keys(toWrite)) {
					try {
						localStorage.removeItem(key);
					} catch (_) {
						// best effort; value is already safe in extension storage
					}
				}
			} catch (e) {
				console.warn("[storageUtil] legacy migration persist failed", e);
			}
		}

		_cache = cache;

		if (chrome.storage && chrome.storage.onChanged) {
			chrome.storage.onChanged.addListener((changes, area) => {
				if (area !== "local" || !_cache) return;
				for (const key of LEGACY_KEYS) {
					const change = changes[key];
					if (!change) continue;
					_cache[key] =
						change.newValue === undefined ? null : String(change.newValue);

					// Let open pages react to writes made by another tab (or by
					// the same page through a different code path).
					if (typeof document !== "undefined") {
						try {
							document.dispatchEvent(
								new CustomEvent("extension-storage-changed", {
									detail: { key, value: _cache[key] },
								}),
							);
							const eventName = KEY_EVENTS[key];
							if (eventName) {
								document.dispatchEvent(
									new CustomEvent(eventName, {
										detail: { key, value: _cache[key] },
									}),
								);
							}
						} catch (e) {}
					}
				}
			});
		}
	})();
	return _initPromise;
}

/** Synchronous read from the in-memory snapshot (null when unknown/absent). */
export function storageGetSync(key) {
	if (!_cache || !(key in _cache)) {
		// Before initialization (or if it failed), fall back to the legacy store
		// rather than silently reporting "no data".
		try {
			return localStorage.getItem(key);
		} catch (e) {
			return null;
		}
	}
	return _cache[key];
}

async function persist(key, value) {
	try {
		if (value === null) {
			await new Promise((resolve) => chrome.storage.local.remove(key, resolve));
		} else {
			await new Promise((resolve) =>
				chrome.storage.local.set({ [key]: value }, resolve),
			);
		}
	} catch (e) {
		console.warn("[storageUtil] persist failed for", key, e);
	}
}

/** Update the snapshot immediately and persist to chrome.storage.local. */
export async function storageSetAsync(key, value) {
	if (!_cache) await initStorageSync();
	_cache[key] = value === undefined || value === null ? null : String(value);
	await persist(key, _cache[key]);
}

/** Remove the key from both the snapshot and chrome.storage.local. */
export async function storageRemoveAsync(key) {
	return storageSetAsync(key, null);
}
