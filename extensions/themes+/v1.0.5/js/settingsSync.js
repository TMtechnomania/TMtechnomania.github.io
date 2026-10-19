// Cross-tab settings synchronisation.
//
// All tabs share one settings object in chrome.storage.local. A tab that saves
// marks the exact payload it wrote; every other tab receives the storage event
// and applies the change in place (no reload), and an open settings modal
// repaints its visible section so it never shows stale values from another tab.

import { STORAGE_KEY_SETTINGS, DEFAULT_CONFIG } from "./config.js";

/** Settings groups that are objects and must be merged, not replaced. */
const NESTED_GROUPS = [
	"wallpaper",
	"searchbar",
	"actionbar",
	"onScreenClock",
	"greeting",
	"font",
];

/**
 * Merge a stored settings object over the defaults so every key exists.
 * Unknown keys are preserved (shortcuts, zen presets, ...).
 */
export function normalizeSettings(stored) {
	const source =
		stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
	const merged = { ...DEFAULT_CONFIG, ...source };
	for (const group of NESTED_GROUPS) {
		merged[group] = {
			...(DEFAULT_CONFIG[group] || {}),
			...(source[group] || {}),
		};
	}
	return merged;
}

// A tab that saves settings also receives its own storage event. Remember the
// recent payloads so they can be recognised instead of being treated as a
// remote change (kept as a small FIFO because writes can interleave).
const SELF_WRITE_TTL = 5000;
const SELF_WRITE_HISTORY = 5;
const selfWrites = [];

/** Call immediately before writing settings to storage from this tab. */
export function markSettingsWrite(settings) {
	let snapshot = null;
	try {
		snapshot = JSON.parse(JSON.stringify(settings));
	} catch (e) {
		return;
	}
	selfWrites.push({ snapshot, at: Date.now() });
	while (selfWrites.length > SELF_WRITE_HISTORY) selfWrites.shift();
}

function isSelfWrite(value) {
	const now = Date.now();
	while (selfWrites.length && now - selfWrites[0].at > SELF_WRITE_TTL) {
		selfWrites.shift();
	}
	// Content comparison, not JSON identity: key order and properties dropped
	// by storage must not make our own write look like a change from elsewhere.
	return selfWrites.some((entry) => sameSettings(entry.snapshot, value));
}

/**
 * Subscribe to settings changes coming from other tabs.
 *
 * handler(nextSettings, previousSettings) - both normalized against defaults.
 * includeSelf: also fire for writes made by this tab (used by the page-level
 * applier so a save behaves exactly like a remote change).
 * Returns an unsubscribe function.
 */
export function onSettingsChanged(handler, { includeSelf = false } = {}) {
	const onChanged = globalThis.chrome?.storage?.onChanged;
	if (!onChanged) return () => {};

	const listener = (changes, area) => {
		if (area !== "local") return;
		const change = changes[STORAGE_KEY_SETTINGS];
		if (!change || !change.newValue) return;
		if (!includeSelf && isSelfWrite(change.newValue)) return;
		try {
			handler(
				normalizeSettings(change.newValue),
				change.oldValue ? normalizeSettings(change.oldValue) : null,
			);
		} catch (e) {
			console.warn("[settingsSync] listener failed", e);
		}
	};

	onChanged.addListener(listener);
	return () => {
		try {
			onChanged.removeListener(listener);
		} catch (e) {}
	};
}

/** Merge `source` into `target` in place, keeping the target's identity. */
export function mergeSettingsInPlace(target, source) {
	for (const key of Object.keys(source)) {
		const value = source[key];
		if (NESTED_GROUPS.includes(key) && value && typeof value === "object") {
			target[key] = { ...(target[key] || {}), ...value };
		} else {
			target[key] = value;
		}
	}
	return target;
}

/**
 * Order-insensitive deep comparison of two settings objects.
 * Properties holding `undefined` are ignored on both sides: storage drops them
 * on write, so a plain JSON comparison would report a difference where there
 * is none (which is exactly what caused the panel to rebuild on its own save).
 */
export function sameSettings(a, b) {
	if (a === b) return true;
	if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
		return a === b;
	}
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
			return false;
		}
		return a.every((value, index) => sameSettings(value, b[index]));
	}
	const keysA = Object.keys(a).filter((key) => a[key] !== undefined);
	const keysB = Object.keys(b).filter((key) => b[key] !== undefined);
	if (keysA.length !== keysB.length) return false;
	return keysA.every(
		(key) => key in b && sameSettings(a[key], b[key]),
	);
}

/** True when `next` actually carries a value this context does not have. */
export function hasSettingsDelta(current, next) {
	return !sameSettings(current, next);
}

/* ------------------------------------------------------------------ */
/* Debounced persistence                                              */
/*                                                                    */
/* Continuous controls (range sliders, colour pickers) call           */
/* saveSettings on every input event. Writing each one straight to    */
/* storage broadcasts a settings change to every other tab - one drag */
/* used to mean dozens of sync round-trips. Writes are coalesced and  */
/* flushed once the input settles (500ms), or immediately on demand   */
/* (modal close, tab hidden/unloaded).                                */
/* ------------------------------------------------------------------ */

const WRITE_DELAY_MS = 500;
let pendingSource = null;
let pendingTimer = null;

function cloneSettings(settings) {
	try {
		return JSON.parse(JSON.stringify(settings));
	} catch (e) {
		return null;
	}
}

/**
 * Queue a settings write; repeated calls replace the pending payload.
 * The object is snapshotted at flush time, not here, so a change merged from
 * another tab during the debounce window is not overwritten by a stale copy.
 */
export function queueSettingsWrite(settings) {
	if (!settings) return;
	pendingSource = settings;
	if (pendingTimer) clearTimeout(pendingTimer);
	pendingTimer = setTimeout(flushSettingsWrite, WRITE_DELAY_MS);
}

/** Write any pending payload now (no-op when nothing is queued). */
export function flushSettingsWrite() {
	if (pendingTimer) {
		clearTimeout(pendingTimer);
		pendingTimer = null;
	}
	if (!pendingSource) return;
	const payload = cloneSettings(pendingSource);
	pendingSource = null;
	if (!payload) return;
	markSettingsWrite(payload);
	try {
		chrome.storage.local.set({ [STORAGE_KEY_SETTINGS]: payload });
	} catch (e) {
		console.warn("[settingsSync] settings write failed", e);
	}
}

export function hasPendingSettingsWrite() {
	return pendingSource !== null;
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
	// Never lose the last change if the tab goes away mid-debounce.
	window.addEventListener("pagehide", flushSettingsWrite);
	window.addEventListener("beforeunload", flushSettingsWrite);
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") flushSettingsWrite();
	});
}
