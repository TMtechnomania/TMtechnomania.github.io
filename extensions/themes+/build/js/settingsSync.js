// Cross-tab settings synchronisation.
//
// All tabs share one settings object in chrome.storage.local. A tab that saves
// marks the exact payload it wrote; every other tab receives the storage event
// and applies the change in place (no reload), and an open settings modal
// repaints its visible section so it never shows stale values from another tab.

import { STORAGE_KEY_SETTINGS, DEFAULT_CONFIG } from "./config.js";

function isPlainObject(value) {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function cloneDefault(value) {
	try {
		return JSON.parse(JSON.stringify(value));
	} catch (e) {
		return value;
	}
}

/**
 * Recursively fill missing defaults into a stored object. Stored values always
 * win; arrays and nulls are treated as values, not containers. This keeps
 * newly added defaults inside wallpaper.filters, actionbar.weather,
 * famcam.flash, etc. working for existing users.
 */
function mergeWithDefaults(source, defaults) {
	const out = isPlainObject(source) ? { ...source } : {};
	for (const key of Object.keys(defaults)) {
		const defaultValue = defaults[key];
		if (!(key in out) || out[key] === undefined) {
			out[key] = cloneDefault(defaultValue);
		} else if (isPlainObject(out[key]) && isPlainObject(defaultValue)) {
			out[key] = mergeWithDefaults(out[key], defaultValue);
		}
	}
	return out;
}

/**
 * Merge a stored settings object over the defaults so every key exists.
 * Unknown keys are preserved (shortcuts, zen presets, ...).
 */
export function normalizeSettings(stored) {
	const source =
		stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
	const merged = mergeWithDefaults(source, DEFAULT_CONFIG);
	// Migrate the retired Glass variants to the single Glass theme.
	if (
		merged.theme === "glass-dark" ||
		merged.theme === "glass-light" ||
		merged.theme === "glass-system"
	) {
		merged.theme = "glass";
	}
	return merged;
}

// Each settings write includes a small sidecar record identifying the writer.
// This is precise where the old content-equality heuristic was not: a remote
// write is never mistaken for our own, even if the payload is identical, and
// two tabs writing the same content stay distinguishable.
const SETTINGS_META_KEY = "userSettingsMeta";
const TAB_ID = (() => {
	try {
		return crypto.randomUUID();
	} catch (e) {
		return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
	}
})();
let writeSeq = 0;

/** True when the change set was produced by a write from this tab. */
function isSelfWrite(changes) {
	const meta = changes?.[SETTINGS_META_KEY]?.newValue;
	return !!meta && meta.writer === TAB_ID;
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
		if (!change) return;
		// A deletion (chrome.storage.local.remove / clear, or an event delete)
		// means "back to defaults"; it must reach the page like any other change.
		const deleted = change.newValue === undefined;
		if (!includeSelf && !deleted && isSelfWrite(changes)) return;
		try {
			handler(
				normalizeSettings(change.newValue),
				change.oldValue === undefined ?
					null
				:	normalizeSettings(change.oldValue),
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
const SETTINGS_LOCK = "themes-plus:user-settings";
let pendingSource = null;
let pendingBase = null;
let pendingTimer = null;
// Snapshot whose async read/lock/write is currently in progress. Only used as
// a last-resort source if the page unloads before the write is issued.
let inFlightSnapshot = null;
let inFlightBase = null;

// Last persisted settings this tab knows about. Kept fresh by the storage
// listener and after every write; used as the "before" side when computing
// which leaves the user actually changed.
let persistedSettings = null;

function cloneSettings(settings) {
	try {
		return JSON.parse(JSON.stringify(settings));
	} catch (e) {
		return null;
	}
}

/** True when two stored payloads differ only by wallpaper rotation bookkeeping. */
function isWallpaperRotationOnly(previous, next) {
	if (!isPlainObject(previous) || !isPlainObject(next)) return false;
	const stripLastId = (settings) => {
		if (!isPlainObject(settings.wallpaper)) return settings;
		// sameSettings ignores undefined properties, so this removes last_id.
		return {
			...settings,
			wallpaper: { ...settings.wallpaper, last_id: undefined },
		};
	};
	return sameSettings(stripLastId(previous), stripLastId(next));
}

// Incremented for every settings change written by *another* tab that a user
// could notice. Rotation bookkeeping (wallpaper.last_id) is excluded because
// slideshow tabs write it constantly.
let remoteRevision = 0;

/** How many meaningful settings changes other tabs have made so far. */
export function getSettingsRevision() {
	return remoteRevision;
}

/** Read `userSettings` from storage, normalized against the defaults. */
function readStoredSettings() {
	return new Promise((resolve) => {
		try {
			chrome.storage.local.get(STORAGE_KEY_SETTINGS, (res) => {
				if (chrome.runtime?.lastError) {
					resolve(null);
					return;
				}
				resolve(normalizeSettings(res?.[STORAGE_KEY_SETTINGS]));
			});
		} catch (e) {
			resolve(null);
		}
	});
}

function writeStoredSettings(settings) {
	const meta = { writer: TAB_ID, seq: ++writeSeq };
	return new Promise((resolve, reject) => {
		try {
			chrome.storage.local.set(
				{
					[STORAGE_KEY_SETTINGS]: settings,
					[SETTINGS_META_KEY]: meta,
				},
				() => {
					const err = chrome.runtime?.lastError;
					if (err) reject(err);
					else resolve();
				},
			);
		} catch (e) {
			reject(e);
		}
	});
}

function reportSettingsWriteError(error) {
	try {
		console.error("[settingsSync] settings write failed", error);
		if (typeof document !== "undefined") {
			document.dispatchEvent(
				new CustomEvent("settings:write-error", {
					detail: String(error?.message || error),
				}),
			);
		}
	} catch (e) {}
}

/**
 * Recursively keep only the leaves of `next` that differ from `base`.
 * Returns null when nothing changed. Objects are walked leaf by leaf so a
 * local edit to `wallpaper.filters.blur` cannot overwrite a remote change to
 * `wallpaper.collection`.
 */
function settingsDelta(base, next) {
	const delta = {};
	let changed = false;
	for (const key of Object.keys(next)) {
		const value = next[key];
		// storage drops undefined properties - treating them as edits would
		// make every save look like a change.
		if (value === undefined) continue;
		const baseValue = base?.[key];
		if (isPlainObject(value) && isPlainObject(baseValue)) {
			const nested = settingsDelta(baseValue, value);
			if (nested) {
				delta[key] = nested;
				changed = true;
			}
		} else if (!sameSettings(baseValue, value)) {
			delta[key] = cloneSettings(value);
			changed = true;
		}
	}
	return changed ? delta : null;
}

/** Apply a partial delta (from settingsDelta) onto `target` in place. */
function applySettingsDelta(target, delta) {
	for (const key of Object.keys(delta)) {
		const value = delta[key];
		if (isPlainObject(value) && isPlainObject(target[key])) {
			applySettingsDelta(target[key], value);
		} else {
			target[key] = cloneSettings(value);
		}
	}
	return target;
}

/**
 * Collect the dot-paths of every leaf that differs between `base` and `next`
 * (and, with no base, every leaf of `next`). Used to protect unflushed local
 * edits from being overwritten by a merge from another tab.
 */
function collectChangedPaths(base, next, prefix, out) {
	for (const key of Object.keys(next)) {
		const value = next[key];
		if (value === undefined) continue;
		const path = prefix ? `${prefix}.${key}` : key;
		const baseValue = base ? base[key] : undefined;
		if (isPlainObject(value) && isPlainObject(baseValue)) {
			collectChangedPaths(baseValue, value, path, out);
		} else if (!sameSettings(baseValue, value)) {
			out.add(path);
		}
	}
	return out;
}

function collectLeafPaths(value, prefix, out) {
	if (isPlainObject(value)) {
		for (const key of Object.keys(value)) {
			if (value[key] === undefined) continue;
			collectLeafPaths(value[key], prefix ? `${prefix}.${key}` : key, out);
		}
	} else {
		out.add(prefix);
	}
	return out;
}

/** Merge remote settings into `target`, leaving pending local leaves alone. */
function mergeRemoteRespectingDirty(target, source, dirtyPaths, prefix = "") {
	for (const key of Object.keys(source)) {
		const value = source[key];
		if (value === undefined) continue;
		const path = prefix ? `${prefix}.${key}` : key;
		if (dirtyPaths.has(path)) continue; // an unflushed local edit wins
		if (isPlainObject(value) && isPlainObject(target[key])) {
			mergeRemoteRespectingDirty(target[key], value, dirtyPaths, path);
		} else {
			target[key] = cloneSettings(value);
		}
	}
	return target;
}

/**
 * Paths of all local edits that are queued or currently being written. The
 * settings panel consults this before applying a cross-tab update so a remote
 * payload cannot silently revert an edit that has not reached storage yet.
 */
export function getPendingSettingsPaths() {
	const paths = new Set();
	if (pendingSource) {
		if (pendingBase) collectChangedPaths(pendingBase, pendingSource, "", paths);
		else collectLeafPaths(pendingSource, "", paths);
	}
	if (inFlightSnapshot) {
		if (inFlightBase) collectChangedPaths(inFlightBase, inFlightSnapshot, "", paths);
		else collectLeafPaths(inFlightSnapshot, "", paths);
	}
	return paths;
}

/**
 * Merge a settings object received from another tab into `target` in place.
 * Non-conflicting remote values are applied; leaves with a local pending edit
 * keep their local value and will overwrite the remote one on flush.
 *
 * The queued edit baseline is advanced at the same time, so merged remote
 * values are not replayed as if they were local edits by the eventual flush.
 */
export function applyRemoteSettings(target, next) {
	const dirtyPaths = getPendingSettingsPaths();
	mergeRemoteRespectingDirty(target, next, dirtyPaths);
	if (pendingBase) {
		mergeRemoteRespectingDirty(pendingBase, next, dirtyPaths);
	}
	return target;
}

/** The settings as this tab currently understands them: storage + queued edits. */
function getInMemorySettings() {
	const model = persistedSettings ? cloneSettings(persistedSettings) : null;
	if (!model) return null;
	if (inFlightBase && inFlightSnapshot) {
		const delta = settingsDelta(inFlightBase, inFlightSnapshot);
		if (delta) applySettingsDelta(model, delta);
	}
	return model;
}

function applySettingsPatch(target, patch) {
	const before = cloneSettings(target);
	applySettingsDelta(target, patch || {});
	return !sameSettings(before, target);
}

/**
 * Serialize read-modify-write cycles. The in-tab promise chain is always
 * used; where available, a Web Lock also serializes writers across tabs so
 * two new-tab pages cannot read the same base and clobber each other.
 */
let writeChain = Promise.resolve();

function withSettingsLock(task) {
	const run = () => {
		const locks = globalThis.navigator?.locks;
		if (locks?.request) {
			// Chrome keeps the lock held until the returned promise settles.
			return locks.request(SETTINGS_LOCK, task);
		}
		return Promise.resolve().then(task);
	};
	const result = writeChain.then(run, run);
	writeChain = result.catch(() => {});
	return result;
}

/**
 * Queue a settings write; repeated calls replace the pending payload.
 * The object is snapshotted at flush time, not here, so a change merged from
 * another tab during the debounce window is not overwritten by a stale copy.
 */
export function queueSettingsWrite(settings) {
	if (!settings) return;
	// Remember the state the edits started from. The delta at flush time is
	// computed against *this* baseline, not the freshly read settings: a
	// remote change that arrived after the user started editing must not be
	// mistaken for a local edit (and reverted).
	if (pendingSource === null) {
		pendingBase = persistedSettings ? cloneSettings(persistedSettings) : null;
	}
	pendingSource = settings;
	if (pendingTimer) clearTimeout(pendingTimer);
	pendingTimer = setTimeout(flushSettingsWrite, WRITE_DELAY_MS);
}

/**
 * Merge the local edits into the *latest* stored settings and persist the
 * result. The delta is computed against the state the edits started from, so
 * a concurrent change in another tab (or another settings group) survives.
 * Returns a promise that settles once written.
 */
function persistPendingSettings() {
	if (!pendingSource) return Promise.resolve(false);
	const snapshot = cloneSettings(pendingSource);
	const editBase = pendingBase;
	pendingSource = null;
	pendingBase = null;
	if (!snapshot) return Promise.resolve(false);

	inFlightSnapshot = snapshot;
	inFlightBase = editBase;
	return withSettingsLock(async () => {
		// Re-read inside the lock: this is the authoritative merge target.
		const fresh = await readStoredSettings();
		const base =
			editBase || fresh || (persistedSettings ? cloneSettings(persistedSettings) : null);
		const delta = editBase ? settingsDelta(editBase, snapshot) : null;

		// No baseline at all (very early edit): fall back to the previous
		// whole-object write rather than dropping the change.
		let payload;
		if (!editBase) {
			payload = snapshot;
		} else if (!delta) {
			// The queued values already match the edit baseline - the user did
			// not change anything that needs persisting.
			if (!persistedSettings && base) persistedSettings = base;
			return false;
		} else {
			// The delta always lands on the freshly read value, never on the
			// edit baseline: remote changes between the two must survive.
			const target = fresh || cloneSettings(base) || {};
			payload = applySettingsDelta(target, delta);
		}

		await writeStoredSettings(payload);
		persistedSettings = cloneSettings(payload);
		return true;
	})
		.catch((e) => {
			reportSettingsWriteError(e);
			return false;
		})
		.finally(() => {
			inFlightSnapshot = null;
			inFlightBase = null;
		});
}

/** Write any pending payload now (no-op when nothing is queued). */
export function flushSettingsWrite() {
	if (pendingTimer) {
		clearTimeout(pendingTimer);
		pendingTimer = null;
	}
	return persistPendingSettings();
}

/**
 * Last-chance flush for page unload. The page may be torn down before an
 * async read/lock settles, so this merges against the in-memory copy of
 * storage and issues the write synchronously (best effort).
 */
function flushSettingsWriteOnUnload() {
	if (pendingTimer) {
		clearTimeout(pendingTimer);
		pendingTimer = null;
	}
	// Prefer a queued value; if one is mid-write, re-issue it directly in case
	// the async read/lock never settles before the page is torn down.
	const queued = pendingSource ? cloneSettings(pendingSource) : null;
	const editBase = queued ? pendingBase : inFlightBase;
	pendingSource = null;
	pendingBase = null;
	const snapshot = queued || inFlightSnapshot;
	if (!snapshot) return;

	// Merge the edits over the newest state this tab has seen, without an
	// async read (the page may be gone before it resolves).
	const target = persistedSettings ? cloneSettings(persistedSettings) : null;
	const delta = editBase ? settingsDelta(editBase, snapshot) : null;
	if (editBase && !delta) return;
	const payload = editBase && target ? applySettingsDelta(target, delta) : snapshot;

	try {
		chrome.storage.local.set(
			{
				[STORAGE_KEY_SETTINGS]: payload,
				[SETTINGS_META_KEY]: { writer: TAB_ID, seq: ++writeSeq },
			},
			() => {
				const err = chrome.runtime?.lastError;
				if (err) reportSettingsWriteError(err);
			},
		);
	} catch (e) {
		reportSettingsWriteError(e);
	}
}

/**
 * Apply a local mutation to the in-memory settings model and persist it
 * through the same debounced slot the settings panel uses. The patch may be an
 * object (deep-merged) or a mutator receiving a draft (return false to skip).
 *
 * Reading the in-memory model - rather than chrome.storage - is what makes
 * this safe next to a pending panel edit: both writers share one pending slot
 * and one baseline, so neither can drop the other's change.
 *
 * Returns the updated settings object, or false when nothing was written.
 */
export async function updateSettings(patch) {
	const apply = (target) => {
		if (typeof patch === "function") {
			try {
				return patch(target) !== false;
			} catch (e) {
				console.warn("[settingsSync] settings mutation failed", e);
				return false;
			}
		}
		return applySettingsPatch(target, patch);
	};

	// A debounced write is already queued: mutate its payload in place. The
	// flush will persist both edits as one write.
	if (pendingSource) {
		if (!apply(pendingSource)) return false;
		if (!pendingTimer) {
			pendingTimer = setTimeout(flushSettingsWrite, WRITE_DELAY_MS);
		}
		return pendingSource;
	}

	// No queued write: seed one from the in-memory model (storage plus any
	// in-flight write) so the patch never has to read stale storage.
	let model = getInMemorySettings();
	if (!model) {
		// Very early call, before the baseline read resolved.
		model = await readStoredSettings();
		if (!model) return false;
	}
	const draft = cloneSettings(model) || model;
	if (!apply(draft)) return false;
	queueSettingsWrite(draft);
	return draft;
}

export function hasPendingSettingsWrite() {
	return pendingSource !== null;
}

// Track the persisted truth from the start: the initial read seeds the
// baseline and every storage change (from any tab, including this one) keeps
// it current. An open settings panel also merges these values into the object
// its controls edit, so the delta at save time only holds real local edits.
if (globalThis.chrome?.storage?.local) {
	readStoredSettings().then((stored) => {
		if (!persistedSettings && stored) persistedSettings = stored;
	});
	try {
		chrome.storage.onChanged.addListener((changes, area) => {
			if (area !== "local") return;
			const change = changes[STORAGE_KEY_SETTINGS];
			if (!change) return;
			// newValue === undefined means the settings were removed/reset:
			// treat that as the defaults, both for the baseline and for the
			// cross-tab revision (open pages must notice the reset).
			persistedSettings = normalizeSettings(change.newValue);
			if (
				!isSelfWrite(changes) &&
				!isWallpaperRotationOnly(change.oldValue, change.newValue)
			) {
				remoteRevision++;
			}
		});
	} catch (e) {}
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
	// Never lose the last change if the tab goes away mid-debounce.
	window.addEventListener("pagehide", flushSettingsWriteOnUnload);
	window.addEventListener("beforeunload", flushSettingsWriteOnUnload);
	// Discrete controls (slider release, select, checkbox) commit here; flushing
	// on commit shrinks the window in which an unload can lose a change.
	document.addEventListener("change", flushSettingsWrite, true);
	// Page Lifecycle: last synchronous chance before backgrounding/freezing.
	document.addEventListener("freeze", flushSettingsWriteOnUnload);
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") flushSettingsWrite();
	});
}
